/** Bitwarden Secrets Manager's authenticated EncString and access-token key. */
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const base64Pattern = /^[A-Za-z\d+/]+={0,2}$/u;
export function fromBase64(value, length) {
  if (typeof value !== "string" || !base64Pattern.test(value))
    throw new Error("invalid base64");
  const bytes = Buffer.from(value, "base64");
  if (
    (length !== undefined && bytes.length !== length) ||
    value.replace(/=+$/u, "") !== bytes.toString("base64").replace(/=+$/u, "")
  ) {
    throw new Error("invalid base64 length or encoding");
  }
  return bytes;
}

function hmac(key, ...parts) {
  const mac = createHmac("sha256", key);
  for (const part of parts) mac.update(part);
  return mac.digest();
}

/** Secrets Manager access-token HKDF domain, derived from the 16-byte token seed. */
export function deriveAccessKey(seed) {
  const material = hmac("bitwarden-accesstoken", seed);
  const info = "sm-access-token";
  const first = hmac(material, info, Buffer.of(1));
  const second = hmac(material, first, info, Buffer.of(2));
  return Buffer.concat([first, second]);
}

/** EncString type 2 is AES-256-CBC plus HMAC-SHA256 over IV followed by ciphertext. */
export function encrypt(key, value) {
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-cbc", key.subarray(0, 32), iv);
  const bytes = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const mac = hmac(key.subarray(32), iv, bytes);
  return "2." + [iv, bytes, mac].map(part => part.toString("base64")).join("|");
}

export function decrypt(key, value) {
  if (typeof value !== "string" || !value.startsWith("2."))
    throw new Error("unsupported encrypted format");
  const parts = value.slice(2).split("|");
  if (parts.length !== 3) throw new Error("invalid encrypted payload");
  const iv = fromBase64(parts[0], 16);
  const bytes = fromBase64(parts[1]);
  const mac = fromBase64(parts[2], 32);
  if (!timingSafeEqual(mac, hmac(key.subarray(32), iv, bytes)))
    throw new Error("encrypted payload authentication failed");
  const decoder = createDecipheriv("aes-256-cbc", key.subarray(0, 32), iv);
  return new TextDecoder("utf8", { fatal: true, ignoreBOM: true }).decode(
    Buffer.concat([decoder.update(bytes), decoder.final()])
  );
}
