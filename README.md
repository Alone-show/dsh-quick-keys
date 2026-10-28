# dsh-quick-keys

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）的输入框加两个操作：

1. **`/new`** —— 敲 `/` 打开命令菜单，选「新建对话」（或直接输入 `/new` 回车）即可开一个新会话。
   等价于侧边栏「新建会话」/ 桌面端 `Ctrl+N`：**不给模型发任何东西、不产生对话轮次、不进会话日志**，
   也不碰原会话的草稿和附件。
2. **`Shift+Tab`** —— 在对话区按一下开关计划模式，效果等同输入 `/plan`、或点输入框上方
   「计划」chip 上的关闭按钮。

在 DSH `0.2.1-rc.2` 的 Web 客户端上开发和验证。

## 安装

推荐用 DSH 的插件管理器（会同时写 `dependencies` 与 `dsh.profile.bundles` 并热激活）：

- **GUI**：设置 → 插件 → 安装 → 填 git 链接：

  ```
  github:Alone-show/dsh-quick-keys
  ```

- **让 agent 装**：`plugin_manager` 工具 `install_bundle`，target 同上；
- **CLI**：`dsh plugin --profile web add github:Alone-show/dsh-quick-keys`
  （只写依赖，需要自己补 `dsh.profile.bundles`，见下）

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

`Shift+Tab` 只在**对话区**生效：弹窗、终端、侧边栏、对话区外的输入框（比如重命名框）里，
它仍然是浏览器原本的「反向聚焦」，插件不会拦。

## 排错

`Shift+Tab` 没反应时，在浏览器控制台执行下面这行，把输出贴进 issue 即可：

```js
__DSH_QUICK_KEYS__.report()   // 先按两下 Shift+Tab 再执行，报告才有内容
```

它包含当前加载的插件版本、最近几次按键是否被接管、以及实际发出的命令和宿主返回结果。
字段含义与排查思路见 [docs/DEVELOPMENT.md](https://github.com/Alone-show/dsh-quick-keys/blob/main/docs/DEVELOPMENT.md#诊断面)。

如果 `__DSH_QUICK_KEYS__` 是 `undefined`，说明页面还是旧 bundle —— 硬刷新一次。

## 卸载

- GUI：设置 → 插件 → 找到「快捷按键」→ 卸载（等价于 `plugin_manager` 的 `remove_bundle`）；
- 手工：从 profile 的 `dependencies` 与 `dsh.profile.bundles` 里删掉 `dsh-quick-keys`，
  `pnpm install`，刷新页面。

## 开发

```bash
node smoke.mjs     # 离线冒烟，不需要浏览器、不联网
```

浏览器半侧是手写的 `__ModuleLoader__` 包（`client.js`），没有构建步骤；宿主半侧 `index.js`
是空壳，只为让本包成为 Loader 条目并暴露客户端 bundle。

```
index.js           宿主空壳 apply()
cordis.patch.yml   把插件插入 profile 的 Loader
client.js          浏览器半侧：/new 命令贡献 + Shift+Tab 按键监听
locale/*.json      插件管理页显示的标题与说明
smoke.mjs          离线冒烟
docs/              实现说明（为什么这么写、怎么改键、诊断字段）
```

**实现细节都写在 [docs/DEVELOPMENT.md](https://github.com/Alone-show/dsh-quick-keys/blob/main/docs/DEVELOPMENT.md)**
——包括按键为什么这么处理、按键判定的范围、怎么改绑按键，以及诊断字段的含义。
改代码前建议先看一遍，那里记着三个踩过的坑。

## License

MIT
