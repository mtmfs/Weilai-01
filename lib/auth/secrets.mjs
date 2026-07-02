import { authErr } from './shared.mjs';
import { authSummary, loadAuthToken, secretAllowed } from './token.mjs';
import { decryptSecret } from './keyenc.mjs';

const SECRET_RESOLVERS = {
  'openai.apiKey': {
    feature: 'api.openai',
    mode: 'byok',
    env: ['WEILAI_OPENAI_API_KEY', 'OPENAI_API_KEY'],
  },
};

export function maskSecret(value) {
  const s = String(value || '');
  if (!s) return '';
  if (s.length <= 8) return '*'.repeat(s.length);
  return `${s.slice(0, 3)}...${s.slice(-4)}`;
}

function resolverFor(name) {
  const r = SECRET_RESOLVERS[name];
  if (!r) throw authErr('E_USAGE', `未知 secret：${name}`);
  return r;
}

export function declaredSecrets() {
  const verified = loadAuthToken();
  const license = authSummary(verified);
  return {
    license,
    secrets: license.secrets
      .filter((name) => SECRET_RESOLVERS[name])
      .map((name) => {
        const r = SECRET_RESOLVERS[name];
        const source = r.env.find((k) => !!process.env[k]) || null;
        return { name, mode: r.mode, feature: r.feature, configured: !!source, source };
      }),
  };
}

export function resolveSecret(name, { allowPlaintext = false } = {}) {
  const r = resolverFor(name);
  const verified = loadAuthToken(r.feature);
  if (!secretAllowed(verified.payload.secrets, name)) throw authErr('E_USAGE', `授权 token 未声明 secret：${name}`);
  // ★三级取值：① 令牌内嵌密文 encKeys（方案 B，AES-256-GCM 解密）→ ② BYOK 环境变量 → ③ E_CONFIG。
  let value, source;
  const enc = verified.payload.encKeys && verified.payload.encKeys[name];
  if (enc) { const dec = decryptSecret(enc); if (dec != null) { value = dec; source = 'token:encKeys'; } }
  if (value == null) {
    const envKey = r.env.find((k) => !!process.env[k]);
    if (envKey) { value = process.env[envKey]; source = envKey; }
  }
  if (value == null) throw authErr('E_CONFIG', `${name} 无来源：令牌未内嵌 encKeys 且未配 BYOK 环境变量（${r.env.join(' 或 ')}）`);
  const resolved = { name, mode: r.mode, feature: r.feature, source, masked: maskSecret(value) };
  if (allowPlaintext) resolved.value = value;
  return resolved;
}
