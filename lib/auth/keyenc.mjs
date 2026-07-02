// lib/auth/keyenc.mjs —— 方案 B：令牌内嵌 API key 的对称加解密（AES-256-GCM）。
// 签发侧(wl-issue)加密 → payload.encKeys；客户端(secrets.resolveSecret)解密取出。加解密同一口令。
// ★安全定位：内置口令离线下会被逆向抠出 → 只"抬高提取成本"、非绝对保密（见 docs/加密路线报告.md 代码保护层）。
//   密钥强度不靠口令长度（抠出内置密钥即可直接用），靠混淆/Rust 藏这段逻辑。
import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// 内置口令（与签发脚本共用）。要更硬：换成 32 字节随机 hex 并同步 wl-issue。
const EMBEDDED_KEY_PASSPHRASE = 'onband';

// 口令 → 32 字节 AES-256 密钥。
export function deriveKey(passphrase = EMBEDDED_KEY_PASSPHRASE) {
  return createHash('sha256').update(String(passphrase)).digest();
}

// 加密明文 → base64(iv|tag|ciphertext)。签发侧用。
export function encryptSecret(plain, passphrase = EMBEDDED_KEY_PASSPHRASE) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', deriveKey(passphrase), iv);
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  const tag = c.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

// 解密 base64(iv|tag|ciphertext) → 明文；任何失败返回 null（调用方回退 BYOK，绝不抛断流程）。
export function decryptSecret(b64, passphrase = EMBEDDED_KEY_PASSPHRASE) {
  try {
    const buf = Buffer.from(String(b64), 'base64');
    if (buf.length < 29) return null;
    const iv = buf.subarray(0, 12), tag = buf.subarray(12, 28), ct = buf.subarray(28);
    const d = createDecipheriv('aes-256-gcm', deriveKey(passphrase), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
  } catch (e) { return null; }
}
