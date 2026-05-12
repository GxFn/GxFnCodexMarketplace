const SECRET_KEY_RE = /^(?:appSecret|secret|verificationToken|encryptKey|token|accessToken|refreshToken|authorization|password|apiKey)$/i;

export function sanitizeBridgeStatus(value) {
  const sanitized = sanitizeValue(value);
  if (sanitized?.config) sanitized.config = sanitizeConfig(value.config);
  if (sanitized?.data?.config) sanitized.data.config = sanitizeConfig(value.data.config);
  return sanitized;
}

export function sanitizeConfig(config = {}) {
  const sanitized = sanitizeValue(config);
  if (sanitized?.lark) {
    sanitized.lark.allowedUsers = Array.isArray(config.lark?.allowedUsers)
      ? `[${config.lark.allowedUsers.length} configured]`
      : config.lark?.allowedUsers;
    if (config.lark?.appId) sanitized.lark.appId = maskId(config.lark.appId);
  }
  return sanitized;
}

function sanitizeValue(value, key = "", seen = new WeakSet()) {
  if (value == null) return value;
  if (typeof value !== "object") {
    if (SECRET_KEY_RE.test(key) && String(value).trim()) return "[configured]";
    if (/^appId$/i.test(key) && String(value).trim()) return maskId(value);
    return value;
  }
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, key, seen));
  const output = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    output[childKey] = sanitizeValue(childValue, childKey, seen);
  }
  return output;
}

function maskId(value) {
  const text = String(value || "");
  if (text.length <= 8) return text ? "[configured]" : "";
  return `${text.slice(0, 6)}...${text.slice(-4)}`;
}
