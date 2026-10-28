/**
 * dsh-quick-keys 的宿主半侧：纯 UI 插件，没有宿主行为。
 *
 * 空 apply() 的存在只为两件事：
 *   1. 让 profile 的 cordis.patch.yml 能把本包插进 Loader（插件要作为条目存在）；
 *   2. 让 dsh-client-modules 在扫 Loader 条目时读到 package.json 的
 *      `dsh.client` 声明，从而把 exports["./client"] 下发给浏览器。
 *
 * 所有行为都在 client.js：/new 命令贡献 + Shift+Tab 固定输入。
 */

/** 宿主插件体：无宿主侧行为。 */
export function apply() {}
