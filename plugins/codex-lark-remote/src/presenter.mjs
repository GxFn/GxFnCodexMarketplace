import { truncateForLark } from "./notifier.mjs";

export function formatHelp(options = {}) {
  if (languageOf(options) === "en") {
    return [
      "Codex Lark Remote",
      "",
      "Use the console to choose local Codex projects and sessions. After takeover, normal messages go straight to the selected session.",
      "Console: send console, project list, session list, enter project 1, observe session 2, takeover 2.",
      "Task control: status rcmd_..., diff rcmd_..., cancel rcmd_..., approve rcmd_... test.",
      "whoami",
      "status",
      "windows",
      "takeover status",
      "takeover off",
      "close Lark connection",
      "observe",
      "observe <number|thread-prefix>",
      "observe off",
      "commands on|off",
      "handoff off",
    ].join("\n");
  }
  return [
    "Codex Lark Remote",
    "",
    "可以从控制台选择本机 Codex 项目和会话；接管后普通需求会直通被选中的会话。",
    "控制台：发送控制台、项目列表、会话列表、进入项目 1、观察会话 2、接管 2。",
    "任务控制：status rcmd_...、diff rcmd_...、cancel rcmd_...、approve rcmd_... test。",
    "whoami",
    "status",
    "windows",
    "takeover status",
    "takeover off",
    "关闭飞书连接",
    "observe",
    "observe <序号或线程前缀>",
    "observe off",
    "commands on|off",
    "handoff off",
  ].join("\n");
}

export function formatStartupIntro(options = {}) {
  if (languageOf(options) === "en") {
    return [
      "Codex is connected to Lark.",
      "",
      "The outer layer is a natural-language console. You can describe project and session operations directly.",
      "This manages local Codex session records. In this plugin, windows means Codex sessions.",
      "",
      "Before takeover, say things like:",
      "- project list",
      "- enter project 1",
      "- observe session 2",
      "- takeover 2",
      "",
      "After takeover, normal messages go straight to the selected Codex session as new tasks or follow-up instructions. Project/session commands are no longer interpreted until you return to the console.",
      "To temporarily return to the console, send console or jump out of handoff. To end the current takeover but keep Lark connected, send exit handoff.",
      "To stop the local bridge and disconnect Lark, send close Lark connection. A confirmation card appears first.",
      "",
      "Fallback commands:",
      "status",
      "windows",
      "observe",
      "whoami",
      "handoff off",
    ].join("\n");
  }
  return [
    "Codex 已经连上飞书了。",
    "",
    "外层是自然语言控制台，可以直接理解你的项目和会话操作意图。",
    "这里管理的是本机 Codex 会话记录；窗口只是会话的口语叫法。",
    "",
    "没有接管时，可以直接说：",
    "- 看看有哪些项目",
    "- 进入第 1 个项目",
    "- 观察第 2 个会话",
    "- 接管第 2 个会话",
    "",
    "接管后会切到任务直通模式，普通消息会作为新任务或补充指令直接发给被接管的 Codex 会话，不再解析项目/会话操作。",
    "要临时回到外层自然语言控制台，发送控制台或跳出接管。要结束当前接管并留在控制台，发送退出接管。",
    "要停止本机桥接服务并断开飞书连接，发送关闭飞书连接；会先出现确认卡。",
  ].join("\n");
}

export function formatConsoleModeIntro(options = {}) {
  if (languageOf(options) === "en") {
    return [
      "Entered the natural-language console.",
      "",
      "Say: console, project list, session list, enter project 1, takeover 1.",
      "After takeover, normal messages go straight to the selected Codex session as new tasks or follow-up instructions. Project/session commands are no longer interpreted.",
      "Command meanings: console or jump out of handoff temporarily returns here; exit handoff ends the current takeover but keeps Lark connected; close Lark connection asks for confirmation, then stops the local bridge.",
    ].join("\n");
  }
  return [
    "已进入外层自然语言控制台。",
    "",
    "直接说：控制台、项目列表、会话列表、进入项目 1、接管 1。",
    "接管后会进入任务直通模式：后续普通消息会直接发送给目标 Codex 会话，作为新任务或补充指令处理，不再判断项目/会话操作。",
    "指令意义：控制台或跳出接管，是临时回到这里；退出接管，是结束当前接管但保持飞书连接；关闭飞书连接，会确认后停止本机桥接服务。",
  ].join("\n");
}

export function buildStartupIntroCard(options = {}) {
  const language = languageOf(options);
  if (language === "en") {
    return baseCard({
      title: "Codex Connected To Lark",
      elements: [
        {
          tag: "markdown",
          content: [
            "**The outer layer is a natural-language console.**",
            "",
            "This manages local Codex session records. In this plugin, `windows` means Codex sessions.",
            "Before takeover, say `project list`, `enter project 1`, `observe session 2`, or `takeover 2`.",
            "After takeover, normal messages go straight to the selected Codex session as new tasks or follow-up instructions. Project/session commands are no longer interpreted.",
            "To temporarily return to the console, send `console` or `jump out of handoff`.",
            "To end the current takeover but keep Lark connected, send `exit handoff`.",
            "To stop the local bridge and disconnect Lark, send `close Lark connection`; a confirmation card appears first.",
            "Buttons are shortcuts. Fallback commands: `status`, `windows`, `observe`, `whoami`, `handoff off`.",
          ].join("\n"),
        },
        {
          tag: "action",
          actions: [
            startupButton("Status", "startup_status", "primary"),
            startupButton("Console", "startup_console", "default"),
            startupButton("Projects/Sessions", "startup_windows", "default"),
            startupButton("Observe", "startup_observe", "default"),
            startupButton("Identity", "startup_whoami", "default"),
            startupButton("Close Connection", "bridge_stop_prompt", "danger"),
          ],
        },
      ],
    });
  }
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
            "要临时回到外层自然语言控制台，发送 `控制台` 或 `跳出接管`。",
            "要结束当前接管并留在控制台，发送 `退出接管`。",
            "要真正断开飞书连接并停止本机桥接服务，发送 `关闭飞书连接`；会先出现确认卡。",
            "按钮只是快捷入口，也可以直接用自然语言说出同样的意图。",
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

export function buildConsoleModeCard(options = {}) {
  const language = languageOf(options);
  if (language === "en") {
    return baseCard({
      title: "Natural-Language Console",
      elements: [
        {
          tag: "markdown",
          content: [
            "**Entered the natural-language console.**",
            "",
            "Say: console, project list, session list, enter project 1, takeover 1.",
            "After takeover, normal messages go straight to the selected Codex session as new tasks or follow-up instructions. Project/session commands are no longer interpreted.",
            "Command meanings: console or jump out of handoff temporarily returns here; exit handoff ends the current takeover but keeps Lark connected; close Lark connection asks for confirmation, then stops the local bridge.",
          ].join("\n"),
        },
        {
          tag: "action",
          actions: [
            startupButton("Status", "startup_status", "primary"),
            startupButton("Projects/Sessions", "startup_windows", "default"),
            startupButton("Observe", "startup_observe", "default"),
            startupButton("Close Connection", "bridge_stop_prompt", "danger"),
          ],
        },
      ],
    });
  }
  return baseCard({
    title: "自然语言控制台",
    elements: [
      {
        tag: "markdown",
          content: [
            "**已进入外层自然语言控制台。**",
            "",
            "直接说：控制台、项目列表、会话列表、进入项目 1、接管 1。",
            "接管后会进入任务直通模式：后续普通消息会直接发送给目标 Codex 会话，作为新任务或补充指令处理，不再判断项目/会话操作。",
            "指令意义：控制台或跳出接管，是临时回到这里；退出接管，是结束当前接管但保持飞书连接；关闭飞书连接，会确认后停止本机桥接服务。",
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

export function formatHandoffDisabled(options = {}) {
  if (languageOf(options) === "en") {
    return [
      "Current takeover ended. Lark stays connected.",
      "",
      "New normal messages return to the natural-language console, so project/session operations are interpreted again.",
      "Say: project list, session list, observe session 2, takeover 2.",
      "To temporarily return to the console without ending takeover, use console or jump out of handoff.",
    ].join("\n");
  }
  return [
    "已退出当前接管，飞书连接仍然保持。",
    "",
    "后续普通消息会回到外层自然语言控制台，先理解项目/会话操作意图；不会再直通刚才的 Codex 会话。",
    "可以直接说：项目列表、会话列表、观察第 2 个会话、接管第 2 个会话。",
    "如果只是临时跳回控制台、不结束接管，用控制台或跳出接管。",
  ].join("\n");
}

export function buildHandoffDisabledCard(options = {}) {
  if (languageOf(options) === "en") {
    return baseCard({
      title: "Current Takeover Ended",
      elements: [
        {
          tag: "markdown",
          content: [
            "**Lark stays connected.**",
            "",
            "This only ended takeover for the selected Codex session and returned to the natural-language console.",
            "New normal messages are interpreted as project/session operations again, not sent to the previous Codex session.",
            "You can continue with `project list`, `session list`, or `takeover 2`.",
            "To temporarily return to the console without ending takeover, use `console` or `jump out of handoff`.",
          ].join("\n"),
        },
        {
          tag: "action",
          actions: [
            startupButton("Projects/Sessions", "startup_windows", "primary"),
            startupButton("Observe", "startup_observe", "default"),
            startupButton("Status", "startup_status", "default"),
          ],
        },
      ],
    });
  }
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
          "可以继续说 `项目列表`、`会话列表`、`接管 2`。",
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

export function formatBridgeStopConfirm(options = {}) {
  if (languageOf(options) === "en") {
    return [
      "Close the Lark connection?",
      "",
      "This stops the local Codex Lark Remote bridge and disconnects the Lark WebSocket.",
      "After closing, Lark messages will no longer enter Codex. Restart the plugin in Codex to reconnect.",
      "If you only want to end the current takeover, send exit handoff.",
    ].join("\n");
  }
  return [
    "确认关闭飞书连接？",
    "",
    "这会停止本机 Codex Lark Remote bridge，并断开飞书 WebSocket。",
    "关闭后，飞书里的普通消息不会再进入 Codex；需要回到 Codex 里重新启动插件才能恢复。",
    "如果只是退出当前会话接管，请发送“退出接管”或 exit handoff。",
  ].join("\n");
}

export function buildBridgeStopConfirmCard(options = {}) {
  if (languageOf(options) === "en") {
    return baseCard({
      title: "Close Lark Connection",
      elements: [
        {
          tag: "markdown",
          content: [
            "**This stops the local bridge and disconnects the Lark WebSocket.**",
            "",
            "After closing, Lark messages will no longer enter Codex. Restart the plugin in Codex to reconnect.",
            "If you only want to end the current takeover, send `exit handoff`.",
          ].join("\n"),
        },
        {
          tag: "action",
          actions: [
            startupButton("Close Connection", "bridge_stop_execute", "danger"),
            startupButton("Cancel", "bridge_stop_cancel", "default"),
          ],
        },
      ],
    });
  }
  return baseCard({
    title: "确认关闭飞书连接",
    elements: [
      {
        tag: "markdown",
        content: [
          "**这会停止本机 bridge，并断开飞书 WebSocket。**",
          "",
          "关闭后，飞书里的普通消息不会再进入 Codex；需要回到 Codex 里重新启动插件才能恢复。",
          "如果只是退出当前会话接管，请发送 `退出接管` 或 `exit handoff`。",
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

export function formatBridgeStopping(options = {}) {
  if (languageOf(options) === "en") {
    return [
      "Closing the Lark connection.",
      "The local Codex Lark Remote bridge and Lark WebSocket will stop. Restart the plugin in Codex to reconnect.",
    ].join("\n");
  }
  return [
    "正在关闭飞书连接。",
    "本机 Codex Lark Remote bridge 和飞书 WebSocket 会停止；之后需要在 Codex 里重新启动插件。",
  ].join("\n");
}

export function formatBridgeStopCancelled(options = {}) {
  if (languageOf(options) === "en") return "Close cancelled. Lark stays connected.";
  return "已取消关闭连接。飞书连接仍然保持。";
}

export function formatWhoami(event) {
  const preferredId = event.senderId || event.openId || event.unionId || "";
  return [
    "Codex Lark Remote whoami",
    `senderIdType: ${event.senderIdType || "unknown"}`,
    `senderId: ${event.senderId || "unknown"}`,
    event.openId && event.openId !== event.senderId ? `openId: ${event.openId}` : "",
    event.unionId ? `unionId: ${event.unionId}` : "",
    `userHash: ${event.userIdHash || "-"}`,
    "",
    "Next: add one of these IDs to lark.allowedUsers.",
    preferredId ? `allowedUsers: ["${preferredId}"]` : "",
    "把这一行粘回 Codex，让它更新配置。",
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatSetupVerification(report = {}) {
  const checks = report.checks || {};
  const larkWs = report.bridge?.larkWs || {};
  return [
    "飞书配置验证",
    "",
    `App 凭证: ${formatSetupCheck(checks.appCredentialsConfigured, "已配置", "未配置")}${formatAuthSuffix(checks.appCredentialsValid, report.auth)}`,
    `Bridge: ${checks.bridgeRunning ? "运行中" : "未启动"}`,
    `WebSocket 长连接: ${formatSetupCheck(checks.webSocketConnected, "已连接", larkWs.message || "未连接")}`,
    `事件配置 im.message.receive_v1: ${formatSetupCheck(checks.messageEventReceived, `已收到消息事件${formatSeenAt(larkWs.lastMessageEventAt)}`, "等待飞书消息事件")}`,
    `回调配置 card.action.trigger: ${formatSetupCheck(checks.cardCallbackReceived, `已收到卡片回调${formatSeenAt(larkWs.lastCardActionAt)}`, "等待卡片回调")}`,
    "",
    "现在请先去飞书后台做长连接配置验证，不要先发 whoami。",
    "事件配置：使用长连接接收，添加 im.message.receive_v1，点击验证/保存。",
    "回调配置：使用长连接接收，添加 card.action.trigger，点击验证/保存。",
    "这两步完成并发布后，先回到 Codex 同意连接当前会话；连接生效后再给机器人发送 whoami。",
    "",
    report.nextActions?.length ? `下一步:\n${report.nextActions.map((item) => `- ${item}`).join("\n")}` : "",
  ].filter(Boolean).join("\n");
}

export function buildSetupVerificationCard(report = {}) {
  return baseCard({
    title: "飞书配置验证",
    elements: [
      {
        tag: "markdown",
        content: [
          setupVerificationLine("App 凭证", report.checks?.appCredentialsConfigured, report.checks?.appCredentialsValid === false ? "鉴权失败" : "已配置", "未配置"),
          setupVerificationLine("Bridge", report.checks?.bridgeRunning, "运行中", "未启动"),
          setupVerificationLine("WebSocket 长连接", report.checks?.webSocketConnected, "已连接", report.bridge?.larkWs?.message || "未连接"),
          setupVerificationLine("事件配置 im.message.receive_v1", report.checks?.messageEventReceived, `已收到消息事件${formatSeenAt(report.bridge?.larkWs?.lastMessageEventAt)}`, "等待飞书消息事件"),
          setupVerificationLine("回调配置 card.action.trigger", report.checks?.cardCallbackReceived, `已收到卡片回调${formatSeenAt(report.bridge?.larkWs?.lastCardActionAt)}`, "等待卡片回调"),
          "",
          "**现在先去飞书后台完成长连接配置验证，不要先发 `whoami`。**",
          "事件配置：使用长连接接收，添加 `im.message.receive_v1`，点击验证/保存。",
          "回调配置：使用长连接接收，添加 `card.action.trigger`，点击验证/保存。",
          "两项都验证通过并发布后，先回到 Codex 同意连接当前会话；连接生效后再发送 `whoami` 验证消息事件。",
          "看到插件卡片后，再点击下面的“刷新验证”验证卡片回调。",
        ].join("\n"),
      },
      {
        tag: "action",
        actions: [
          startupButton("刷新验证", "setup_verify", "primary"),
          startupButton("我的身份", "startup_whoami", "default"),
          startupButton("状态", "startup_status", "default"),
        ],
      },
    ],
  });
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

function setupVerificationLine(label, ok, okText, failText) {
  return `**${label}**: ${ok ? okText : failText}`;
}

function formatSetupCheck(ok, okText, failText) {
  return ok ? okText : failText;
}

function formatAuthSuffix(appCredentialsValid, auth) {
  if (appCredentialsValid === true) return "，鉴权通过";
  if (appCredentialsValid === false) return `，鉴权失败${auth?.message ? ` (${auth.message})` : ""}`;
  return "";
}

function formatSeenAt(value) {
  return value ? ` (${new Date(value).toLocaleString()})` : "";
}

export function formatObservationList(targets = [], observation = null, options = {}) {
  const language = languageOf(options);
  if (language === "en") {
    if (!targets.length) return "No observable Codex sessions found.";
    return [
      "Observable Codex sessions",
      ...targets.map((thread, index) => [
        `${index + 1}. ${thread.name || "Untitled Codex chat"}`,
        `   Thread: ${String(thread.threadId).slice(0, 8)}`,
        thread.cwd ? `   Folder: ${thread.cwd}` : "",
        thread.updatedAtMs ? `   Updated: ${new Date(thread.updatedAtMs).toLocaleString()}` : "",
      ].filter(Boolean).join("\n")),
      "",
      "Reply observe <number or thread prefix> to observe a session.",
      observation?.active ? "Reply observe off to stop the current observation." : "",
    ].filter(Boolean).join("\n");
  }
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

export function formatObservationStatus(observation, options = {}) {
  const language = languageOf(options);
  if (language === "en") {
    if (!observation?.active) return "Codex Lark Remote observation: off";
    return [
      "Codex Lark Remote observation: active",
      observation.name ? `Title: ${observation.name}` : "",
      `Thread: ${String(observation.threadId || "").slice(0, 8) || "unknown"}`,
      observation.cwd ? `Folder: ${observation.cwd}` : "",
      "This is read-only progress streaming. Lark messages are not sent to the observed session.",
      "Reply observe off to stop observing.",
    ].filter(Boolean).join("\n");
  }
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
  const language = languageOf(options);
  if (language === "en") {
    if (!targets.length) return "No takeover-ready Codex sessions found.";
    return [
      "Codex sessions in the current project",
      options.cwd ? `Project: ${options.cwd}` : "",
      "This lists Codex session records under this project, including the session that started Lark takeover. It is not a macOS window list.",
      ...targets.map((target, index) => [
        `${index + 1}. [${formatWindowStatus(target.status, language)}] ${target.name || "Untitled Codex chat"}`,
        `   Thread: ${String(target.threadId || "").slice(0, 8)}`,
        target.cwd ? `   Folder: ${target.cwd}` : "",
        target.updatedAtMs ? `   Updated: ${new Date(target.updatedAtMs).toLocaleString()}` : "",
      ].filter(Boolean).join("\n")),
      "",
      "Reply 1, 2, or 3 to select a session. Reply takeover now to take over the selected session.",
    ].join("\n");
  }
  if (!targets.length) return "没有找到可接管的 Codex 会话。";
  return [
    "当前项目的 Codex 会话",
    options.cwd ? `项目: ${options.cwd}` : "",
    "这里只显示该项目下的 Codex 会话记录，包括启动飞书接管的会话；它不是 macOS 窗口枚举。",
    ...targets.map((target, index) => [
      `${index + 1}. [${formatWindowStatus(target.status, language)}] ${target.name || "未命名 Codex 对话"}`,
      `   线程: ${String(target.threadId || "").slice(0, 8)}`,
      target.cwd ? `   目录: ${target.cwd}` : "",
      target.updatedAtMs ? `   更新: ${new Date(target.updatedAtMs).toLocaleString()}` : "",
    ].filter(Boolean).join("\n")),
    "",
    "回复 1、2、3 可以选择会话；回复 takeover now 可以接管已选择会话。",
  ].join("\n");
}

export function formatTakeoverProjectList(projects = [], options = {}) {
  const language = languageOf(options);
  if (language === "en") {
    if (!projects.length) return "No takeover-ready Codex projects found.";
    return [
      "Takeover-ready projects",
      "These come from all local Codex session records. Only users in lark.allowedUsers can continue.",
      ...projects.map((project, index) => [
        `${index + 1}. ${project.name || "Unknown project"}`,
        `   Folder: ${project.cwd}`,
        `   Sessions: ${project.windowCount || 0}`,
        project.latestWindowName ? `   Latest session: ${project.latestWindowName}` : "",
        project.updatedAtMs ? `   Updated: ${new Date(project.updatedAtMs).toLocaleString()}` : "",
      ].filter(Boolean).join("\n")),
      "",
      "Reply 1, 2, or 3 to enter a project, then choose a session to observe or take over.",
    ].join("\n");
  }
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

export function formatTakeoverSelected(target, options = {}) {
  const language = languageOf(options);
  if (language === "en") {
    if (!target) return "No Codex session selected yet.";
    return [
      `Selected session: ${target.name || "Untitled Codex chat"}`,
      `Status: ${formatWindowStatus(target.status, language)}`,
      `Thread: ${String(target.threadId || "").slice(0, 8) || "unknown"}`,
      target.cwd ? `Folder: ${target.cwd}` : "",
      target.updatedAtMs ? `Updated: ${new Date(target.updatedAtMs).toLocaleString()}` : "",
      "",
      "Reply takeover now to take over, observe for read-only streaming, or list to return to the session list.",
    ].filter(Boolean).join("\n");
  }
  if (!target) return "还没有选择 Codex 会话。";
  return [
    `已选择会话: ${target.name || "未命名 Codex 对话"}`,
    `状态: ${formatWindowStatus(target.status, language)}`,
    `线程: ${String(target.threadId || "").slice(0, 8) || "unknown"}`,
    target.cwd ? `目录: ${target.cwd}` : "",
    target.updatedAtMs ? `更新: ${new Date(target.updatedAtMs).toLocaleString()}` : "",
    "",
    "可回复 takeover now 接管，observe 只读观察，list 返回会话列表。",
  ].filter(Boolean).join("\n");
}

export function formatTakeoverPending(target, options = {}) {
  if (languageOf(options) === "en") {
    return [
      `Takeover is waiting for target thread ${String(target?.threadId || "").slice(0, 8) || "unknown"}.`,
      "The target Codex session is still active. I will take over automatically after it becomes idle.",
      "Messages you send now will be held and delivered after takeover activates.",
    ].join("\n");
  }
  return [
    `接管等待中，目标线程 ${String(target?.threadId || "").slice(0, 8) || "unknown"}。`,
    "目标 Codex 会话仍显示为活跃，我会在它空闲后自动接管。",
    "你现在发送的消息会暂存，并在接管生效后送达。",
  ].join("\n");
}

export function formatTakeoverActive(target, options = {}) {
  if (languageOf(options) === "en") {
    return [
      `Takeover is active for target thread ${String(target?.threadId || "").slice(0, 8) || "unknown"}.`,
      "Now send normal Lark messages to continue this Codex conversation.",
      "Send console to temporarily return to project/session control. Send exit handoff to end this takeover without disconnecting Lark.",
    ].join("\n");
  }
  return [
    `接管已生效，目标线程 ${String(target?.threadId || "").slice(0, 8) || "unknown"}。`,
    "现在直接发送普通飞书消息，就会继续这个 Codex 对话。",
    "发送“控制台”可临时回到项目/会话控制台；发送“退出接管”会结束当前接管，但不会断开飞书连接。",
  ].join("\n");
}

export function formatPendingTakeoverInputQueued(state, options = {}) {
  if (languageOf(options) === "en") {
    return [
      "This message is held.",
      "The target Codex session is still active. After takeover activates, I will deliver this as the first input.",
      state?.pendingInputs?.length ? `Held messages: ${state.pendingInputs.length}` : "",
    ].filter(Boolean).join("\n");
  }
  return [
    "已暂存这条消息。",
    "目标 Codex 会话仍显示为活跃；接管生效后，我会把暂存消息作为第一条输入送达。",
    state?.pendingInputs?.length ? `待发送消息: ${state.pendingInputs.length}` : "",
  ].filter(Boolean).join("\n");
}

export function buildTakeoverListCard(targets = [], options = {}) {
  const language = languageOf(options);
  if (language === "en") {
    const projectElements = options.cwd
      ? [{ tag: "markdown", content: `**Current Project**\n${escapeCardText(options.cwd)}\n\nThis lists Codex session records under this project, including the session that started Lark takeover. It is not a macOS window list.` }, { tag: "hr" }]
      : [];
    return baseCard({
      title: "Codex Sessions In Current Project",
      elements: targets.length ? [
        ...projectElements,
        ...targets.flatMap((target, index) => targetCardElements(target, index + 1, language)),
      ] : [
        ...projectElements,
        { tag: "markdown", content: "No takeover-ready Codex sessions found." },
      ],
    });
  }
  const projectElements = options.cwd
    ? [{ tag: "markdown", content: `**当前项目**\n${escapeCardText(options.cwd)}\n\n这里只显示该项目下的 Codex 会话记录，包括启动飞书接管的会话；不是 macOS 窗口枚举。` }, { tag: "hr" }]
    : [];
  return baseCard({
    title: "当前项目的 Codex 会话",
    elements: targets.length ? [
      ...projectElements,
      ...targets.flatMap((target, index) => targetCardElements(target, index + 1, language)),
    ] : [
      ...projectElements,
      { tag: "markdown", content: "没有找到可接管的 Codex 会话。" },
    ],
  });
}

export function buildTakeoverProjectListCard(projects = [], options = {}) {
  const language = languageOf(options);
  if (language === "en") {
    return baseCard({
      title: "Takeover-Ready Projects",
      elements: projects.length ? [
        {
          tag: "markdown",
          content: "These projects come from local Codex session records. Only Lark users in `lark.allowedUsers` can enter projects, observe sessions, or take over sessions.",
        },
        { tag: "hr" },
        ...projects.flatMap((project, index) => projectCardElements(project, index + 1, language)),
      ] : [
        { tag: "markdown", content: "No takeover-ready Codex projects found." },
      ],
    });
  }
  return baseCard({
    title: "可接管项目",
    elements: projects.length ? [
      {
        tag: "markdown",
        content: "这些项目来自本机 Codex 会话记录。只有 `lark.allowedUsers` 中的飞书用户可以进入项目、观察会话或接管会话。",
      },
      { tag: "hr" },
      ...projects.flatMap((project, index) => projectCardElements(project, index + 1, language)),
    ] : [
      { tag: "markdown", content: "没有找到可接管的 Codex 项目。" },
    ],
  });
}

export function buildTakeoverSelectedCard(target, options = {}) {
  const language = languageOf(options);
  return baseCard({
    title: language === "en" ? "Codex Session" : "Codex 会话",
    elements: [
      { tag: "markdown", content: takeoverTargetMarkdown(target, language) },
      {
        tag: "action",
        actions: [
          cardButton(language === "en" ? "Observe" : "观察", "takeover_observe", target, "default"),
          cardButton(language === "en" ? "Take Over" : "接管", "takeover_confirm", target, "primary"),
        ],
      },
    ],
  });
}

export function buildTakeoverConfirmCard(target, options = {}) {
  const language = languageOf(options);
  return baseCard({
    title: language === "en" ? "Confirm Takeover" : "确认接管",
    elements: [
      {
        tag: "markdown",
        content: language === "en"
          ? `${takeoverTargetMarkdown(target, language)}\n\nAfter confirmation, future Lark messages route to this Codex thread.`
          : `${takeoverTargetMarkdown(target, language)}\n\n确认后，飞书后续消息会路由到这个 Codex 线程。`,
      },
      {
        tag: "action",
        actions: [
          cardButton(language === "en" ? "Confirm Takeover" : "确认接管", "takeover_execute", target, "danger"),
          cardButton(language === "en" ? "Cancel" : "取消", "takeover_cancel", target, "default"),
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

function languageOf(options = {}) {
  if (typeof options === "string") return options === "en" ? "en" : "zh";
  return options?.language === "en" ? "en" : "zh";
}

function targetCardElements(target, index, language = "zh") {
  return [
    {
      tag: "markdown",
      content: language === "en"
        ? `**${index}. [${formatWindowStatus(target.status, language)}] ${escapeCardText(target.name || "Untitled Codex chat")}**\nThread: ${String(target.threadId || "").slice(0, 8)}\n${target.updatedAtMs ? `Updated: ${new Date(target.updatedAtMs).toLocaleString()}` : ""}`
        : `**${index}. [${formatWindowStatus(target.status, language)}] ${escapeCardText(target.name || "未命名 Codex 对话")}**\n线程: ${String(target.threadId || "").slice(0, 8)}\n${target.updatedAtMs ? `更新: ${new Date(target.updatedAtMs).toLocaleString()}` : ""}`,
    },
    {
      tag: "action",
      actions: [
        cardButton(language === "en" ? "Observe" : "观察", "takeover_observe", target, "default", index),
        cardButton(language === "en" ? "Take Over" : "接管", "takeover_confirm", target, "primary", index),
      ],
    },
    { tag: "hr" },
  ];
}

function projectCardElements(project, index, language = "zh") {
  if (language === "en") {
    return [
      {
        tag: "markdown",
        content: [
          `**${index}. ${escapeCardText(project.name || "Unknown project")}**`,
          `Folder: ${escapeCardText(project.cwd || "")}`,
          `Sessions: ${project.windowCount || 0}`,
          project.latestWindowName ? `Latest session: ${escapeCardText(project.latestWindowName)}` : "",
          project.updatedAtMs ? `Updated: ${new Date(project.updatedAtMs).toLocaleString()}` : "",
        ].filter(Boolean).join("\n"),
      },
      {
        tag: "action",
        actions: [
          projectButton("Enter Project", "takeover_project_select", project, "primary", index),
        ],
      },
      { tag: "hr" },
    ];
  }
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

function takeoverTargetMarkdown(target = {}, language = "zh") {
  if (language === "en") {
    return [
      `**${escapeCardText(target.name || "Untitled Codex chat")}**`,
      `Status: ${formatWindowStatus(target.status, language)}`,
      `Thread: ${String(target.threadId || "").slice(0, 8) || "unknown"}`,
      target.cwd ? `Folder: ${escapeCardText(target.cwd)}` : "",
    ].filter(Boolean).join("\n");
  }
  return [
    `**${escapeCardText(target.name || "未命名 Codex 对话")}**`,
    `状态: ${formatWindowStatus(target.status, language)}`,
    `线程: ${String(target.threadId || "").slice(0, 8) || "unknown"}`,
    target.cwd ? `目录: ${escapeCardText(target.cwd)}` : "",
  ].filter(Boolean).join("\n");
}

function formatWindowStatus(status, language = "zh") {
  if (language === "en") {
    if (status === "idle") return "idle";
    if (status === "running") return "running";
    if (status === "unknown") return "unknown";
    return status || "unknown";
  }
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
