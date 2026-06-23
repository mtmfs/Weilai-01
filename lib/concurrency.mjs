// lib/concurrency.mjs —— 极简 p-limit。并行 ffmpeg / 并发 API 都用它限流。
export function pLimit(n) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= n || queue.length === 0) return;
    active++;
    const { fn, res, rej } = queue.shift();
    Promise.resolve().then(fn).then(
      v => { active--; res(v); next(); },
      e => { active--; rej(e); next(); }
    );
  };
  return fn => new Promise((res, rej) => { queue.push({ fn, res, rej }); next(); });
}

// 对 items 以并发 n 跑 fn(item,i)，保序返回结果数组。
export async function mapLimit(items, n, fn) {
  const limit = pLimit(Math.max(1, n));
  return Promise.all(items.map((it, i) => limit(() => fn(it, i))));
}
