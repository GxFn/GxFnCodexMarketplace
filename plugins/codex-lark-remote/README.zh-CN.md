# Lark Remote

从飞书/Lark 继续当前 Codex 对话。

English version: [README.md](README.md)

Marketplace 页面：[codex-lark-remote](https://www.codex-marketplace.com/plugins/codex-lark-remote)

这份 README 会随可安装的 Codex 插件包一起发布。仓库首页也保留了一份完整的首次安装说明。

## 默认流程

Lark Remote 只围绕一个默认流程设计：从当前 Codex 对话启动，明确同意接管，
然后从飞书/Lark 继续同一个对话。

飞书/Lark 消息会作为普通用户消息交给 Codex。机器人会把最终回答和执行过程中的关键
进度发回飞书/Lark。

## 先从控制台开始

飞书/Lark 侧最重要的入口是自然语言控制台。bridge 连上后，发送 `控制台`，
或点击启动卡片里的“控制台”。

在控制台里直接说短口令即可：

```text
控制台
项目列表
会话列表
进入项目 1
观察会话 2
接管 1
```

接管某个 Codex 会话后，飞书会话会进入任务直通模式。后续普通消息会直接发送给
目标 Codex 会话，作为新任务或补充指令处理，不再判断项目/会话操作。

需要临时回到外层控制台时，说“控制台”或“跳出接管”。需要结束当前接管但保持
飞书连接时，说“退出接管”。需要真正停止本机 bridge 并断开飞书连接时，说
“关闭飞书连接”，机器人会先发确认卡片。

## 日常使用流程

1. 安装插件，并完成一次飞书/Lark 应用配置。
2. 在想远程继续的 Codex 对话里启动 Lark Remote。
3. 在飞书/Lark 进入控制台，选择项目和会话。
4. 接管会话，然后直接发送普通开发需求。
5. 需要切换项目或会话时，再发送“控制台”。

## 安装

安装已经通过审核的 Codex Marketplace 插件：

```bash
npx codex-marketplace add GxFn/codex-lark-remote/plugins/codex-lark-remote --plugin
```

如果要固定到当前审核版本：

```bash
npx codex-marketplace add https://github.com/GxFn/codex-lark-remote/tree/v0.2.1/plugins/codex-lark-remote --plugin
```

如果 Codex 要求填写 GitHub Target 或直接 artifact path，请填写：

```text
https://github.com/GxFn/codex-lark-remote/tree/v0.2.1/plugins/codex-lark-remote
```

如果 Codex 弹窗把来源、Git 引用、稀疏路径拆开填写，请这样填：

```text
来源：
https://github.com/GxFn/codex-lark-remote.git

Git 引用：
v0.2.1

稀疏路径：
plugins/codex-lark-remote
```

安装后在插件列表里启用 `codex-lark-remote`。

如果要添加整个 `gxfn` 仓库 marketplace，而不是只安装这个插件，可以使用仓库根目录
并让稀疏路径留空。只有在明确想使用未发布改动时，才使用 `main`。

## 配置飞书/Lark

创建飞书/Lark 应用：

1. 打开 [飞书开放平台](https://open.feishu.cn/) 或
   [Lark Open Platform](https://open.larksuite.com/)。
2. 创建企业自建应用/内部应用。
3. 启用机器人能力。
4. 在“凭证与基础信息”里复制 **App ID** 和 **App Secret**。
5. 在“事件订阅”里选择长连接/WebSocket，并订阅 `im.message.receive_v1`
   和 `card.action.trigger`。
6. 在“回调配置”里保持“使用长连接接收回调”。如果改用 webhook，再配置
   `/bridge/lark/event` 作为回调地址，并同步 verification token / encrypt key。
7. 按平台提示启用消息接收、发送/回复消息、卡片交互回调权限，然后发布或启用应用。

启动介绍卡片和窗口接管按钮都依赖 `card.action.trigger`。如果文本消息正常但按钮无响应，
检查应用是否已发布、事件订阅是否包含 `card.action.trigger`、回调配置是否仍为长连接，
以及权限变更后是否重新发布。

把配置粘贴到可信的本地 Codex 对话里：

```text
请配置 codex-lark-remote。

飞书应用：
- appId: cli_xxx
- appSecret: xxx

允许使用者：
- allowedUsers: ["ou_xxx"]

可选接管参数：
- takeover: { projectLimit: 20, selectionTtlMs: 600000 }

可选启动介绍：
- startup: { receiveId: "oc_xxx", receiveIdType: "chat_id", once: true }

请用这些值调用 codex_lark_configure，然后运行 codex_lark_check_auth。
```

私密配置会写到仓库外：

```text
~/.codex-lark-remote/config.json
```

如果还不知道自己的 sender id，可以先让 `allowedUsers` 为空，从飞书/Lark 向机器人
发送 `whoami`，再把返回的 `senderId` 加入配置。

`startup.receiveId` 是可选的主动推送目标。配置后，bridge 首次连上飞书或激活
handoff 时会向这个会话推送一张启动介绍卡片；未配置时，第一条已授权飞书消息
到达后会用当前 `chat_id` 补发一次，并把这个会话记为后续启动的默认推送目标。
卡片发送失败时会降级为文本介绍。已发送状态和最近会话记录在
`~/.codex-lark-remote/startup-notice.json`，调试时可把 `startup.once` 设为
`false`。

缺少 `appId` 或 `appSecret` 时，bridge 不会启动。

## 从 Codex 启动

在你想从飞书/Lark 继续的 Codex 对话里说：

```text
启动 codex-lark-remote。
```

Codex 必须先请求你的明确同意，才会启动接管。确认后，插件只会把当前 Codex 线程的
本地路由状态写入本地 bridge；已有聊天历史不会发送到飞书/Lark。

接管会严格绑定当前 Codex 会话/窗口。插件只使用 Codex 工具调用里提供的精确 thread id
或 session path；如果没有这些按会话区分的元数据，接管会直接阻止，不会再按工作
目录猜测最近会话。

在 macOS 上，接管还会启动 `caffeinate -dimsu`，让屏幕可以熄灭但 Mac 保持唤醒。
关闭接管或停止 bridge 时，这个 keep-awake 进程会一起停止。

## 从飞书接管 Codex 项目和会话

飞书/Lark 端通过 `takeover` 或 `windows` 自主选择目标。全项目接管
要求必须配置 `lark.allowedUsers`；如果 allowlist 为空，机器人会拒绝列出项目或执行
接管。机器人会先回复本机 Codex 项目列表，进入某个项目后再展示项目内会话/窗口：
会话列表不会排除启动飞书接管的会话。这里基于本机 Codex session 记录，不是 macOS
窗口句柄枚举。“观察”进入只读串流，“接管”会先确认再执行 handoff。如果卡片不可用，可以回复
`1`、`2`、`3` 先选项目、再选会话，最后发送 `takeover now`。仍显示为活跃的会话会等
空闲后自动接管。

## 观察其他 Codex 会话

观察是只读串流，和接管分开。`observe` 会列出可观察的 Codex 会话；
`observe <序号>` 或 `observe <thread 前缀>` 会把选中的会话进度
串流到飞书/Lark。飞书/Lark 消息不会发送进被观察的会话。使用
`observe off` 停止观察。

## 飞书/Lark 输出

远程回复会针对手机和聊天场景做优化：

- 进度消息不再额外显示 `Codex progress` 标题。
- 普通进度回复不展示内部 task id。
- 长回复会拆成多条飞书/Lark 消息。
- 普通命令和 `Output:` 默认不展示。
- 需要查看命令时，可以发送 `commands on` 或“打开命令显示”。
  发送 `commands off` 或“关闭命令显示”可再次隐藏。
- 潜在风险命令始终会显示，并额外带 `Warning:`，即使命令显示处于关闭状态。
- 打开命令显示后，命令 `Output:` 仍只保留一行高价值摘要，省略时附带行数和字符数。
- `cat`、`nl`、`sed`、`grep`、普通 `rg` 搜索这类源码查看输出会被摘要化。
- 命令里的 token、secret、password 等敏感内容会先脱敏。

## 权限边界

Lark Remote 接管的是对话输入输出链路，不是 Codex Desktop 的原生 UI。
飞书/Lark 不能点击权限弹窗、MCP 审批、沙箱提权、联网/安装依赖审批，或其他
Codex 原生 UI 弹窗。

当 Codex 遇到这类边界时，bridge 和 prompt 契约会要求 agent 不要沉默等待，而是
发回一条明确的飞书/Lark 提示：说明需要什么权限，以及你是必须回到 Mac 上的 Codex
Desktop 批准，还是可以在飞书/Lark 里用文字明确授权后继续。

## 执行中的补充引导

如果 Codex 仍在执行时你又发了一条飞书/Lark 消息，插件不会尝试把文本热注入已经
运行中的 Codex 进程。它会把这条消息保存为同一个 handoff 线程的补充引导，在飞书
/Lark 里回复“已收到”，并在当前轮结束后立即作为下一轮继续执行。

## Mac 保持唤醒

默认启用：

```json
{
  "handoff": {
    "keepAwake": true,
    "keepAwakeCommand": "caffeinate",
    "keepAwakeArgs": ["-dimsu"]
  }
}
```

如果要关闭，可以在 `~/.codex-lark-remote/config.json` 里把 `handoff.keepAwake`
设为 `false`。这个功能只在 macOS 上运行。

## 排查

当前没有 `codex_lark_*` 工具：

说明这个 Codex 对话没有加载插件 MCP server。刷新或重新启用插件后，新开一个 Codex
对话再启动。正常启动不应该退回到本地脚本。

`status` 显示 `websocket disabled`：

检查 `~/.codex-lark-remote/config.json`，确认已经存在 `appId` 和 `appSecret`。

同一条飞书/Lark 消息收到两次回复：

停止旧 bridge 进程或重复插件安装，然后重新启动接管。

Codex 改到了插件缓存目录：

请从目标项目所在的 Codex 对话里启动接管。

## 本地开发

把这个仓库注册为 local marketplace：

```toml
[marketplaces.gxfn]
source_type = "local"
source = "/absolute/path/to/codex-lark-remote"

[plugins."codex-lark-remote@gxfn"]
enabled = true
```

运行测试：

```text
npm test
```
