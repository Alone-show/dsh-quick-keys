#!/usr/bin/env node
/**
 * dsh-quick-keys 离线冒烟：不需要浏览器、不联网、不写任何用户目录。
 *
 * 覆盖：
 *   1. 用假的 window.__ModuleLoader__ + 假 require 跑通 client.js 的 factory；
 *   2. 用假 ctx 捕获 commandUi / shortcuts 注册项，校验 /new 与目录行的形状；
 *   3. 用假 window.addEventListener 捕获**捕获阶段**的 keydown 监听，跑守卫矩阵
 *      （对话区外、弹窗、终端、长按、输入法、组合键、无会话、侧边栏输入框）；
 *   4. 校验切换计划模式时发出的命令（/plan 与 /plan off）与失败兜底；
 *   5. 校验诊断面 `window.__DSH_QUICK_KEYS__`（版本 / mounted / 判定依据 / 切换结果）；
 *   6. 校验卸载时用同一函数 + 同一捕获标记 removeEventListener。
 *
 * 特别断言：不能依赖 shortcuts.observeFixedInput —— 那是冒泡阶段，会输给 Lexical
 * 对 Tab 的处理；这是第一版 Shift+Tab 不生效的原因。
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const pluginDir = path.dirname(fileURLToPath(import.meta.url));

let failed = 0;
function ok(condition, label, extra) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    return;
  }
  failed++;
  console.log(`  ✗ ${label}${extra === undefined ? '' : `\n      ${String(extra).split('\n').join('\n      ')}`}`);
}
const eq = (actual, expected, label) =>
  ok(
    JSON.stringify(actual) === JSON.stringify(expected),
    label,
    `expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`,
  );

// ── 加载浏览器半侧 ───────────────────────────────────────────────────────────
let registration;
const windowListeners = [];
globalThis.window = {
  __ModuleLoader__: {
    load(entry) {
      registration = entry;
    },
  },
  addEventListener(type, handler, capture) {
    windowListeners.push({ type, handler, capture });
  },
  removeEventListener(type, handler, capture) {
    const index = windowListeners.findIndex(
      (row) => row.type === type && row.handler === handler && row.capture === capture,
    );
    if (index !== -1) windowListeners.splice(index, 1);
  },
};

await import(pathToFileURL(path.join(pluginDir, 'client.js')).href);

const fakePrimitives = { IconNewChatOutlineRegular: () => null };
const mod = registration.factory((specifier) => {
  if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return fakePrimitives;
  throw new Error(`unexpected require: ${specifier}`);
});
const S = mod.__internals.SELECTORS;
const diagnostics = mod.__internals.diagnostics;

// ── 假 DOM 元素 ─────────────────────────────────────────────────────────────
/**
 * 造一个可被 decide() 消费的最小元素：closest 只看真实实现用到的那些选择器。
 * @param {object} flags 场景开关。
 * @returns {object} 假元素。
 */
function makeElement(flags = {}) {
  const { sessionId, conversation, composerSeat, composerInput, main, editable, modal, terminal } = flags;
  const scope = {
    getAttribute(name) {
      if (name === 'data-conversation-session' && sessionId !== undefined) return sessionId;
      return null;
    },
  };
  return {
    tagName: 'DIV',
    getAttribute() {
      return null;
    },
    closest(selector) {
      if (selector === S.terminal) return terminal ? {} : null;
      if (selector === S.modal) return modal ? {} : null;
      if (selector === S.composerInput) return composerInput ? {} : null;
      if (selector === S.composerSeat) return composerSeat ? {} : null;
      if (selector === S.conversation) return conversation ? scope : null;
      if (selector === S.main) return main ? {} : null;
      if (selector === S.editable) return editable ? {} : null;
      return null;
    },
  };
}

// ── 假 ctx ───────────────────────────────────────────────────────────────────
const SESSION_ID = 'session-a';

function makeList(overrides = {}) {
  return {
    ids: [SESSION_ID],
    byId: {
      [SESSION_ID]: {
        id: SESSION_ID,
        displayTitle: 'demo',
        running: false,
        blank: false,
        updatedAt: 0,
        retainedBy: { mainView: 1 },
        ...(overrides.row ?? {}),
      },
    },
    phase: 'ready',
    projectionsBySession: {
      [SESSION_ID]: {
        values: overrides.plan === undefined ? {} : { plan: overrides.plan },
        state: 'ready',
        error: null,
      },
    },
  };
}

/**
 * 假 ctx —— 关键点：像 cordis 一样，**访问未 inject 的服务直接抛错**
 * （`cannot get property "x" without inject`）。这样少写一个 inject 就会被冒烟抓到，
 * 而不是到浏览器里才变成一条被 try/catch 吞掉的 warn。
 */
function makeCtx(overrides = {}) {
  const seen = {
    localeNs: null,
    dicts: null,
    commands: [],
    fixed: [],
    editableRegistrations: 0,
    executes: [],
    sessionsStarted: 0,
  };
  const list = makeList(overrides);
  const executeImpl = overrides.execute ?? (async () => ({ ok: true, value: { kind: 'success' } }));

  /** 只有在 mod.inject 里声明过才允许取用；和 cordis 的行为保持一致。 */
  const service = (name, build) => {
    let value;
    return () => {
      if (!mod.inject.includes(name)) throw new Error(`cannot get property "${name}" without inject`);
      if (value === undefined) value = build();
      return value;
    };
  };

  const locale = service('locale', () => ({
    register(ns, dicts) {
      seen.localeNs = ns;
      seen.dicts = dicts;
      return () => {};
    },
    bind() {
      return (key) => seen.dicts?.zh?.[key] ?? key;
    },
  }));
  const commandUi = service('commandUi', () => ({
    register(contribution) {
      seen.commands.push(contribution);
      return () => {};
    },
  }));
  const shortcuts = service('shortcuts', () => ({
    registerFixed(command) {
      seen.fixed.push(command);
      return () => {};
    },
    // 故意不提供 observeFixedInput：用了它说明又退回冒泡路径（会被 Lexical 吃掉）。
    register() {
      seen.editableRegistrations++;
      throw new Error('Tab 是保留键，不能用可编辑 register 注册');
    },
  }));
  const sessions = service('sessions', () => ({ list: { getSnapshot: () => list } }));
  const uiWorkspace = service('uiWorkspace', () => ({
    startSession() {
      seen.sessionsStarted++;
    },
  }));
  const remoteCommands = service('remote.commands', () => ({
    async execute(...args) {
      seen.executes.push(args);
      return executeImpl(...args);
    },
  }));
  const remote = service('remote', () => ({
    get commands() {
      return remoteCommands();
    },
  }));

  const ctx = {
    effect(fn) {
      const dispose = fn();
      return () => dispose?.();
    },
    get locale() {
      return locale();
    },
    get commandUi() {
      return commandUi();
    },
    get shortcuts() {
      return shortcuts();
    },
    get sessions() {
      return sessions();
    },
    get uiWorkspace() {
      return uiWorkspace();
    },
    get remote() {
      return remote();
    },
  };
  return { ctx, seen };
}

/** 取出最近安装的 keydown 监听。 */
function installedKeydown() {
  const row = [...windowListeners].reverse().find((entry) => entry.type === 'keydown');
  if (row === undefined) throw new Error('没有安装 keydown 监听');
  return row;
}

/** 构造一次 keydown，并记录 preventDefault / stopPropagation 调用次数。 */
function keydown(options = {}) {
  const calls = { preventDefault: 0, stopPropagation: 0 };
  return {
    calls,
    event: {
      code: 'Tab',
      shiftKey: true,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      repeat: false,
      isComposing: false,
      keyCode: 9,
      target: makeElement({ conversation: true, sessionId: SESSION_ID }),
      preventDefault() {
        calls.preventDefault++;
      },
      stopPropagation() {
        calls.stopPropagation++;
      },
      ...options,
    },
  };
}

/** 让 void togglePlan(...) 的微任务结算完。 */
const flush = () => new Promise((resolve) => setImmediate(resolve));

const originalInfo = console.info;
const originalWarn = console.warn;
console.info = () => {};

// ── [1] 注册面 ───────────────────────────────────────────────────────────────
console.log('\n[1] 注册面');
eq(registration.id, 'dsh-quick-keys', '模块 id 与包名一致');
ok(Array.isArray(mod.inject), '导出 inject 数组');
for (const service of ['commandUi', 'shortcuts', 'locale', 'sessions', 'uiWorkspace', 'remote', 'remote.commands']) {
  ok(mod.inject.includes(service), `inject 声明了 ${service}`);
}
eq(diagnostics.version, '1.0.0', '诊断面带版本号');

const base = makeCtx();
mod.apply(base.ctx);

ok(base.seen.localeNs === 'quick-keys', '字典命名空间正确');
ok(typeof base.seen.dicts?.zh?.['command.new.label'] === 'string', 'zh 字典有命令标题');
ok(typeof base.seen.dicts?.en?.['command.new.label'] === 'string', 'en 字典有命令标题');
eq(base.seen.editableRegistrations, 0, '没有使用可编辑快捷键 register（Tab 会被拒）');
ok(
  windowListeners.some((row) => row.type === 'keydown' && row.capture === true),
  '在 window 捕获阶段装了 keydown 监听',
);
eq(diagnostics.loaded, true, '诊断面 loaded=true');
eq(diagnostics.mounted, true, 'apply() 后 mounted=true');
ok(typeof diagnostics.mountedAt === 'string', '记录 mountedAt');

// ── [2] /new 贡献 ────────────────────────────────────────────────────────────
console.log('\n[2] /new 命令贡献');
eq(base.seen.commands.length, 1, '只注册了一个命令贡献');
const command = base.seen.commands[0];
eq(command.name, 'new', '命令名是 new');
eq(command.label(), '新建对话', '菜单标题走 zh 字典');
eq(command.description(), '在当前工作区开启一个新会话', '菜单描述走 zh 字典');
eq(command.ui?.kind, 'action', '是 action 型（不提交内容、不发模型）');
ok(command.icon === fakePrimitives.IconNewChatOutlineRegular, '带上新建对话图标');
ok(command.available({ sessionId: SESSION_ID }) === true, '所有会话都可用');

base.seen.commands[0].ui.run({ sessionId: SESSION_ID });
eq(base.seen.sessionsStarted, 1, 'run() 调用了 uiWorkspace.startSession');
eq(base.seen.executes.length, 0, '/new 不发送任何命令给宿主');

// ── [3] 快捷键目录项 ────────────────────────────────────────────────────────
console.log('\n[3] 快捷键目录项');
eq(base.seen.fixed.length, 1, '注册了一个固定行');
const fixed = base.seen.fixed[0];
eq(fixed.id, 'quick.plan.toggle', '固定行 id');
eq(fixed.keys, ['⇧', 'Tab'], '展示按键');
eq(fixed.bindings, [{ code: 'Tab', modifiers: ['shift'] }], '物理组合是 Shift+Tab');
eq(fixed.group, 'application', '归在 application 组');
eq(fixed.label(), '切换计划模式', '固定行标题走 zh 字典');

// ── [4] 守卫矩阵 ────────────────────────────────────────────────────────────
console.log('\n[4] 守卫矩阵（应放行、不吞键）');
const blockedCases = [
  ['弹窗内', { target: makeElement({ modal: true, conversation: true, sessionId: SESSION_ID }) }, 'modal'],
  ['终端内', { target: makeElement({ terminal: true, conversation: true, sessionId: SESSION_ID }) }, 'terminal'],
  ['对话区外的输入框（侧边栏/重命名）', { target: makeElement({ main: true, editable: true }) }, 'outside-conversation'],
  ['侧边栏（非 main、非输入框）', { target: makeElement({}) }, 'outside-conversation'],
  ['没有元素目标', { target: null }, 'no-element-target'],
  ['长按重复', { repeat: true }, 'repeat'],
  ['输入法组合中', { isComposing: true }, 'composing'],
  ['输入法 keyCode 229', { keyCode: 229 }, 'composing'],
  ['同时按下 Ctrl', { ctrlKey: true }, 'extra-modifier'],
  ['同时按下 Alt', { altKey: true }, 'extra-modifier'],
  ['同时按下 Meta', { metaKey: true }, 'extra-modifier'],
  ['不带 Shift 的 Tab', { shiftKey: false }, 'no-shift'],
];

for (const [label, options, reason] of blockedCases) {
  const scene = makeCtx({ plan: { active: false, pending: false } });
  diagnostics.clear();
  mod.apply(scene.ctx);
  const { event, calls } = keydown(options);
  installedKeydown().handler(event);
  await flush();
  ok(
    scene.seen.executes.length === 0 && calls.preventDefault === 0 && calls.stopPropagation === 0,
    `${label}：不执行也不吞键`,
    `executes=${JSON.stringify(scene.seen.executes)} preventDefault=${calls.preventDefault}`,
  );
  eq(diagnostics.events.at(-1)?.decision, reason, `${label}：诊断记录的判定是 ${reason}`);
}

// 不是 Tab 键：连诊断都不记，避免噪音
{
  const scene = makeCtx();
  diagnostics.clear();
  mod.apply(scene.ctx);
  const before = diagnostics.events.length;
  installedKeydown().handler(keydown({ code: 'KeyA' }).event);
  await flush();
  eq(diagnostics.events.length, before, '非 Tab 按键不写诊断');
}

// 没有会话：DOM 上没有 session 属性，也没有 mainView 会话
{
  const scene = makeCtx({ row: { retainedBy: {} } });
  diagnostics.clear();
  mod.apply(scene.ctx);
  const { event, calls } = keydown({ target: makeElement({ composerSeat: true }) });
  installedKeydown().handler(event);
  await flush();
  ok(
    scene.seen.executes.length === 0 && calls.preventDefault === 0,
    '没有会话：不执行也不吞键',
    `executes=${JSON.stringify(scene.seen.executes)}`,
  );
  eq(diagnostics.events.at(-1)?.decision, 'no-session', '诊断记录的判定是 no-session');
}

// ── [5] 正常路径：进入 / 退出 ────────────────────────────────────────────────
console.log('\n[5] 切换计划模式');
for (const [label, plan, expected] of [
  ['未开启 → /plan', { active: false, pending: false }, '/plan'],
  ['已开启 → /plan off', { active: true, pending: false }, '/plan off'],
  ['排队中但未生效 → /plan', { active: false, pending: true }, '/plan'],
  ['排队中且已生效 → /plan off', { active: true, pending: true }, '/plan off'],
]) {
  const scene = makeCtx({ plan });
  diagnostics.clear();
  mod.apply(scene.ctx);
  const { event, calls } = keydown();
  installedKeydown().handler(event);
  await flush();
  eq(scene.seen.executes, [[SESSION_ID, expected, []]], `${label}：发给宿主 ${expected}`);
  ok(
    calls.preventDefault === 1 && calls.stopPropagation === 1,
    `${label}：preventDefault + stopPropagation（挡住 Lexical）`,
    `preventDefault=${calls.preventDefault} stopPropagation=${calls.stopPropagation}`,
  );
  eq(diagnostics.events.at(-1)?.decision, 'in-conversation', `${label}：判定 in-conversation`);
  eq(
    diagnostics.toggles.at(-1) !== undefined && diagnostics.toggles.at(-1).line === expected,
    true,
    `${label}：诊断记录了切换命令`,
  );
}

// 投影缺失（preset 没挂计划模式 / 基线未到）
{
  const scene = makeCtx();
  diagnostics.clear();
  mod.apply(scene.ctx);
  const { event } = keydown();
  installedKeydown().handler(event);
  await flush();
  eq(scene.seen.executes, [[SESSION_ID, '/plan', []]], '投影缺失时按未开启处理（发 /plan）');
}

// 只有 composer 座位标记（没有对话区属性）
{
  const scene = makeCtx({ plan: { active: true, pending: false } });
  diagnostics.clear();
  mod.apply(scene.ctx);
  const { event } = keydown({ target: makeElement({ composerSeat: true, composerInput: true, main: true }) });
  installedKeydown().handler(event);
  await flush();
  eq(scene.seen.executes, [[SESSION_ID, '/plan off', []]], '只有 composer 标记也能切换');
  eq(diagnostics.events.at(-1)?.decision, 'in-conversation', '判定 in-conversation');
}

// 兜底层：焦点在 main 里、不在输入控件上，且 DOM 上没有对话标记
{
  const scene = makeCtx({ plan: { active: false, pending: false } });
  diagnostics.clear();
  mod.apply(scene.ctx);
  const { event, calls } = keydown({ target: makeElement({ main: true }) });
  installedKeydown().handler(event);
  await flush();
  eq(scene.seen.executes, [[SESSION_ID, '/plan', []]], 'main-page 兜底层也会切换');
  eq(diagnostics.events.at(-1)?.decision, 'main-page', '判定 main-page');
  eq(calls.preventDefault, 1, '兜底层也吞键');
}

// ── [6] 失败兜底 ────────────────────────────────────────────────────────────
console.log('\n[6] 失败兜底（不得产生未捕获异常）');
const rejections = [];
process.on('unhandledRejection', (reason) => {
  rejections.push(reason);
});

async function expectWarning(scene, label, needle) {
  diagnostics.clear();
  mod.apply(scene.ctx);
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(' '));
  const { event } = keydown();
  installedKeydown().handler(event);
  await flush();
  console.warn = originalWarn;
  ok(
    warnings.some((line) => line.includes(needle)),
    label,
    warnings.join(' | '),
  );
}

await expectWarning(
  makeCtx({
    plan: { active: false, pending: false },
    execute: async () => ({ ok: false, error: { code: 'x' } }),
  }),
  'ok:false 时打警告',
  'plan toggle rejected',
);
eq(diagnostics.toggles.at(-1)?.ok, false, 'ok:false 写进诊断');
eq(diagnostics.toggles.at(-1)?.outcome, 'x', '诊断记录错误码');

await expectWarning(
  makeCtx({
    plan: { active: false, pending: false },
    execute: async () => {
      throw new Error('transport down');
    },
  }),
  'execute 抛错时被捕获并打警告',
  'plan toggle failed',
);
await expectWarning(
  makeCtx({ plan: { active: false, pending: false }, execute: async () => ({ ok: true, value: undefined }) }),
  '命令不存在时打警告',
  'unknown command',
);
eq(diagnostics.toggles.at(-1)?.outcome, 'unknown-command', '诊断记录 unknown-command');

await flush();
eq(rejections.length, 0, '没有未捕获的 Promise rejection');

// ── [7] 生命周期与诊断报告 ──────────────────────────────────────────────────
console.log('\n[7] 生命周期与诊断报告');
{
  const scene = makeCtx();
  const before = windowListeners.length;
  const uninstall = mod.__internals.installPlanToggle(scene.ctx);
  eq(windowListeners.length, before + 1, 'installPlanToggle 装了一个监听');
  uninstall();
  eq(windowListeners.length, before, '卸载后监听被移除（同函数、同捕获标记）');
}
{
  const scene = makeCtx({ plan: { active: false, pending: false } });
  diagnostics.clear();
  mod.apply(scene.ctx);
  installedKeydown().handler(keydown().event);
  await flush();
  const report = diagnostics.report();
  ok(typeof report === 'string' && report.includes('"mounted": true'), 'report() 输出含 mounted');
  ok(report.includes('in-conversation'), 'report() 输出含判定依据');
  ok(report.includes('/plan'), 'report() 输出含切换命令');
}

console.info = originalInfo;
console.log(failed === 0 ? '\n全部通过。' : `\n失败 ${failed} 项。`);
process.exit(failed === 0 ? 0 : 1);
