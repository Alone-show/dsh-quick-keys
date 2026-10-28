/**
 * dsh-quick-keys 的浏览器半侧，手写 __ModuleLoader__ 包（不经 tsdown 构建）。
 *
 * 提供两个能力：
 *
 *   1. `/new` —— 客户端命令贡献（commandUi 的 action 型）。选中或输入 `/new` +
 *      Enter 后直接在浏览器侧开一个新会话：不提交任何内容、不产生对话轮次、
 *      不进会话日志，等价于侧边栏「新建会话」/ 桌面端 Ctrl+N。
 *
 *   2. `Shift+Tab` —— 切换计划模式。Tab 在快捷键协议里是保留键
 *      （bindingIssue 直接判 reserved），Linux Web 的可编辑绑定更只剩
 *      Ctrl+/、Ctrl+Shift+,、Ctrl+Shift+. 三种组合，所以这里自己装监听：
 *
 *      - 用 window 的**捕获阶段**（冒泡阶段拿到的键可能已被 Lexical 处理并
 *        preventDefault；捕获阶段在它之前）。
 *      - 拦截判定分层：对话区 / composer 座位 → 直接处理；焦点在 <main> 里
 *        且不在输入控件上 → 也处理；其余（侧边栏、弹窗、终端、对话区外的
 *        输入框）一律放行。
 *
 * 诊断面：本文件在 window 上挂一个 `window.__DSH_QUICK_KEYS__`，记录最近
 * 几次 Tab 按键的判定依据和切换结果。Shift+Tab 不生效时，在控制台执行
 * `__DSH_QUICK_KEYS__.report()` 就能看出是"没装上""被哪个守卫判掉"
 * 还是"命令发出去但失败了"。
 */
window.__ModuleLoader__.load({
  id: 'dsh-quick-keys',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    /** 本插件版本；诊断报告里会带上，用来确认页面加载的是哪一份 bundle。 */
    const VERSION = '1.0.0';

    /** 本插件字典命名空间。 */
    const NS = 'quick-keys';

    const zh = {
      'command.new.label': '新建对话',
      'command.new.description': '在当前工作区开启一个新会话',
      'shortcut.plan.label': '切换计划模式',
    };

    const en = {
      'command.new.label': 'New chat',
      'command.new.description': 'Start a new conversation in this workspace',
      'shortcut.plan.label': 'Toggle plan mode',
    };

    /** 图标是可选装饰：取不到就不给，命令菜单会忽略。 */
    let primitives = {};
    try {
      primitives = require('@deepseek-ai/dsh-client-ui-primitives') || {};
    } catch (error) {
      console.warn('[dsh-quick-keys] UI primitives unavailable, /new will render without an icon:', error);
    }

    /** 进入计划模式（无参数）与退出计划模式（off）。 */
    const PLAN_ON = '/plan';
    const PLAN_OFF = '/plan off';

    /** 对话作用域根节点；有会话时属性值就是 sessionId。 */
    const CONVERSATION_SCOPE = '[data-conversation-session]';
    /** 属性名（从上面的选择器里剥出来，读 DOM 时用）。 */
    const CONVERSATION_SESSION_ATTRIBUTE = 'data-conversation-session';
    /** 无会话时 composer 的座位（仍在对话区内）。 */
    const COMPOSER_SEAT = '[data-composer-seat]';
    /** composer 的输入框本体（Lexical contenteditable）。 */
    const COMPOSER_INPUT = '[data-composer-input]';
    /** 主内容区：对话、消息列表都在里面；侧边栏/顶栏不在。 */
    const MAIN_SELECTOR = 'main';
    /** 模态层：弹窗里的 Shift+Tab 要留给浏览器做反向聚焦。 */
    const MODAL_SELECTOR = '[data-shortcut-modal], [role="dialog"][aria-modal="true"]';
    /** 终端面板：那里的 Shift+Tab 归终端自己。 */
    const TERMINAL_SELECTOR = '.xterm';
    /** 输入控件：对话区外的输入框不抢键。 */
    const EDITABLE_SELECTOR =
      'input, textarea, select, [contenteditable="true"], [contenteditable=""], [role="textbox"]';

    /**
     * 需要的客户端服务；缺失时 cordis 不会 apply 本插件（不会注册半套东西）。
     *
     * 注意 `remote` 与 `remote.commands` 必须**同时**声明：读 `ctx.remote.commands`
     * 先要能读 `ctx.remote`，cordis 对未 inject 的服务访问直接抛
     * `cannot get property "remote" without inject`。官方 ui-plan 也是两个都写。
     */
    const inject = [
      'commandUi',
      'shortcuts',
      'locale',
      'sessions',
      'uiWorkspace',
      'remote',
      'remote.commands',
    ];

    // ── 诊断面 ────────────────────────────────────────────────────────────────
    /** 最近按键条数上限，够定位问题又不至于刷屏。 */
    const EVENT_LIMIT = 12;
    const TOGGLE_LIMIT = 6;

    const diagnostics = {
      version: VERSION,
      /** 模块被 materialize（bundle 到达浏览器并执行）即为 true。 */
      loaded: true,
      /** apply() 跑完即为 true；false 说明插件没挂上（服务缺失或 apply 抛错）。 */
      mounted: false,
      mountedAt: null,
      events: [],
      toggles: [],
      /**
       * 把最近观测打成一个可复制的字符串。
       * @returns {string} 诊断报告。
       */
      report() {
        const text = JSON.stringify(
          {
            version: this.version,
            loaded: this.loaded,
            mounted: this.mounted,
            mountedAt: this.mountedAt,
            lastTabKeydowns: this.events,
            lastToggles: this.toggles,
          },
          null,
          2,
        );
        console.log('[dsh-quick-keys] report\n' + text);
        return text;
      },
      /** 清空观测。 */
      clear() {
        this.events.length = 0;
        this.toggles.length = 0;
      },
    };
    try {
      window.__DSH_QUICK_KEYS__ = diagnostics;
    } catch (error) {
      /* 极老环境挂不上就算了，不影响功能 */
    }

    /**
     * 只记精简的 DOM 描述，避免把整个元素塞进报告。
     * @param {unknown} target 事件目标。
     * @returns {string} 例如 `div data-composer-input="" contenteditable="true"`。
     */
    function describeTarget(target) {
      if (target === null || target === undefined) return 'null';
      if (typeof target !== 'object' || typeof target.tagName !== 'string') return typeof target;
      const parts = [String(target.tagName).toLowerCase()];
      for (const attribute of [
        'data-composer-input',
        'data-composer-seat',
        'data-conversation-region',
        'data-conversation-session',
        'data-shortcut-modal',
        'role',
        'contenteditable',
        'aria-modal',
      ]) {
        if (typeof target.getAttribute === 'function') {
          const value = target.getAttribute(attribute);
          if (value !== null) parts.push(value === '' ? attribute : `${attribute}="${value}"`);
        }
      }
      return parts.join(' ');
    }

    /**
     * 是不是 Tab 键。除了物理 code，也认 key 文案（部分 X11/GTK 组合把
     * Shift+Tab 报成 ISO_Left_Tab，code 偶尔为空）。
     * @param {KeyboardEvent} event keydown 事件。
     * @returns {boolean} 是否 Tab。
     */
    function isTabKey(event) {
      return event.code === 'Tab' || event.key === 'Tab' || event.key === 'ISO_Left_Tab';
    }

    /**
     * 取事件真正落在的元素：优先 composedPath()[0]（跨 portal / 将来若用 shadow
     * DOM 也能拿到真实节点），退回 event.target。
     * @param {KeyboardEvent} event keydown 事件。
     * @returns {Element | null} 目标元素。
     */
    function eventElement(event) {
      if (typeof event.composedPath === 'function') {
        const path = event.composedPath();
        for (const node of path) {
          if (node !== null && typeof node === 'object' && typeof node.closest === 'function') return node;
        }
      }
      const target = event.target;
      return target !== null && typeof target === 'object' && typeof target.closest === 'function' ? target : null;
    }

    /**
     * 当前正在看的会话：产品内既有写法，看主视图的本地引用计数。
     * @param {object} ctx 客户端根 context。
     * @returns {string | undefined} 会话 id。
     */
    function currentSessionId(ctx) {
      const list = ctx.sessions.list.getSnapshot();
      const row = Object.values(list.byId).find((entry) => (entry.retainedBy.mainView ?? 0) > 0);
      return row === undefined ? undefined : row.id;
    }

    /**
     * 读一个会话的计划模式投影。能力缺失（该 preset 没挂计划模式，或基线未到）
     * 时返回 undefined，调用方按「未开启」处理。
     * @param {object} ctx 客户端根 context。
     * @param {string} sessionId 会话 id。
     * @returns {{ active: boolean, pending: boolean } | undefined} 投影值。
     */
    function planState(ctx, sessionId) {
      const list = ctx.sessions.list.getSnapshot();
      return list.projectionsBySession[sessionId]?.values.plan;
    }

    /**
     * 用一条远端命令切换计划模式。失败只落 console，不弹窗、不打断输入。
     * @param {object} ctx 客户端根 context。
     * @param {string} sessionId 目标会话。
     * @param {boolean} active 当前是否已处于计划模式。
     * @returns {Promise<void>} 结算完成。
     */
    async function togglePlan(ctx, sessionId, active) {
      const line = active ? PLAN_OFF : PLAN_ON;
      const record = { line, sessionId, ok: null, outcome: null };
      diagnostics.toggles.push(record);
      if (diagnostics.toggles.length > TOGGLE_LIMIT) diagnostics.toggles.shift();
      try {
        const result = await ctx.remote.commands.execute(sessionId, line, []);
        if (!result || result.ok !== true) {
          record.ok = false;
          record.outcome = result && result.error ? result.error.code : 'rejected';
          console.warn('[dsh-quick-keys] plan toggle rejected:', line, result && result.error);
          return;
        }
        if (result.value === undefined) {
          record.ok = false;
          record.outcome = 'unknown-command';
          console.warn(`[dsh-quick-keys] unknown command: ${line}（当前会话的 agent preset 可能没挂计划模式）`);
          return;
        }
        record.ok = true;
        record.outcome = result.value.kind;
      } catch (error) {
        record.ok = false;
        record.outcome = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        console.warn('[dsh-quick-keys] plan toggle failed:', error);
      }
    }

    /**
     * 判定一次 keydown 要不要由本插件接管，并把判定依据记进诊断。
     *
     * @param {KeyboardEvent} event 原始 keydown。
     * @param {object} ctx 客户端根 context。
     * @returns {{ handle: boolean, reason: string, sessionId?: string }} 判定结果。
     */
    function decide(event, ctx) {
      const facts = {
        code: event.code,
        key: event.key,
        shift: event.shiftKey === true,
        ctrl: event.ctrlKey === true,
        alt: event.altKey === true,
        meta: event.metaKey === true,
        repeat: event.repeat === true,
        composing: event.isComposing === true,
        keyCode: event.keyCode,
        defaultPrevented: event.defaultPrevented === true,
        target: describeTarget(eventElement(event)),
      };
      const finish = (handle, reason, sessionId) => {
        const decision = { handle, reason, facts };
        if (sessionId !== undefined) decision.sessionId = sessionId;
        diagnostics.events.push({ decision: reason, ...facts, ...(sessionId === undefined ? {} : { sessionId }) });
        if (diagnostics.events.length > EVENT_LIMIT) diagnostics.events.shift();
        return decision;
      };

      if (!isTabKey(event)) return finish(false, 'not-tab');
      if (!facts.shift) return finish(false, 'no-shift');
      if (facts.ctrl || facts.alt || facts.meta) return finish(false, 'extra-modifier');
      if (facts.repeat) return finish(false, 'repeat');
      if (facts.composing || event.keyCode === 229) return finish(false, 'composing');

      const element = eventElement(event);
      if (element === null) return finish(false, 'no-element-target');

      const inTerminal = element.closest(TERMINAL_SELECTOR) !== null;
      const inModal = element.closest(MODAL_SELECTOR) !== null;
      const inConversation = element.closest(CONVERSATION_SCOPE) !== null;
      const inComposer = element.closest(COMPOSER_SEAT) !== null || element.closest(COMPOSER_INPUT) !== null;
      const inMain = element.closest(MAIN_SELECTOR) !== null;
      const editable = element.closest(EDITABLE_SELECTOR) !== null;
      Object.assign(facts, { inTerminal, inModal, inConversation, inComposer, inMain, editable });

      if (inTerminal) return finish(false, 'terminal');
      if (inModal) return finish(false, 'modal');

      const scope = element.closest(CONVERSATION_SCOPE);
      const attribute = scope === null ? null : scope.getAttribute(CONVERSATION_SESSION_ATTRIBUTE);
      const sessionId =
        typeof attribute === 'string' && attribute !== '' ? attribute : currentSessionId(ctx);
      if (sessionId === undefined) return finish(false, 'no-session');

      if (inComposer || inConversation) return finish(true, 'in-conversation', sessionId);
      // 兜底：焦点在主内容区、且不在任何输入控件上（例如消息列表/顶栏被点过）。
      // 这样即使将来对话区的 DOM 标记变了，Shift+Tab 仍然可用。
      if (inMain && !editable) return finish(true, 'main-page', sessionId);
      return finish(false, 'outside-conversation');
    }

    /**
     * 装/卸 window 捕获阶段的 Shift+Tab 监听。
     * @param {object} ctx 客户端根 context。
     * @returns {() => void} 卸载函数。
     */
    function installPlanToggle(ctx) {
      const onKeyDown = (event) => {
        if (!isTabKey(event)) return;
        const decision = decide(event, ctx);
        if (!decision.handle) return;
        // 到这一步才吞键：preventDefault 挡住浏览器默认，stopPropagation 挡住
        // Lexical 对 Tab 的处理（否则它还会再动一次焦点/文本）。
        event.preventDefault();
        event.stopPropagation();
        const plan = planState(ctx, decision.sessionId);
        void togglePlan(ctx, decision.sessionId, plan !== undefined && plan.active === true);
      };
      window.addEventListener('keydown', onKeyDown, true);
      return () => {
        window.removeEventListener('keydown', onKeyDown, true);
      };
    }

    /**
     * 注册 /new 命令与 Shift+Tab 输入监听。
     * @param {object} ctx 客户端根 context。
     */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'quick-keys: 字典');
      const t = ctx.locale.bind(NS);

      // ── /new ────────────────────────────────────────────────────────────────
      ctx.effect(
        () =>
          ctx.commandUi.register({
            name: 'new',
            label: () => t('command.new.label'),
            description: () => t('command.new.description'),
            icon: primitives.IconNewChatOutlineRegular,
            // 会话永远有 agent 支撑，且新建会话不依赖当前会话的任何状态。
            available: () => true,
            ui: {
              kind: 'action',
              run: () => {
                try {
                  ctx.uiWorkspace.startSession();
                } catch (error) {
                  console.warn('[dsh-quick-keys] starting a new session failed:', error);
                }
              },
            },
          }),
        'quick-keys: /new',
      );

      // ── Shift+Tab 切换计划模式 ──────────────────────────────────────────────
      // 目录行：只让它在 设置 → 通用 → 快捷键 里可见、并参与绑定冲突检查。
      ctx.effect(
        () =>
          ctx.shortcuts.registerFixed({
            id: 'quick.plan.toggle',
            label: () => t('shortcut.plan.label'),
            keys: ['⇧', 'Tab'],
            bindings: [{ code: 'Tab', modifiers: ['shift'] }],
            group: 'application',
          }),
        'quick-keys: 计划切换快捷键目录项',
      );

      // 实际按键处理：自己装捕获阶段监听（见文件头注释）。
      ctx.effect(() => installPlanToggle(ctx), 'quick-keys: 计划切换输入');

      diagnostics.mounted = true;
      diagnostics.mountedAt = new Date().toISOString();
      console.info(`[dsh-quick-keys] v${VERSION} ready: /new + Shift+Tab`);
    }

    /** 离线冒烟用的内部函数（不参与运行时契约）。 */
    exports.__internals = {
      VERSION,
      diagnostics,
      decide,
      isTabKey,
      installPlanToggle,
      currentSessionId,
      planState,
      togglePlan,
      PLAN_ON,
      PLAN_OFF,
      SELECTORS: {
        conversation: CONVERSATION_SCOPE,
        composerSeat: COMPOSER_SEAT,
        composerInput: COMPOSER_INPUT,
        main: MAIN_SELECTOR,
        modal: MODAL_SELECTOR,
        terminal: TERMINAL_SELECTOR,
        editable: EDITABLE_SELECTOR,
      },
    };
    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
