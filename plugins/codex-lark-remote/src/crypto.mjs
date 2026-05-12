import crypto from "node:crypto";

export function decryptLarkPayload(encrypted, encryptKey) {
  if (!encryptKey) throw new Error("Encrypted Lark event received but encryptKey is not configured");
  const data = Buffer.from(String(encrypted || ""), "base64");
  if (data.length <= 16) throw new Error("Encrypted Lark event payload is too short");
  const key = crypto.createHash("sha256").update(String(encryptKey), "utf8").digest();
  const iv = data.subarray(0, 16);
  const ciphertext = data.subarray(16);
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  return JSON.parse(plaintext);
}

export function encryptLarkPayload(payload, encryptKey, iv = crypto.randomBytes(16)) {
  if (!encryptKey) throw new Error("encryptKey is required");
  const key = crypto.createHash("sha256").update(String(encryptKey), "utf8").digest();
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  const plaintext = Buffer.from(typeof payload === "string" ? payload : JSON.stringify(payload), "utf8");
  return Buffer.concat([iv, cipher.update(plaintext), cipher.final()]).toString("base64");
}

export function verifyLarkSignature({ rawBody, headers, encryptKey }) {
  if (!encryptKey) return { checked: false, ok: true };
  const signature = headerValue(headers, "x-lark-signature");
  const timestamp = headerValue(headers, "x-lark-request-timestamp");
  const nonce = headerValue(headers, "x-lark-request-nonce");
  if (!signature && !timestamp && !nonce) return { checked: false, ok: true };
  if (!signature || !timestamp || !nonce) return { checked: true, ok: false, reason: "Missing Lark signature headers" };

  const computed = createLarkSignature({ timestamp, nonce, encryptKey, rawBody });
  return {
    checked: true,
    ok: timingSafeEqualHex(computed, signature),
    reason: "Invalid Lark signature",
  };
}

export function createLarkSignature({ timestamp, nonce, encryptKey, rawBody }) {
  return crypto
    .createHash("sha256")
    .update(`${timestamp}${nonce}${encryptKey}${rawBody}`)
    .digest("hex");
}

function headerValue(headers, name) {
  return headers?.[name] || headers?.[name.toLowerCase()] || "";
}

function timingSafeEqualHex(left, right) {
  const a = Buffer.from(String(left), "hex");
  const b = Buffer.from(String(right), "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
