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

## 安装

安装已经通过审核的 Codex Marketplace 插件：

```bash
npx codex-marketplace add GxFn/codex-lark-remote/plugins/codex-lark-remote --plugin
```

如果要固定到当前审核版本：

```bash
npx codex-marketplace add https://github.com/GxFn/codex-lark-remote/tree/v0.1.24/plugins/codex-lark-remote --plugin
```

如果 Codex 要求填写 GitHub Target 或直接 artifact path，请填写：

```text
https://github.com/GxFn/codex-lark-remote/tree/v0.1.24/plugins/codex-lark-remote
```

如果 Codex 弹窗把来源、Git 引用、稀疏路径拆开填写，请这样填：

```text
来源：
https://github.com/GxFn/codex-lark-remote.git

Git 引用：
v0.1.24

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
5. 在“事件订阅”里选择长连接/WebSocket，并订阅 `im.message.receive_v1`。
6. 按平台提示启用消息接收和回复权限，然后发布或启用应用。

把配置粘贴到可信的本地 Codex 对话里：

```text
请配置 codex-lark-remote。

飞书应用：
- appId: cli_xxx
- appSecret: xxx

允许使用者：
- allowedUsers: ["ou_xxx"]

请用这些值调用 codex_lark_configure，然后运行 codex_lark_check_auth。
```

私密配置会写到仓库外：

```text
~/.codex-lark-remote/config.json
```

如果还不知道自己的 sender id，可以先让 `allowedUsers` 为空，从飞书/Lark 向机器人
发送 `/codex whoami`，再把返回的 `senderId` 加入配置。

缺少 `appId` 或 `appSecret` 时，bridge 不会启动。

## 启动接管

在你想从飞书/Lark 继续的 Codex 对话里说：

```text
启动 codex-lark-remote。
```

Codex 必须先请求你的明确同意，才会启动接管。确认后，插件只会把当前 Codex 线程的
本地路由状态写入本地 bridge；已有聊天历史不会发送到飞书/Lark。

接管会严格绑定当前 Codex 窗口。插件只使用 Codex 工具调用里提供的精确 thread id
或 session path；如果没有这些按窗口区分的元数据，接管会直接阻止，不会再按工作
目录猜测最近窗口。

之后直接给飞书/Lark 机器人发送普通消息即可，它会继续同一个 Codex 对话。

在 macOS 上，接管还会启动 `caffeinate -dimsu`，让屏幕可以熄灭但 Mac 保持唤醒。
关闭接管或停止 bridge 时，这个 keep-awake 进程会一起停止。

常用命令：

```text
/codex whoami
/codex status
/codex observe
/codex observe <序号|thread 前缀>
/codex observe off
/codex commands on
/codex commands off
/codex handoff off
```

“断开连接”“停止接管”这类口语请求也会被处理。

## 观察其他 Codex 会话

观察是只读串流，和接管分开。`/codex observe` 会列出可观察的 Codex 会话；
`/codex observe <序号>` 或 `/codex observe <thread 前缀>` 会把选中的会话进度
串流到飞书/Lark。飞书/Lark 消息不会发送进被观察的会话。使用
`/codex observe off` 停止观察。

## 飞书/Lark 输出

远程回复会针对手机和聊天场景做优化：

- 进度消息不再额外显示 `Codex progress` 标题。
- 普通进度回复不展示内部 task id。
- 长回复会拆成多条飞书/Lark 消息。
- 普通命令和 `Output:` 默认不展示。
- 需要查看命令时，可以发送 `/codex commands on` 或“打开命令显示”。
  发送 `/codex commands off` 或“关闭命令显示”可再次隐藏。
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

`/codex status` 显示 `websocket disabled`：

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
