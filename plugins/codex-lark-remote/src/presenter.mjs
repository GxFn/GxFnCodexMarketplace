import { truncateForLark } from "./notifier.mjs";
import {
  CONSOLE_COMMAND_EXAMPLES,
  CONTROL_COMMAND_MEANING_DESCRIPTION,
  HANDOFF_DIRECT_MODE_DESCRIPTION,
} from "./control-semantics.mjs";

export function formatHelp() {
  return [
    "Codex Lark Remote",
    "",
    "可以直接发送普通需求继续当前 Codex 对话。",
    "控制台: 发送“控制台”进入项目/会话控制；接管后普通消息会直通目标会话。",
    "口语控制: 状态, 我是谁, 项目列表, 会话列表, 观察列表, 退出接管.",
    "任务控制: status rcmd_..., diff rcmd_..., cancel rcmd_..., approve rcmd_... test.",
    "whoami",
    "status",
    "windows",
    "takeover status",
    "takeover off",
    "关闭飞书连接",
    "observe",
    "observe <number|thread-prefix>",
    "observe off",
    "commands on|off",
    "handoff off",
  ].join("\n");
}

export function formatStartupIntro() {
  return [
    "Codex 已经连上飞书了。",
    "",
    "外层是自然语言控制台，可以直接理解你的意图，不需要加命令前缀。",
    "这里管理的是本机 Codex 会话记录；“窗口”只作为会话的口语叫法。",
    "",
    "没有接管时，可以直接说：",
    "- 看看有哪些项目",
    "- 进入第 1 个项目",
    "- 观察第 2 个会话",
    "- 接管第 2 个会话",
    "",
    "接管后会切到任务直通模式，普通消息只会作为对话任务发给被接管的 Codex 会话，不再解析项目/会话操作。",
    "要临时回到外层自然语言控制台，发送“控制台”或“跳出接管”；要结束当前接管并留在控制台，发送“退出接管”。",
    "",
    "兜底命令：",
    "status",
    "windows",
    "observe",
    "whoami",
    "handoff off",
    "关闭飞书连接",
  ].join("\n");
}

export function formatConsoleModeIntro() {
  return [
    "已进入外层自然语言控制台。",
    "",
    `可以直接说：${CONSOLE_COMMAND_EXAMPLES}。`,
    HANDOFF_DIRECT_MODE_DESCRIPTION,
    CONTROL_COMMAND_MEANING_DESCRIPTION,
  ].join("\n");
}

export function buildStartupIntroCard() {
  return baseCard({
    title: "Codex 已连接飞书",
    elements: [
      {
        tag: "markdown",
        content: [
          "**外层是自然语言控制台，会先理解你的操作意图。**",
          "",
          "这里管理的是本机 Codex 会话记录；`窗口` 只是会话的口语叫法。",
          "没有接管时，可以直接说 `看看有哪些项目`、`进入第 1 个项目`、`观察第 2 个会话`、`接管第 2 个会话`。",
          "接管后会切到任务直通模式：普通消息只作为对话任务发给目标 Codex 会话，不再解析项目/会话操作。",
          "要临时回到外层自然语言控制台，发送 `控制台` 或 `跳出接管`；要结束当前接管并留在控制台，发送 `退出接管`。",
          "要真正断开飞书连接并停止本机 bridge，发送 `关闭飞书连接`；会先出现确认卡。",
          "按钮只是快捷入口。兜底命令: `status`、`windows`、`observe`、`whoami`、`handoff off`、`关闭飞书连接`。",
        ].join("\n"),
      },
      {
        tag: "action",
        actions: [
          startupButton("状态", "startup_status", "primary"),
          startupButton("进入控制台", "startup_console", "default"),
          startupButton("项目/会话", "startup_windows", "default"),
          startupButton("观察列表", "startup_observe", "default"),
          startupButton("我的身份", "startup_whoami", "default"),
          startupButton("关闭连接", "bridge_stop_prompt", "danger"),
        ],
      },
    ],
  });
}

export function buildConsoleModeCard() {
  return baseCard({
    title: "自然语言控制台",
    elements: [
      {
        tag: "markdown",
        content: [
          "**已进入外层自然语言控制台。**",
          "",
          `直接说：${CONSOLE_COMMAND_EXAMPLES}。`,
          HANDOFF_DIRECT_MODE_DESCRIPTION,
          CONTROL_COMMAND_MEANING_DESCRIPTION,
        ].join("\n"),
      },
      {
        tag: "action",
        actions: [
          startupButton("状态", "startup_status", "primary"),
          startupButton("项目/会话", "startup_windows", "default"),
          startupButton("观察", "startup_observe", "default"),
          startupButton("关闭连接", "bridge_stop_prompt", "danger"),
        ],
      },
    ],
  });
}

export function formatHandoffDisabled() {
  return [
    "已退出当前接管，飞书连接仍然保持。",
    "",
    "后续普通消息会回到外层自然语言控制台，先理解项目/会话操作意图；不会再直通刚才的 Codex 会话。",
    "可以直接说：项目列表、会话列表、观察第 2 个会话、接管第 2 个会话。",
    "如果只是临时跳回控制台、不结束接管，用“控制台”或“跳出接管”。",
  ].join("\n");
}

export function buildHandoffDisabledCard() {
  return baseCard({
    title: "已退出当前接管",
    elements: [
      {
        tag: "markdown",
        content: [
          "**飞书连接仍然保持。**",
          "",
          "这次只结束了当前 Codex 会话的接管关系，并回到外层自然语言控制台。",
          "后续普通消息会先理解项目/会话操作意图，不会再直通刚才的 Codex 会话。",
          "如果只是临时跳回控制台、不结束接管，用 `控制台` 或 `跳出接管`。",
        ].join("\n"),
      },
      {
        tag: "action",
        actions: [
          startupButton("项目/会话", "startup_windows", "primary"),
          startupButton("观察列表", "startup_observe", "default"),
          startupButton("状态", "startup_status", "default"),
        ],
      },
    ],
  });
}

export function formatBridgeStopConfirm() {
  return [
    "确认关闭飞书连接？",
    "",
    "这会停止本机 Codex Lark Remote bridge，并断开飞书 WebSocket。",
    "关闭后，飞书里的普通消息不会再进入 Codex；需要回到 Codex 里重新启动插件才能恢复。",
    "如果只是退出当前会话接管，请发送“退出接管”。",
  ].join("\n");
}

export function buildBridgeStopConfirmCard() {
  return baseCard({
    title: "确认关闭飞书连接",
    elements: [
      {
        tag: "markdown",
        content: [
          "**这会停止本机 bridge，并断开飞书 WebSocket。**",
          "",
          "关闭后，飞书里的普通消息不会再进入 Codex；需要回到 Codex 里重新启动插件才能恢复。",
          "如果只是退出当前会话接管，请发送 `退出接管`。",
        ].join("\n"),
      },
      {
        tag: "action",
        actions: [
          startupButton("确认关闭连接", "bridge_stop_execute", "danger"),
          startupButton("取消", "bridge_stop_cancel", "default"),
        ],
      },
    ],
  });
}

export function formatBridgeStopping() {
  return [
    "正在关闭飞书连接。",
    "本机 Codex Lark Remote bridge 和飞书 WebSocket 会停止；之后需要在 Codex 里重新启动插件。",
  ].join("\n");
}

export function formatBridgeStopCancelled() {
  return "已取消关闭连接。飞书连接仍然保持。";
}

export function formatWhoami(event) {
  return [
    "Codex Lark Remote whoami",
    `senderIdType: ${event.senderIdType || "unknown"}`,
    `senderId: ${event.senderId || "unknown"}`,
    event.openId && event.openId !== event.senderId ? `openId: ${event.openId}` : "",
    event.unionId ? `unionId: ${event.unionId}` : "",
    `userHash: ${event.userIdHash || "-"}`,
    "",
    "Add senderId to lark.allowedUsers.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatBridgeStatus({ config, counts, workerBusy, url, larkWs, handoff, observation, takeover, keepAwake }) {
  const transport = config.lark?.transport || "websocket";
  return [
    "Codex Lark Remote status",
    `Bridge: ${url || "running"}`,
    `Feishu/Lark: ${formatLarkTransport({ transport, larkWs })}`,
    `Conversation: ${formatHandoffState(handoff)}`,
    `Observation: ${formatObservationState(observation)}`,
    `Takeover: ${formatTakeoverState(takeover)}`,
    `Command display: ${formatCommandDisplay(config.handoff?.showCommands)}`,
    `Mac keep-awake: ${formatKeepAwake(keepAwake)}`,
    `Pending replies: ${formatCounts(counts)}`,
    `Codex worker: ${workerBusy ? "busy" : "idle"}`,
  ].join("\n");
}

export function formatObservationList(targets = [], observation = null) {
  if (!targets.length) return "没有找到可观察的 Codex 会话。";
  return [
    "可观察的 Codex 会话",
    ...targets.map((thread, index) => [
      `${index + 1}. ${thread.name || "Untitled Codex chat"}`,
      `   线程: ${String(thread.threadId).slice(0, 8)}`,
      thread.cwd ? `   目录: ${thread.cwd}` : "",
      thread.updatedAtMs ? `   更新: ${new Date(thread.updatedAtMs).toLocaleString()}` : "",
    ].filter(Boolean).join("\n")),
    "",
    "回复 observe <序号或线程前缀> 可以观察某个会话。",
    observation?.active ? "回复 observe off 可以停止当前观察。" : "",
  ].filter(Boolean).join("\n");
}

export function formatObservationStatus(observation) {
  if (!observation?.active) return "Codex Lark Remote 观察：已关闭";
  return [
    "Codex Lark Remote 观察：已开启",
    observation.name ? `标题: ${observation.name}` : "",
    `线程: ${String(observation.threadId || "").slice(0, 8) || "unknown"}`,
    observation.cwd ? `目录: ${observation.cwd}` : "",
    "这是只读进度串流，飞书消息不会发送到被观察的会话。",
    "回复 observe off 可以停止观察。",
  ].filter(Boolean).join("\n");
}

export function formatTakeoverList(targets = [], options = {}) {
  if (!targets.length) return "没有找到可接管的 Codex 会话。";
  return [
    "当前项目的 Codex 会话",
    options.cwd ? `项目: ${options.cwd}` : "",
    "这里只显示该项目下的 Codex 会话记录，包括启动飞书接管的会话；它不是 macOS 窗口枚举。",
    ...targets.map((target, index) => [
      `${index + 1}. [${formatWindowStatus(target.status)}] ${target.name || "未命名 Codex 对话"}`,
      `   线程: ${String(target.threadId || "").slice(0, 8)}`,
      target.cwd ? `   目录: ${target.cwd}` : "",
      target.updatedAtMs ? `   更新: ${new Date(target.updatedAtMs).toLocaleString()}` : "",
    ].filter(Boolean).join("\n")),
    "",
    "回复 1、2、3 可以选择会话；回复 takeover now 可以接管已选择会话。",
  ].join("\n");
}

export function formatTakeoverProjectList(projects = []) {
  if (!projects.length) return "没有找到可接管的 Codex 项目。";
  return [
    "可接管项目",
    "这里来自本机全部 Codex 会话记录。只有 lark.allowedUsers 中的飞书用户可以继续操作。",
    ...projects.map((project, index) => [
      `${index + 1}. ${project.name || "未知项目"}`,
      `   目录: ${project.cwd}`,
      `   会话: ${project.windowCount || 0}`,
      project.latestWindowName ? `   最近会话: ${project.latestWindowName}` : "",
      project.updatedAtMs ? `   更新: ${new Date(project.updatedAtMs).toLocaleString()}` : "",
    ].filter(Boolean).join("\n")),
    "",
    "回复 1、2、3 进入项目，再选择窗口观察或接管。",
  ].join("\n");
}

export function formatTakeoverStatus(takeover) {
  if (!takeover) return "Codex 会话接管：已关闭";
  const target = takeover.target || {};
  return [
    `Codex 会话接管：${formatTakeoverStateLabel(takeover.state)}`,
    target.threadId ? `线程: ${String(target.threadId).slice(0, 8)}` : "",
    target.name ? `标题: ${target.name}` : "",
    target.cwd ? `目录: ${target.cwd}` : "",
    target.status ? `会话状态: ${formatWindowStatus(target.status)}` : "",
    takeover.pendingInputs?.length ? `待发送消息: ${takeover.pendingInputs.length}` : "",
  ].filter(Boolean).join("\n");
}

export function formatTakeoverSelected(target) {
  if (!target) return "还没有选择 Codex 会话。";
  return [
    `已选择会话: ${target.name || "未命名 Codex 对话"}`,
    `状态: ${formatWindowStatus(target.status)}`,
    `线程: ${String(target.threadId || "").slice(0, 8) || "unknown"}`,
    target.cwd ? `目录: ${target.cwd}` : "",
    target.updatedAtMs ? `更新: ${new Date(target.updatedAtMs).toLocaleString()}` : "",
    "",
    "可回复 takeover now 接管，observe 只读观察，list 返回会话列表。",
  ].filter(Boolean).join("\n");
}

export function formatTakeoverPending(target) {
  return [
    `接管等待中，目标线程 ${String(target?.threadId || "").slice(0, 8) || "unknown"}。`,
    "目标 Codex 会话仍显示为活跃，我会在它空闲后自动接管。",
    "你现在发送的消息会暂存，并在接管生效后送达。",
  ].join("\n");
}

export function formatTakeoverActive(target) {
  return [
    `接管已生效，目标线程 ${String(target?.threadId || "").slice(0, 8) || "unknown"}。`,
    "现在直接发送普通飞书消息，就会继续这个 Codex 对话。",
    "发送“控制台”可临时回到项目/会话控制台；发送“退出接管”会结束当前接管，但不会断开飞书连接。",
  ].join("\n");
}

export function formatPendingTakeoverInputQueued(state) {
  return [
    "已暂存这条消息。",
    "目标 Codex 会话仍显示为活跃；接管生效后，我会把暂存消息作为第一条输入送达。",
    state?.pendingInputs?.length ? `待发送消息: ${state.pendingInputs.length}` : "",
  ].filter(Boolean).join("\n");
}

export function buildTakeoverListCard(targets = [], options = {}) {
  const projectElements = options.cwd
    ? [{ tag: "markdown", content: `**当前项目**\n${escapeCardText(options.cwd)}\n\n这里只显示该项目下的 Codex 会话记录，包括启动飞书接管的会话；不是 macOS 窗口枚举。` }, { tag: "hr" }]
    : [];
  return baseCard({
    title: "当前项目的 Codex 会话",
    elements: targets.length ? [
      ...projectElements,
      ...targets.flatMap((target, index) => targetCardElements(target, index + 1)),
    ] : [
      ...projectElements,
      { tag: "markdown", content: "没有找到可接管的 Codex 会话。" },
    ],
  });
}

export function buildTakeoverProjectListCard(projects = []) {
  return baseCard({
    title: "可接管项目",
    elements: projects.length ? [
      {
        tag: "markdown",
        content: "这些项目来自本机 Codex 会话记录。只有 `lark.allowedUsers` 中的飞书用户可以进入项目、观察会话或接管会话。",
      },
      { tag: "hr" },
      ...projects.flatMap((project, index) => projectCardElements(project, index + 1)),
    ] : [
      { tag: "markdown", content: "没有找到可接管的 Codex 项目。" },
    ],
  });
}

export function buildTakeoverSelectedCard(target) {
  return baseCard({
    title: "Codex 会话",
    elements: [
      { tag: "markdown", content: takeoverTargetMarkdown(target) },
      {
        tag: "action",
        actions: [
          cardButton("观察", "takeover_observe", target, "default"),
          cardButton("接管", "takeover_confirm", target, "primary"),
        ],
      },
    ],
  });
}

export function buildTakeoverConfirmCard(target) {
  return baseCard({
    title: "确认接管",
    elements: [
      { tag: "markdown", content: `${takeoverTargetMarkdown(target)}\n\n确认后，飞书后续消息会路由到这个 Codex 线程。` },
      {
        tag: "action",
        actions: [
          cardButton("确认接管", "takeover_execute", target, "danger"),
          cardButton("取消", "takeover_cancel", target, "default"),
        ],
      },
    ],
  });
}

export function formatTask(command) {
  if (!command) return "Task not found.";
  return [
    `Task: ${command.id}`,
    `Status: ${command.status}`,
    command.mode === "thread_handoff" ? "Conversation: current Codex chat" : "",
    command.presentation ? `Presentation: ${command.presentation}` : "",
    command.codexSessionId ? `Thread: ${command.codexSessionId}` : "",
    command.mode === "thread_handoff" ? "" : `Repo: ${command.repoKey || "-"}`,
    command.branchName ? `Branch: ${command.branchName}` : "",
    command.worktreePath ? `Worktree: ${command.worktreePath}` : "",
    command.diffSummary ? `Diff:\n${command.diffSummary}` : "",
    command.testSummary ? `Validation:\n${command.testSummary}` : "",
    command.progressSummary ? `Agent progress:\n${truncateForLark(command.progressSummary, 1200)}` : "",
    command.error ? `Error:\n${command.error}` : "",
    command.lastNotifyError ? `Last notify error:\n${command.lastNotifyError}` : "",
    command.result ? `Result:\n${truncateForLark(command.result, 1200)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatQueued(command) {
  if (command.mode === "thread_handoff") {
    return [
      "Codex received your message.",
      "Status: queued",
      "",
      `Request: ${truncateForLark(command.normalizedTask || command.prompt, 500)}`,
    ].join("\n");
  }
  return [
    `Task created: ${command.id}`,
    `Repo: ${command.repoKey}`,
    "Status: queued",
    "",
    `Request: ${truncateForLark(command.normalizedTask || command.prompt, 500)}`,
  ].join("\n");
}

export function formatGuidanceQueued(command) {
  return [
    "已收到补充引导。",
    "当前 Codex 还在执行时，无法稳定热注入这条消息；我会在当前轮结束后立刻把它作为下一条引导继续同一个对话。",
    "",
    `补充: ${truncateForLark(command.normalizedTask || command.prompt, 500)}`,
  ].join("\n");
}

export function formatFinal(command) {
  if (command.status === "failed") {
    return [
      `Task failed: ${command.id}`,
    command.error || "Unknown error.",
    command.progressSummary ? `\nAgent progress:\n${truncateForLark(command.progressSummary, 1200)}` : "",
    "",
    `Use status ${command.id} for details.`,
  ].join("\n");
  }
  if (command.mode === "thread_handoff") {
    if (command.presentation === "chat" && command.status === "completed") {
      return command.result || "Codex finished.";
    }
    return [
      `Codex message ${command.status}: ${command.id}`,
      `Thread: ${command.codexSessionId || "-"}`,
      "",
      "Summary:",
      truncateForLark(command.result || "Codex finished.", 1600),
      "",
      command.diffSummary ? `Files changed:\n${command.diffSummary}` : "Files changed: none",
      "",
      `Use status ${command.id} for details.`,
    ].join("\n");
  }
  return [
    `Task ${command.status}: ${command.id}`,
    "",
    "Summary:",
    truncateForLark(command.result || "Codex finished.", 1200),
    "",
    command.diffSummary ? `Files changed:\n${command.diffSummary}` : "Files changed: none",
    command.testSummary ? `Validation:\n${command.testSummary}` : "Validation: not run",
    "",
    "Next actions:",
    `diff ${command.id}`,
    `approve ${command.id} test`,
    `approve ${command.id} commit`,
    `cancel ${command.id}`,
  ].join("\n");
}

export function formatProgress(command, text) {
  return String(text || "").trim() || "Codex is working.";
}

function formatCounts(counts = {}) {
  const keys = ["pending", "running", "waiting_review", "completed", "failed", "timeout", "cancelled"];
  return keys.map((key) => `${key}=${counts[key] || 0}`).join(" ");
}

function formatLarkTransport({ transport, larkWs }) {
  if (transport === "webhook") return "webhook";
  if (!larkWs?.enabled) return "websocket disabled";
  if (larkWs.connected) return "websocket connected";
  if (larkWs.starting) return "websocket connecting";
  return `websocket ${larkWs.message || "not connected"}`;
}

function formatHandoffState(handoff) {
  if (!handoff?.active) return "not attached";
  const thread = handoff.threadId ? handoff.threadId.slice(0, 8) : "unknown";
  const name = handoff.name ? ` ${handoff.name}` : "";
  return `attached ${thread}${name}`;
}

function formatObservationState(observation) {
  if (!observation?.active) return "off";
  const thread = observation.threadId ? observation.threadId.slice(0, 8) : "unknown";
  const name = observation.name ? ` ${observation.name}` : "";
  return `streaming ${thread}${name}`;
}

function formatTakeoverState(takeover) {
  if (!takeover) return "off";
  const target = takeover.target;
  const thread = target?.threadId ? target.threadId.slice(0, 8) : "";
  return [takeover.state || "unknown", thread, target?.name || ""].filter(Boolean).join(" ");
}

function formatCommandDisplay(showCommands) {
  return showCommands === true ? "on" : "off (risky only)";
}

function formatKeepAwake(keepAwake) {
  if (!keepAwake) return "unknown";
  if (!keepAwake.enabled) return "disabled";
  if (keepAwake.active) return keepAwake.pid ? `active pid=${keepAwake.pid}` : "active";
  if (keepAwake.platform && keepAwake.platform !== "darwin") return "macOS only";
  if (keepAwake.lastError) return `failed ${keepAwake.lastError}`;
  return "idle";
}

function baseCard({ title, elements }) {
  return {
    config: {
      wide_screen_mode: true,
      update_multi: true,
    },
    header: {
      title: {
        tag: "plain_text",
        content: title,
      },
    },
    elements,
  };
}

function targetCardElements(target, index) {
  return [
    {
      tag: "markdown",
      content: `**${index}. [${formatWindowStatus(target.status)}] ${escapeCardText(target.name || "未命名 Codex 对话")}**\n线程: ${String(target.threadId || "").slice(0, 8)}\n${target.updatedAtMs ? `更新: ${new Date(target.updatedAtMs).toLocaleString()}` : ""}`,
    },
    {
      tag: "action",
      actions: [
        cardButton("观察", "takeover_observe", target, "default", index),
        cardButton("接管", "takeover_confirm", target, "primary", index),
      ],
    },
    { tag: "hr" },
  ];
}

function projectCardElements(project, index) {
  return [
    {
      tag: "markdown",
      content: [
        `**${index}. ${escapeCardText(project.name || "未知项目")}**`,
        `目录: ${escapeCardText(project.cwd || "")}`,
        `会话: ${project.windowCount || 0}`,
        project.latestWindowName ? `最近会话: ${escapeCardText(project.latestWindowName)}` : "",
        project.updatedAtMs ? `更新: ${new Date(project.updatedAtMs).toLocaleString()}` : "",
      ].filter(Boolean).join("\n"),
    },
    {
      tag: "action",
      actions: [
        projectButton("进入项目", "takeover_project_select", project, "primary", index),
      ],
    },
    { tag: "hr" },
  ];
}

function cardButton(text, action, target, type = "default", index = target?.index || 0) {
  return {
    tag: "button",
    text: { tag: "plain_text", content: text },
    type,
    value: {
      action,
      optionIndex: Number(index || target?.index || 0),
      threadId: target?.threadId || "",
    },
  };
}

function projectButton(text, action, project, type = "default", index = project?.index || 0) {
  return {
    tag: "button",
    text: { tag: "plain_text", content: text },
    type,
    value: {
      action,
      projectIndex: Number(index || project?.index || 0),
      cwd: project?.cwd || "",
    },
  };
}

function startupButton(text, action, type = "default") {
  return {
    tag: "button",
    text: { tag: "plain_text", content: text },
    type,
    value: { action },
  };
}

function takeoverTargetMarkdown(target = {}) {
  return [
    `**${escapeCardText(target.name || "未命名 Codex 对话")}**`,
    `状态: ${formatWindowStatus(target.status)}`,
    `线程: ${String(target.threadId || "").slice(0, 8) || "unknown"}`,
    target.cwd ? `目录: ${escapeCardText(target.cwd)}` : "",
  ].filter(Boolean).join("\n");
}

function formatWindowStatus(status) {
  if (status === "idle") return "空闲";
  if (status === "running") return "活跃";
  if (status === "unknown") return "未知";
  return status || "未知";
}

function formatTakeoverStateLabel(state) {
  if (state === "selecting_project") return "选择项目中";
  if (state === "selecting") return "选择会话中";
  if (state === "selected") return "已选择会话";
  if (state === "pending") return "等待目标会话空闲";
  if (state === "active") return "已生效";
  if (state === "cancelled") return "已取消";
  return state || "未知";
}

function escapeCardText(text) {
  return String(text || "").replace(/\*/g, "\\*");
}
