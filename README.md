# 运行监控（dsh-run-monitor）

DSH Web 界面插件。在左侧栏底部加一个「运行监控」入口，点开是一个贴着侧栏的浮窗，把**当前工作区里的会话任务**按状态分三组列出来：**待回复 / 已完成 / 执行中**。点任意一条直接跳到那个对话。

## 它解决什么

同时开几个会话时，哪些在跑、哪些在等你回答、哪些刚跑完还没看，原本只能靠翻侧栏历史判断。这个插件把这三类集中到一个浮窗里，并在状态发生变化时通知你——不用盯着某个会话也能知道它需要你了。

## 功能

**状态分组**

| 分组 | 判定 |
| --- | --- |
| 待回复 | 轮次未结束，且最后一个事件是提问类工具调用（如 `ask_user_question`） |
| 执行中 | 轮次已开始、尚未结束 |
| 已完成 | 轮次已结束；只列**完成但未读**的（读过即从列表消失） |

- 每条任务以 **目录徽标 + 标题** 呈现，徽标是任务所属工作区（优先取工作区标题，其次取路径末段），按工作区分组一目了然。
- 子代理（subagent）会话不纳入监控——它们是主任务的内部步骤，混进来只会淹没真正的任务。
- 「已完成」的清空依据是 shell 的 `completionUnread` 状态投影，不是本地的“点过没点过”，所以换个标签页、重开页面结果一致。

**侧栏气泡**

入口按钮右侧按状态显示数量：待回复（黄）、执行中（绿）、已完成（蓝）。窄栏（56px 图标栏）只显示最紧急的一个。气泡与浮窗共用同一份判据，两边数字不会打架。

**通知**

- 只在状态**发生变化**时触发，首次看到不响。
- 页面在前台且有输入时：用贴在入口上方的**内部气泡**提醒，3 秒自动消失，点一下跳转。
- 窗口失焦、被切走，或闲置超过 30 秒：发**系统通知**，点击会聚焦窗口并跳转。
- 浮窗顶部两个开关可分别关掉内部 / 外部通知；每个开关旁边有「测试」按钮，用来验证该通道是否可用。

## 安装

```bash
# 用 DSH 的插件管理器安装（推荐）
plugin_manager: install_bundle  target: <本目录绝对路径>
```

插件以 bundle 形式被 profile 引用（`cordis.patch.yml` 里插入一条 `dsh-run-monitor` 条目），源码留在这个目录里，不需要编译、没有第三方依赖。

**改了代码怎么生效**：先把已安装的 bundle 移除，再重新安装同一目录——版本号不同时客户端才会重新拉取 bundle，所以改动后记得 bump `package.json` 的 `version`。

```bash
plugin_manager: remove_bundle  target: dsh-run-monitor
plugin_manager: install_bundle target: <本目录绝对路径>
```

装完刷新页面即可。

## 结构

```
dsh-run-monitor/
├── index.js            Host 半：注册 /run-monitor/api/list，推导任务状态
├── client.js           客户端半：侧栏入口、浮窗、通知、样式
├── cordis.patch.yml    插入 bundle 的 patch
├── icon.svg            侧栏图标
├── package.json        dsh.bundle / dsh.client 清单
├── .gitattributes      固定 LF
└── .gitignore
```

**Host 半**（`index.js`）导出 `inject = ['webServer', 'sessions']`，用 `ctx.webServer.register` 注册只读路由 `GET /run-monitor/api/list`，返回：

```json
{ "ok": true, "now": 1700000000000,
  "tasks": [ { "id": "session-…", "title": "…", "state": "running",
               "group": { "label": "项目名", "path": "D:\\work\\项目名" },
               "lastActivity": "…", "createdAt": 0, "updatedAt": 0 } ] }
```

状态从会话事件流尾部推导：向后找最近的 `turn/start` 或 `turn/end` 确定轮次开合（窗口不够就成倍放大，上限 8000 条），再看最后几个事件里是否有未结算的提问类工具调用。工作区归属来自 `workspaceRegistry`。列表最多返回 200 条，按最近活动排序。

**客户端半**（`client.js`）通过模块加载器注册三个挂载点：

- `sidebar.footer.action` —— 侧栏底部入口按钮；
- `shell.overlay` —— 浮窗本体（点击外部或按 Esc 关闭，窗口缩放时重新吸附）；
- `shell.overlay`（另一个 id）—— 内部通知气泡。

浮窗打开时每 4 秒刷新一次，关闭时每 20 秒刷新一次用于更新气泡数字。

## 兼容性与样式

- 样式只使用宿主主题令牌（`--dsw-alias-*`、`--dsw-specific-*`），明暗主题切换自动跟随；不写死颜色。
- 文案按宿主 locale 服务注册中英文，未取到字典时回退中文。
- 系统通知的 tag 用 FNV-1a 把会话 id 压到 32 位并拼接事件时间戳，控制在 32 字符内——Windows 会静默丢弃超过 64 字符的 tag，通知根本不弹。

## 已知限制

- 只统计**活着的会话**（Host 侧 `sessions.list()`），已归档或进程重启前的会话不在列表里。
- 状态是轮询推导的，不是事件订阅，因此存在最多 4 秒（浮窗打开）/ 20 秒（关闭时）的延迟。
- 系统通知需要浏览器授权；未授权时该通道自动退回内部气泡。
