# 实现说明

面向改代码的人。用户文档在 [README](../README.md)。

## 为什么 `Shift+Tab` 不用「可编辑快捷键」

DSH 的快捷键协议把 `Tab` 归为保留键（`bindingIssue` 直接返回 `reserved`），
而且 Linux 浏览器下可编辑组合只允许三种（`Ctrl+/`、`Ctrl+Shift+,`、`Ctrl+Shift+.`，
其中 `Ctrl+/` 已被「快捷键面板」占用）。所以本插件自己装监听。

尽管如此，仍会 `registerFixed` 一个只读目录行，效果是：

- 它出现在 **设置 → 通用 → 快捷键** 里（`切换计划模式 ⇧ Tab`）并参与绑定冲突检查；
- 只是**不能改绑**（固定行不可编辑）。

### 改键步骤

两处必须同时改，否则「设置里显示的键」和「实际拦截的键」会不一致：

1. `client.js` 里 `registerFixed({ keys, bindings })` —— 展示与占用；
2. `client.js` 里 `decide()` 开头的按键判断（`isTabKey()`、`event.shiftKey` 等）—— 实际拦截。

## 为什么必须用 window 的捕获阶段

输入框不是 `textarea`，而是 **Lexical 的 contenteditable**。Lexical 在编辑器元素自己的
`keydown` 里先处理 `Tab` 并 `preventDefault`；产品自带的
`shortcuts.observeFixedInput` 跑在 `window` 的**冒泡**阶段，此时键已经被吃掉
（`event.defaultPrevented === true`）。捕获阶段在 Lexical 之前执行，才拦得住。

处理时同时调用 `preventDefault()` 和 `stopPropagation()`：前者挡浏览器默认行为，
后者挡 Lexical 对 `Tab` 的后续处理。没有真正处理按键时不调用这两个，保持原有行为。

## `inject` 必须同时声明 `remote` 和 `remote.commands`

读 `ctx.remote.commands` 先要能读 `ctx.remote`；cordis 对未 inject 的服务访问直接抛错，
而这个错会被插件自己的 `try/catch` 吞成一条 `console.warn`，表现就是「按了没反应」。
当初的原话：

```
Error: cannot get property "remote" without inject
```

官方 `@deepseek-ai/dsh-client-ui-plan` 也是两个都写。冒烟测试里的假 ctx 复刻了这条规则：
删掉任意一个 inject，`node smoke.mjs` 立刻失败，不用等浏览器。

## 按键判定分层

判定顺序就在 `client.js` 的 `decide()` 里，诊断报告的 `decision` 字段写的就是命中的那一层：

| 焦点位置 | 行为 | `decision` |
| --- | --- | --- |
| 对话作用域子树（`[data-conversation-session]`）/ composer 座位 | **处理** | `in-conversation` |
| `<main>` 里、但不在任何输入控件上 | **处理**（兜底层） | `main-page` |
| 弹窗内（`[data-shortcut-modal]`、`role="dialog"`+`aria-modal`） | 放行 | `modal` |
| 终端内（`.xterm`） | 放行 | `terminal` |
| 侧边栏、会话列表、对话区外的输入框 | 放行 | `outside-conversation` |

其余放行原因：`not-tab`、`no-shift`、`extra-modifier`、`repeat`、`composing`、
`no-element-target`、`no-session`。

`main-page` 是兜底层：即使将来对话区的 DOM 标记变了，只要焦点在主内容区且不在输入控件上，
按键仍然可用。

## 计划模式状态从哪来

读宿主的 `plan` 会话投影（`{ active, pending }`），切换动作发一条远端命令：

| 当前状态 | 发出的命令 |
| --- | --- |
| 未开启 / 投影缺失 | `/plan` |
| 已开启 | `/plan off` |
| 已排队但尚未生效 | `/plan`（宿主会取消反向排队） |

`pending` 时按**已生效**状态取反；投影缺失（agent preset 没挂计划模式，或基线未到）
按「未开启」处理。命令失败只在 console 打警告，不弹窗、不打断输入。

## 诊断面

插件在 `window` 上挂一个对象，只是观测，不改变行为：

```js
__DSH_QUICK_KEYS__.report()   // 打印并返回最近 12 次 Tab 判定 + 最近 6 次切换结果
__DSH_QUICK_KEYS__.clear()    // 清空后再复现，报告最干净
```

`report()` 的字段：

| 字段 | 说明 |
| --- | --- |
| `version` / `loaded` / `mounted` | 页面加载的是哪一版；`mounted:false` = bundle 到了但 `apply()` 没跑（服务缺失或抛错） |
| `lastTabKeydowns[].decision` | 判定结果，见上面的分层表 |
| `lastTabKeydowns[].target` / `in*` | 按键落在哪个元素；对话区 / composer / main / 弹窗 / 终端 / 输入控件的命中情况 |
| `lastToggles[]` | 实际发出的命令、`ok`、宿主返回的 `outcome`（`success` / 错误码 / `unknown-command`） |

**先按两下 Shift+Tab 再执行 `report()`**，否则 `lastTabKeydowns` 是空的。

排查顺序：`version` 不对 → 硬刷新；`mounted:false` → 看 cordis 服务是否齐；
`decision` 是放行原因 → 对照分层表；判定已是 `in-conversation` 但没生效 → 看 `lastToggles`。

## 冒烟测试覆盖什么

`node smoke.mjs`，92+ 断言，不需要浏览器、不联网、不写用户目录：

- `/new` 命令贡献的形状（name / label / description / icon / action 类型 / 调用 `startSession`）
- 快捷键目录行形状（id / keys / bindings / group）
- 守卫矩阵：弹窗、终端、对话区外输入框、侧边栏、无元素目标、长按、输入法、
  `Ctrl`/`Alt`/`Meta` 同按、无 Shift、非 Tab
- `in-conversation` / `main-page` / 回落 `mainView` 三条处理路径
- 进入（`/plan`）与退出（`/plan off`）分支、`pending` 两种取值、投影缺失
- `preventDefault` + `stopPropagation` 的吞键行为
- 失败兜底：`ok:false`、`execute` 抛错、命令不存在，均不得产生未捕获异常
- 卸载时 `removeEventListener` 用同一函数、同一捕获标记
- **假 ctx 复刻 cordis 的 inject 规则**：访问未声明的服务直接抛错

## 文件职责

| 文件 | 作用 |
| --- | --- |
| `index.js` | 宿主空壳 `apply()`：只为让本包成为 Loader 条目、暴露客户端 bundle |
| `cordis.patch.yml` | 把插件插入 profile 的 Loader |
| `client.js` | 浏览器半侧：`/new` 命令贡献 + `Shift+Tab` 捕获阶段监听（手写 `__ModuleLoader__` 包） |
| `locale/*.json` | 插件管理页显示的标题与说明 |
| `smoke.mjs` | 离线冒烟 |
