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
| 已完成 | 轮次已结束、且**没有仍在运行的子任务**；只列完成但未读的（读过即从列表消失） |

- 每条任务以 **目录徽标 + 标题** 呈现，徽标是任务所属工作区（优先取工作区标题，其次取路径末段），按工作区分组一目了然。
- 子代理（subagent）会话不纳入监控——它们是主任务的内部步骤，混进来只会淹没真正的任务。
- 但主会话是在**等子任务**还是真的干完了，靠子代理是否还在跑区分：主轮次已结束而子代理仍在运行，该任务保持「执行中」，副标题显示「子任务运行中」，不会提前报完成。
- 「已完成」的清空依据是 shell 的 `completionUnread` 状态投影，不是本地的“点过没点过”，所以换个标签页、重开页面结果一致。

**侧栏气泡**

入口按钮右侧按状态显示数量：待回复（红）、执行中（黄）、已完成（蓝）。窄栏（56px 图标栏）只显示最紧急的一个。气泡与浮窗共用同一份判据，两边数字不会打架。

**通知**

- 只在状态**发生变化**时触发，首次看到不响。
- 页面在前台且有输入时：用贴在入口上方的**内部气泡**提醒，3 秒自动消失，点一下跳转。
- 窗口失焦、被切走，或闲置超过 30 秒：发**系统通知**，点击会聚焦窗口并跳转。
- 系统通知的标题带状态前缀，形如 `【已完成】<任务名>` / `【待回复】<任务名>`，正文给目录与提问摘要。
- 浮窗顶部两个开关可分别关掉内部 / 外部通知；每个开关旁边有「测试」按钮，用来验证该通道是否可用。

## 安装

直接从 GitHub 安装（源码即产物，不需要编译，也没有第三方依赖）：

```bash
# 安装默认分支
dsh plugin --profile desktop add github:Yven/dsh-run-monitor

# 或显式指定分支 / tag / commit 来锁定版本（例如某次 commit）
dsh plugin --profile desktop add github:Yven/dsh-run-monitor#main
```

`dsh plugin` 会把包转发给 profile 目录里的 pnpm 安装，成功后把 `dsh-run-monitor` 登记进 profile 的 `dsh.profile.bundles`——正是这一步让插件真正生效。装完刷新页面即可。

**升级**：把 `#` 后面换成新的 tag / commit 再执行一次即可替换；仓库一旦打了 release tag，就可以用 `#v0.2.14` 这种写法锁版本。客户端 bundle 按版本号拉取，所以版本号没变时浏览器会继续用缓存。

**本地开发**：也可以直接从工作目录安装，改完先移除再装同一目录：

```bash
plugin_manager: remove_bundle  target: dsh-run-monitor
plugin_manager: install_bundle target: <本目录绝对路径>
```

改动后记得 bump `package.json` 的 `version`，否则客户端不会重新拉取 bundle。

## 结构

```
dsh-run-monitor/
├── index.js            Host 半：注册 /run-monitor/api/list，推导任务状态
├── client.js           客户端半：侧栏入口、浮窗、通知、样式
├── cordis.patch.yml    插入 bundle 的 patch
├── icon.svg            侧栏图标
├── package.json        dsh.bundle / dsh.client 清单
├── LICENSE             MIT 许可
├── .gitattributes      固定 LF
└── .gitignore
```

**Host 半**（`index.js`）导出 `inject = ['webServer', 'sessions']`，用 `ctx.webServer.register` 注册两个只读路由：`GET /run-monitor/api/list` 返回快照，`GET /run-monitor/api/stream` 是变化推送流。列表返回：

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

侧栏气泡与浮窗由 Host 的推送驱动：`/run-monitor/api/stream` 是一条 server-sent events 流，Host 监听 `session/event`、`agent/status`、`session/created|disposed` 等内核事件，把一串事件按 250ms 合并成一次「有变化」的推送（不带数据，状态仍由 `/list` 现算）；客户端收到后 120ms 防抖刷新一次快照。流断开时浏览器自动重连，重连后立刻补一次刷新；拿不到推送的环境退回轮询（浮窗打开 15 秒、关闭 60 秒）作为保底。

## 兼容性与样式

- 样式只使用宿主主题令牌（`--dsw-alias-*`、`--dsw-specific-*`），明暗主题切换自动跟随；不写死颜色。
- 文案按宿主 locale 服务注册中英文，未取到字典时回退中文。
- 系统通知的 tag 用 FNV-1a 把会话 id 压到 32 位并拼接事件时间戳，控制在 32 字符内——Windows 会静默丢弃超过 64 字符的 tag，通知根本不弹。

## 已知限制

- 只统计**活着的会话**（Host 侧 `sessions.list()`），已归档或进程重启前的会话不在列表里。
- 状态由事件推送驱动，正常情况下变化后约 0.3 秒可见；推送不可用时退回轮询，最坏 15 秒 / 60 秒。
- 系统通知需要浏览器授权；未授权时该通道自动退回内部气泡。
