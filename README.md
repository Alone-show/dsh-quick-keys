# dsh-quick-keys

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）加两个小能力：

1. **`/new` 命令** —— 输入框敲 `/`，命令菜单里出现「新建对话」；选中或输入 `/new` 回车，
   当场在当前工作区开一个新会话。等价于侧边栏「新建会话」/ 桌面端 `Ctrl+N`：
   **不提交任何内容、不产生对话轮次、不进会话日志**，也不碰原会话的草稿和附件。
2. **`Shift+Tab` 切换计划模式** —— 在对话区按一下开关计划模式，效果和输入 `/plan`、
   点「计划」chip 上的关闭按钮完全一致（走同一条 `/plan` / `/plan off` 命令）。

在 DSH `0.2.1-rc.2`（Web / Linux）上开发和验证。

## 安装

推荐用 DSH 的插件管理器（会同时写 `dependencies` 与 `dsh.profile.bundles` 并热激活）：

- **GUI**：设置 → 插件 → 安装 → 填 git 链接：

  ```
  github:Alone-show/dsh-quick-keys
  ```

- **让 agent 装**：`plugin_manager` 工具 `install_bundle`，target 同上；
- **CLI**（只写依赖，需要自己补 bundles，见下）：

  ```bash
  dsh plugin --profile web add github:Alone-show/dsh-quick-keys
  ```

装完刷新一次页面。想锁版本可以用标签，例如
`github:Alone-show/dsh-quick-keys#v1.0.0`。

> `dsh plugin --profile web ...` 只是把参数原样转发给 pnpm，**不会**写
> `dsh.profile.bundles`；所以推荐用 GUI / 插件管理器安装，或按下面手工补全。

手工等价操作：

1. profile（`$DSH_HOME/profiles/web/package.json`）的 `dependencies` 加
   `"dsh-quick-keys": "github:Alone-show/dsh-quick-keys"`；
2. 同文件的 `dsh.profile.bundles` 里追加 `"dsh-quick-keys"`；
3. 在 profile 目录执行 `pnpm install`；
4. 刷新 GUI（若宿主提示 `restart-required`，重启 `dsh web` 后再刷新）。

## 用法

| 操作 | 效果 |
| --- | --- |
| `/` 菜单选「新建对话」，或输入 `/new` + 回车 | 开一个新会话 |
| 对话输入框里按 `Shift+Tab` | 计划模式开 / 关（输入框上方出现或消失「计划」chip） |

`Shift+Tab` 只在**对话区**生效：弹窗、终端、侧边栏、对话区外的输入框（如重命名框）
里它是浏览器原本的「反向聚焦」，插件不会吞掉。

## 为什么 Shift+Tab 不在「可编辑快捷键」里

DSH 的快捷键协议把 `Tab` 归为保留键（`bindingIssue` 直接返回 `reserved`），
而且 Linux 浏览器下只允许三种可编辑组合（`Ctrl+/`、`Ctrl+Shift+,`、`Ctrl+Shift+.`）。
所以本插件自己装监听，并且有两个必须注意的实现细节：

- **必须用 window 的捕获阶段**：输入框是 Lexical 的 contenteditable，Lexical 在
  编辑器元素上先处理 `Tab` 并 `preventDefault`；产品自带的
  `shortcuts.observeFixedInput` 跑在冒泡阶段，此时键已经被吃掉了。
- **`inject` 要同时声明 `remote` 和 `remote.commands`**：读 `ctx.remote.commands`
  先要能读 `ctx.remote`，cordis 对未 inject 的服务访问直接抛
  `cannot get property "remote" without inject`。

仍然会 `registerFixed` 一个只读目录行，所以它出现在 **设置 → 通用 → 快捷键**
里（`切换计划模式 ⇧ Tab`）并参与绑定冲突检查，只是不能改绑。
想换键：改 `client.js` 里 `registerFixed` 的 `keys` / `bindings`（展示与占用）与
`decide()` 里的按键判断（实际拦截），刷新页面即可。

## 拦截分层

判定顺序就在 `client.js` 的 `decide()` 里，诊断报告会写明命中的是哪一层：

| 焦点位置 | 行为 |
| --- | --- |
| `[data-conversation-session]` 子树 / composer 座位 | **处理**（`in-conversation`）|
| `<main>` 里、但不在任何输入控件上 | **处理**（`main-page`，兜底层）|
| 弹窗内 / 终端内 | 放行 |
| 侧边栏、会话列表、对话区外的输入框 | 放行 |

没有真正处理按键时，插件不会 `preventDefault` / `stopPropagation`；处理时两个都会调用。

## 计划模式状态从哪来

读宿主的 `plan` 会话投影（`{ active, pending }`），切换动作发一条远端命令：

| 当前状态 | 发出的命令 |
| --- | --- |
| 未开启 / 投影缺失 | `/plan` |
| 已开启 | `/plan off` |
| 已排队但尚未生效 | `/plan`（宿主会取消反向排队） |

`pending` 时按**已生效**状态取反；投影缺失（agent preset 没挂计划模式，或基线未到）
按「未开启」处理。命令失败只在浏览器 console 打警告，不弹窗、不打断输入。

## 排错

页面加载后控制台里有 `window.__DSH_QUICK_KEYS__`（旧别名 `__DSH_QUICK_ACTIONS__` 也指向同一对象）：

```js
__DSH_QUICK_KEYS__.report()   // 打印并返回最近 12 次 Tab 判定 + 最近 6 次切换结果
__DSH_QUICK_KEYS__.clear()    // 清空后再复现，报告最干净
```

**先按两下 Shift+Tab 再执行**，否则 `lastTabKeydowns` 是空的。关键字段：

| 字段 | 说明 |
| --- | --- |
| `version` / `loaded` / `mounted` | 页面加载的是哪一版；`mounted:false` = bundle 到了但 `apply()` 没跑 |
| `lastTabKeydowns[].decision` | `in-conversation` / `main-page` = 已接管；其余是放行原因 |
| `lastTabKeydowns[].target` / `.in*` | 按键落在哪个元素、对话区 / composer / main 的命中情况 |
| `lastToggles[]` | 实际发出的命令、`ok`、宿主返回的 `outcome` |

如果 `report` 是 `undefined`，说明页面还是旧 bundle —— 硬刷新。

## 卸载

- GUI：设置 → 插件 → 找到「快捷按键」→ 卸载（等价于 `plugin_manager` 的 `remove_bundle`）；
- 手工：从 profile 的 `dependencies` 与 `dsh.profile.bundles` 里删掉 `dsh-quick-keys`，
  `pnpm install`，刷新页面。

## 开发

```bash
node smoke.mjs
```

离线冒烟（不需要浏览器、不联网）：`/new` 贡献形状、快捷键目录行形状、守卫矩阵、
`/plan` 与 `/plan off` 分支、吞键行为、卸载清理、失败兜底，以及一个**模拟 cordis
inject 规则**的假 ctx —— 少声明一个 inject 就会在这里失败，而不是等到浏览器里。

浏览器半侧是手写的 `__ModuleLoader__` 包（`client.js`），没有构建步骤；
宿主半侧 `index.js` 是空壳，只为让本包成为 Loader 条目并暴露客户端 bundle。

```
index.js           宿主空壳 apply()
cordis.patch.yml   把插件插入 profile 的 Loader
client.js          浏览器半侧：/new 命令贡献 + Shift+Tab 捕获阶段监听
locale/*.json      插件管理页显示的标题与说明
smoke.mjs          离线冒烟
```

## License

MIT
