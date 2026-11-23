// dsh-workspace-hide-empty —— 宿主半。
//
// 这是一个纯浏览器半插件：宿主侧不需要注册路由、工具或后台任务。
// 真正的行为在 lib/client.js（页面启动后按三条规则隐藏空工作区行）。
// 这里只保留一个空的 cordis 插件定义，让 Loader 行能正常挂载、不产生副作用。
export const name = 'dsh-workspace-hide-empty'
export const inject = []

/** Host half is intentionally a no-op. */
export function apply() {}
