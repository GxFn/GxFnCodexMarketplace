export class LarkNotifier {
  constructor({ appId = process.env.CODEX_LARK_APP_ID, appSecret = process.env.CODEX_LARK_APP_SECRET } = {}) {
    this.appId = appId || "";
    this.appSecret = appSecret || "";
    this.tenantToken = "";
    this.tenantTokenExpiresAt = 0;
  }

  async checkAuth() {
    if (!this.appId || !this.appSecret) {
      return { ok: false, hasCredentials: false, message: "Missing Lark appId/appSecret" };
    }
    const token = await this.#tenantToken();
    return {
      ok: Boolean(token),
      hasCredentials: true,
      appIdPrefix: `${this.appId.slice(0, 8)}...`,
      message: token ? "Tenant access token acquired" : "Tenant access token request failed",
    };
  }

  async reply(messageId, text) {
    return this.replyMessage(messageId, {
      msgType: "text",
      chunks: splitForLarkText(text).map((chunk) => ({ text: chunk })),
    });
  }

  async send(receiveId, text, options = {}) {
    return this.sendMessage(receiveId, {
      receiveIdType: options.receiveIdType || "chat_id",
      msgType: "text",
      chunks: splitForLarkText(text).map((chunk) => ({ text: chunk })),
    });
  }

  async sendCard(receiveId, card, options = {}) {
    return this.sendMessage(receiveId, {
      receiveIdType: options.receiveIdType || "chat_id",
      msgType: "interactive",
      chunks: [card],
    });
  }

  async replyCard(messageId, card) {
    return this.replyMessage(messageId, {
      msgType: "interactive",
      content: card,
      chunks: [card],
    });
  }

  async patchCard(messageId, card) {
    if (!messageId) return { ok: false, error: "Missing Lark message id" };
    if (!this.appId || !this.appSecret) return { ok: false, error: "Missing Lark appId/appSecret" };
    const token = await this.#tenantToken();
    if (!token) return { ok: false, error: "Missing Lark tenant access token" };
    const response = await fetch(`https://open.feishu.cn/open-apis/im/v1/messages/${messageId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        msg_type: "interactive",
        content: JSON.stringify(card),
      }),
    });
    return larkDeliveryResult(response, { messageIds: [], totalParts: 1 });
  }

  async updateCardByToken(token, card) {
    if (!token) return { ok: false, error: "Missing Lark card update token" };
    const response = await fetch("https://open.feishu.cn/open-apis/interactive/v1/card/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, card }),
    });
    return larkDeliveryResult(response, { messageIds: [], totalParts: 1 });
  }

  async replyMessage(messageId, { msgType, chunks }) {
    if (!messageId) return { ok: false, error: "Missing Lark message id" };
    if (!this.appId || !this.appSecret) return { ok: false, error: "Missing Lark appId/appSecret" };
    const token = await this.#tenantToken();
    if (!token) return { ok: false, error: "Missing Lark tenant access token" };
    const messageIds = [];
    for (const chunk of chunks) {
      const response = await fetch(`https://open.feishu.cn/open-apis/im/v1/messages/${messageId}/reply`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          msg_type: msgType,
          content: JSON.stringify(chunk),
        }),
      });
      const result = await larkDeliveryResult(response, { messageIds, totalParts: chunks.length });
      if (!result.ok) return result;
      const deliveredId = result.data?.data?.message_id || result.data?.data?.messageId || "";
      if (deliveredId) messageIds.push(deliveredId);
    }
    return {
      ok: true,
      status: 200,
      code: 0,
      messageId: messageIds[0] || "",
      messageIds,
      deliveredParts: chunks.length,
      totalParts: chunks.length,
    };
  }

  async sendMessage(receiveId, { receiveIdType = "chat_id", msgType, chunks }) {
    if (!receiveId) return { ok: false, error: "Missing Lark receive id" };
    if (!this.appId || !this.appSecret) return { ok: false, error: "Missing Lark appId/appSecret" };
    const token = await this.#tenantToken();
    if (!token) return { ok: false, error: "Missing Lark tenant access token" };
    const safeReceiveIdType = encodeURIComponent(receiveIdType || "chat_id");
    const messageIds = [];
    for (const chunk of chunks) {
      const response = await fetch(`https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${safeReceiveIdType}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          receive_id: receiveId,
          msg_type: msgType,
          content: JSON.stringify(chunk),
        }),
      });
      const result = await larkDeliveryResult(response, { messageIds, totalParts: chunks.length });
      if (!result.ok) return result;
      const deliveredId = result.data?.data?.message_id || result.data?.data?.messageId || "";
      if (deliveredId) messageIds.push(deliveredId);
    }
    return {
      ok: true,
      status: 200,
      code: 0,
      messageId: messageIds[0] || "",
      messageIds,
      deliveredParts: chunks.length,
      totalParts: chunks.length,
    };
  }

  async #tenantToken() {
    if (this.tenantToken && Date.now() < this.tenantTokenExpiresAt) return this.tenantToken;
    const response = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: this.appId, app_secret: this.appSecret }),
    });
    if (!response.ok) return "";
    const data = await response.json();
    if (data.code === 0 && data.tenant_access_token) {
      this.tenantToken = data.tenant_access_token;
      this.tenantTokenExpiresAt = Date.now() + Math.max(60, Number(data.expire || 3600) - 60) * 1000;
      return this.tenantToken;
    }
    return "";
  }
}

async function larkDeliveryResult(response, { messageIds = [], totalParts = 1 } = {}) {
  const data = await readJsonSafe(response);
  const code = data?.code;
  const larkOk = code === undefined || code === 0;
  if (!response.ok || !larkOk) {
    return {
      ok: false,
      status: response.status,
      code,
      error: data?.msg || data?.message || data?.error || response.statusText || "Lark request failed",
      messageIds,
      deliveredParts: messageIds.length,
      totalParts,
    };
  }
  return {
    ok: true,
    status: response.status,
    code: code || 0,
    data,
  };
}

export function truncateForLark(text, max = 3000) {
  const value = String(text || "");
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n\n... truncated`;
}

export function splitForLarkText(text, max = 2800) {
  const value = String(text || "");
  if (!value) return [""];
  if (value.length <= max) return [value];

  const chunks = [];
  let current = "";
  const pushCurrent = () => {
    if (current) {
      chunks.push(current);
      current = "";
    }
  };

  for (const line of value.split(/(\n)/)) {
    if (!line) continue;
    if (line.length > max) {
      pushCurrent();
      for (let index = 0; index < line.length; index += max) {
        chunks.push(line.slice(index, index + max));
      }
      continue;
    }
    if (current.length + line.length > max) pushCurrent();
    current += line;
  }
  pushCurrent();
  return chunks.length ? chunks : [""];
}

async function readJsonSafe(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
