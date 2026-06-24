// lib/bandit.mjs —— Beta-Bernoulli Thompson 采样（S5：hold-submit 择时用）。
// 每条臂（如 24 个 hour-of-day）维护 Beta(成功+1, 失败+1) 后验；每次决策从各臂采样、选最大者
// → 自动平衡探索/利用、自适应平台漂移。纯函数、无运行时依赖（Math.random 驱动）。
// 消费方=hold-submit 择时调度器（Phase 3/4 提供「提交时段→过审/被拒」数据后接入）；本模块先就位、可独立单测。

// Box-Muller 标准正态
function gaussian() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Marsaglia-Tsang：Gamma(shape, scale=1) 采样。shape<1 用 boost 递归；本模块用法 shape>=1（成功/失败+1）。
function sampleGamma(shape) {
  if (shape < 1) return sampleGamma(shape + 1) * Math.pow(Math.random(), 1 / shape);
  const d = shape - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x, v;
    do { x = gaussian(); v = 1 + c * x; } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

// 从 Beta(alpha, beta) 采一个样本（alpha,beta>0）。Beta = G(α)/(G(α)+G(β))。
export function sampleBeta(alpha, beta) {
  const x = sampleGamma(alpha), y = sampleGamma(beta);
  return x + y === 0 ? 0.5 : x / (x + y);
}

// arms: { key: {s:成功数, f:失败数} }。Thompson：各臂 Beta(s+1,f+1) 采样，返回采样得分最高的 key。
// keys 可选：限定参与的臂子集（如只在某些时段允许提交）。无臂返回 null。
export function chooseArm(arms = {}, { keys } = {}) {
  const ks = keys && keys.length ? keys : Object.keys(arms);
  if (!ks.length) return null;
  let best = null, bestScore = -Infinity;
  for (const k of ks) {
    const a = arms[k] || { s: 0, f: 0 };
    const score = sampleBeta((a.s || 0) + 1, (a.f || 0) + 1);
    if (score > bestScore) { bestScore = score; best = k; }
  }
  return best;
}

// 记一次观测：success=过审则 s++，否则 f++。原地更新并返回 arms。
export function update(arms, key, success) {
  const a = arms[key] || (arms[key] = { s: 0, f: 0 });
  if (success) a.s++; else a.f++;
  return arms;
}

// 各臂后验均值 (s+1)/(s+f+2)，供报表/诊断（确定性，非随机）。
export function posteriorMean(arms = {}) {
  const out = {};
  for (const k of Object.keys(arms)) { const a = arms[k]; out[k] = (a.s + 1) / (a.s + a.f + 2); }
  return out;
}
