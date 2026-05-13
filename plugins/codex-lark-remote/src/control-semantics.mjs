const NUM = "([0-9一二两三四五六七八九十]+|one|two|three|four|five|six|seven|eight|nine|ten|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)";
const PROJECT_NOUN = "(?:项目|project|projects)";
const SESSION_NOUN = "(?:窗口|会话|session|sessions|chat|chats|window|windows)";
const PROJECT_VERB = "(?:进入|打开|开启|选择|选|查看|看|看看|enter|open|select|choose|view|show|inspect|go to|switch to)";
const SESSION_VERB = "(?:查看|看|看看|选择|选|打开|select|choose|view|show|open|inspect)";
const OBSERVE_VERB = "(?:开始|打开|开启|启用|切到|看|看看|观察|串流|跟踪|盯一下|observe|watch|stream|follow|monitor)";
const TAKEOVER_VERB = "(?:确认接管|执行接管|现在接管|立即接管|接管|takeover now|take over now|takeover|take over|attach|handoff)";
const END = "\\s*吧?[。.?？!！]?";

export const CONSOLE_COMMAND_EXAMPLES = "控制台 / console、项目列表 / project list、会话列表 / session list、进入项目 1 / enter project 1、接管 1 / takeover 1";
export const HANDOFF_DIRECT_MODE_DESCRIPTION = "接管后会进入任务直通模式：后续普通消息会直接发送给目标 Codex 会话，作为新任务或补充指令处理，不再判断项目/会话操作。";
export const CONTROL_COMMAND_MEANING_DESCRIPTION = "指令意义：控制台 / console 或跳出接管 / jump out of handoff，是临时回到这里；退出接管 / exit handoff，是结束当前接管但保持飞书连接；关闭飞书连接 / close Lark connection，会确认后停止本机 bridge。";

export function normalizeControlText(text) {
  return String(text || "")
    .replace(/@_user_\d+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function isConsoleModeText(text) {
  return /^(控制台|控制台模式|打开控制台|开启控制台|跳出接管|返回控制台|回到控制台|console|console mode|open console|enter console|back to console|return to console|jump out of handoff|exit to console)[。.!！]?$/.test(normalizeControlText(text).toLowerCase());
}

export function isHandoffModeText(text) {
  return /^(继续接管|回到任务|回到接管|任务模式|接管模式|handoff mode|task mode|direct mode|back to task|resume handoff|return to handoff)[。.!！]?$/.test(normalizeControlText(text).toLowerCase());
}

export function isBridgeStopText(text) {
  const normalized = normalizeControlText(text).toLowerCase();
  return /^(?:关闭|关掉|停止|结束|断开)(?:飞书连接|lark连接|feishu连接|websocket|bridge|连接|插件|机器人|服务|本地连接|codex lark remote|lark remote)吧?[。.!！]?$/.test(normalized)
    || /^(?:确认)?关闭连接[。.!！]?$/.test(normalized)
    || /^(?:bridge|connection)\s+(?:off|stop|close|disconnect|disable)$/i.test(normalized)
    || /^(?:close|stop|disconnect|disable|shut down|shutdown|turn off)\s+(?:the\s+)?(?:feishu|lark|feishu\/lark|websocket|bridge|connection|bot|plugin|lark remote|codex lark remote)(?:\s+connection)?[。.!！]?$/i.test(normalized);
}

export function parseForwardToHandoff(text) {
  const match = normalizeControlText(text).match(/^(?:发送给当前线程|转发给当前线程|发给当前线程|发送给任务|转发给任务|send to current thread|send to current session|send to current chat|send to task|forward to current thread|forward to current session|forward to current chat|forward to task)[:：]\s*(.+)$/i);
  return match?.[1]?.trim() || "";
}

export function parseControlSemanticAction(text, options = {}) {
  const mode = options.mode || "global";
  const normalized = normalizeControlText(text).toLowerCase();
  if (!normalized) return null;

  if (isBridgeStopText(normalized)) return { kind: "bridge_stop_confirm" };
  if (/^(帮助|使用帮助|怎么用|如何使用|有哪些命令|命令列表|指令列表|可用命令|help|usage|commands|command list)[。.!！]?$/.test(normalized)) return { kind: "help" };
  if (/^(我是谁|我的id|我的 id|查看我的id|查看我的 id|获取我的id|获取我的 id|我的用户id|我的用户 id|查我身份|whoami|who am i)[。.?？!！]?$/.test(normalized)) {
    return { kind: "whoami" };
  }
  if (/^(状态|查看状态|看下状态|看看状态|现在状态|当前状态|连接状态|插件状态|飞书状态|lark状态|lark status|status|进度|查看进度|看下进度|看看进度|当前进度|现在进度|执行到哪了|进行到哪了|还在跑吗|还在工作吗|还活着吗|跑着吗|连接正常吗|在干嘛|现在在干嘛|现在干嘛呢)[。.?？!！]?$/.test(normalized)) {
    return { kind: "status" };
  }
  if (/^(接管状态|查看接管|看下接管|当前接管|是否接管|接管了吗|还在接管吗|接管还在吗|飞书接管状态|远程接管状态|handoff status)[。.?？!！]?$/.test(normalized)) {
    return { kind: "handoff_status" };
  }
  if (/^(观察列表|查看观察|可观察窗口|可观察会话|观察哪些窗口|观察哪些会话|可以观察哪些|observe|observe list|watch list|observation list|observable sessions|observable windows|watchable sessions)[。.?？!！]?$/.test(normalized)) {
    return { kind: "observe_list" };
  }

  const projectSelector = matchProjectSelector(normalized);
  if (projectSelector) return { kind: "takeover_project_select", selector: projectSelector };

  const observeSelector = matchObserveSelector(normalized);
  if (observeSelector) {
    return mode === "console"
      ? { kind: "takeover_observe", selector: observeSelector }
      : { kind: "observe_enable", selector: observeSelector };
  }

  const takeoverSelector = matchTakeoverSelector(normalized);
  if (takeoverSelector !== null) {
    const kind = mode === "console" ? "takeover_confirm" : "takeover_execute";
    return takeoverSelector ? { kind, selector: takeoverSelector } : { kind };
  }

  const sessionSelector = matchSessionSelector(normalized);
  if (sessionSelector) return { kind: "takeover_select", selector: sessionSelector };

  if (isProjectListText(normalized)) return { kind: "takeover_list" };
  if (isSessionListText(normalized)) return mode === "console" ? { kind: "takeover_window_list" } : { kind: "takeover_window_list" };
  if (isAmbiguousListText(normalized)) return defaultListAction(options.state);
  if (/^(接管|接管列表|takeover|takeover list)[。.?？!！]?$/.test(normalized)) return { kind: "takeover_list" };

  if (/^(接管状态|查看接管准备|接管准备状态|takeover status)[。.?？!！]?$/.test(normalized)) {
    return { kind: "takeover_status" };
  }
  if (/^(执行接管|确认接管|现在接管|立即接管|takeover now|confirm takeover)[。.!！]?$/.test(normalized)) {
    return { kind: mode === "console" ? "takeover_confirm" : "takeover_execute" };
  }
  if (/^(关闭|关掉|停止|结束|退出)(观察|观察模式|串流|串流观察|观察串流|watch|observe)吧?[。.!！]?$/.test(normalized)
    || /^(不要|别)(继续)?(观察|看|串流|串流观察|观察串流)了?[。.!！]?$/.test(normalized)
    || /^(别看了|不看了)[。.!！]?$/.test(normalized)) {
    return { kind: "observe_disable" };
  }
  if (/^(命令显示状态|查看命令显示|commands status|command status|show commands status)[。.?？!！]?$/.test(normalized)) {
    return { kind: "command_visibility" };
  }
  if (/^(打开|开启|启用|显示|展示|展开)(命令|命令显示|详细命令|终端输出|命令输出|日志|详细日志|command display|commands|show commands)吧?[。.!！]?$/.test(normalized)
    || /^(commands on|command on|show commands|show commands on|enable commands|show logs)[。.!！]?$/.test(normalized)) {
    return { kind: "command_visibility", enabled: true };
  }
  if (/^(关闭|关掉|停止|禁用|隐藏|收起)(命令|命令显示|详细命令|终端输出|命令输出|日志|详细日志|command display|commands|show commands)吧?[。.!！]?$/.test(normalized)
    || /^(不要|别)(再)?(显示|展示|发|刷)?(命令|命令显示|日志|输出)了?[。.!！]?$/.test(normalized)
    || /^(别刷命令了|别刷屏了|太吵了)[。.!！]?$/.test(normalized)
    || /^(commands off|command off|hide commands|disable commands|hide logs)[。.!！]?$/.test(normalized)) {
    return { kind: "command_visibility", enabled: false };
  }
  if (/^断开(接管|远程接管|飞书接管)?吧?[。.!！]?$/.test(normalized)
    || /^(handoff\s+off|exit handoff|stop handoff|end handoff|leave handoff|exit takeover|stop takeover|end takeover)[。.!！]?$/.test(normalized)) {
    return { kind: "handoff_disable" };
  }
  if (/^(关闭|关掉|停止|结束|退出)(接管准备|跨对话接管|takeover)吧?[。.!！]?$/.test(normalized)
    || /^(不要|别)(继续|再)?(准备接管|跨对话接管|takeover)了?[。.!！]?$/.test(normalized)) {
    return { kind: "takeover_disable" };
  }
  if (/^(关闭|关掉|停止|暂停|结束|退出)(接管|远程|远程接管|飞书接管)吧?[。.!！]?$/.test(normalized)) {
    return { kind: "handoff_disable" };
  }
  if (/^(不要|别)(继续|再)?(接管|远程接管|飞书接管)了?[。.!！]?$/.test(normalized)) return { kind: "handoff_disable" };
  if (/^(停止|暂停|关闭|关掉|退出|结束|断开)吧?[。.!！]?$/.test(normalized)) return { kind: "handoff_disable" };

  return null;
}

function isProjectListText(text) {
  if (/(窗口|会话|session|chat|观察)/i.test(text)) return false;
  if (/(项目|project|projects|可接管|接管对象|能接管)/i.test(text) && /(列表|哪些|有什么|有啥|看看|查看|看一下|列出|列一下|显示|展示|list|show|display|available|what|which|all)/i.test(text)) {
    return true;
  }
  return /^(?:项目列表|查看项目|看看项目|看看有哪些项目|看一下有哪些项目|有哪些项目|列出项目|列一下项目|可接管项目|显示项目|projects|project list|list projects|show projects|available projects)[。.?？!！]?$/.test(text);
}

function isSessionListText(text) {
  if (/(窗口|会话|session|sessions|chat|chats|window|windows)/i.test(text) && /(列表|哪些|有什么|有啥|看看|查看|看一下|列出|列一下|显示|展示|可接管|list|show|display|available|what|which|all)/i.test(text)) {
    return true;
  }
  return /^(?:窗口列表|会话列表|查看窗口|查看会话|看看窗口|看看会话|看看有哪些窗口|看看有哪些会话|看一下有哪些窗口|看一下有哪些会话|有哪些窗口|有哪些会话|列出窗口|列出会话|列一下窗口|列一下会话|可接管窗口|可接管会话|windows|window list|list windows|sessions|session list|list sessions|chats|chat list|list chats|available sessions|available windows)[。.?？!！]?$/.test(text);
}

function isAmbiguousListText(text) {
  return /^(?:列表|查看列表|看看列表|看一下列表|有哪些|看看有哪些|列一下|列出来|list|show list|show all|available)[。.?？!！]?$/.test(text);
}

function defaultListAction(state = {}) {
  return state.takeover?.project || ["selecting", "selected", "pending", "active"].includes(state.takeover?.state)
    ? { kind: "takeover_window_list" }
    : { kind: "takeover_list" };
}

function matchProjectSelector(text) {
  return matchSelector(text, [
    new RegExp(`^(?:${PROJECT_VERB}\\s*)?(?:第\\s*)?${NUM}\\s*(?:个)?\\s*${PROJECT_NOUN}(?:详情|details?)?${END}$`),
    new RegExp(`^(?:${PROJECT_VERB}\\s*)?${PROJECT_NOUN}\\s*(?:第\\s*)?${NUM}(?:\\s*个)?(?:详情|details?)?${END}$`),
  ]);
}

function matchSessionSelector(text) {
  return matchSelector(text, [
    new RegExp(`^(?:${SESSION_VERB}\\s*)?(?:第\\s*)?${NUM}\\s*(?:个)?\\s*${SESSION_NOUN}(?:详情|details?)?${END}$`),
    new RegExp(`^(?:${SESSION_VERB}\\s*)?${SESSION_NOUN}\\s*(?:第\\s*)?${NUM}(?:\\s*个)?(?:详情|details?)?${END}$`),
  ]);
}

function matchObserveSelector(text) {
  if (!/(观察|串流|进度|跟踪|盯|observe|watch|stream|follow|monitor)/i.test(text)) return "";
  return matchSelector(text, [
    new RegExp(`^(?:${OBSERVE_VERB}\\s*)?(?:第\\s*)?${NUM}\\s*(?:个)?\\s*${SESSION_NOUN}?(?:的)?(?:观察|串流|进度|stream|progress)?${END}$`),
    new RegExp(`^(?:${OBSERVE_VERB}\\s*)?${SESSION_NOUN}?\\s*(?:第\\s*)?${NUM}(?:\\s*个)?(?:的)?(?:观察|串流|进度|stream|progress)?${END}$`),
  ]);
}

function matchTakeoverSelector(text) {
  return matchOptionalSelector(text, [
    new RegExp(`^(?:${TAKEOVER_VERB})\\s*(?:第\\s*)?${NUM}?\\s*(?:个)?\\s*${SESSION_NOUN}?${END}$`),
    new RegExp(`^(?:${TAKEOVER_VERB})\\s*${SESSION_NOUN}\\s*(?:第\\s*)?${NUM}(?:\\s*个)?${END}$`),
  ]);
}

function matchSelector(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return chineseNumberToAscii(match[1]);
  }
  return "";
}

function matchOptionalSelector(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1] ? chineseNumberToAscii(match[1]) : "";
  }
  return null;
}

export function chineseNumberToAscii(value) {
  const text = String(value || "").trim();
  if (/^\d+$/.test(text)) return text;
  const english = {
    one: "1",
    first: "1",
    two: "2",
    second: "2",
    three: "3",
    third: "3",
    four: "4",
    fourth: "4",
    five: "5",
    fifth: "5",
    six: "6",
    sixth: "6",
    seven: "7",
    seventh: "7",
    eight: "8",
    eighth: "8",
    nine: "9",
    ninth: "9",
    ten: "10",
    tenth: "10",
  };
  if (english[text.toLowerCase()]) return english[text.toLowerCase()];
  const map = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (text === "十") return "10";
  if (text.startsWith("十")) return String(10 + (map[text.slice(1)] || 0));
  if (text.includes("十")) {
    const [tens, ones] = text.split("十");
    return String((map[tens] || 1) * 10 + (map[ones] || 0));
  }
  return map[text] ? String(map[text]) : text;
}
