// test/bindmid-test.mjs —— jie6 mid 捕获纯函数离线单测：parseBindMids(真实结构+大小写join) / mergeMids + cmpMid 字典序回归。
// 真实结构样本取自 2026-07-02 真号 jie6 抓包（bind-video-to-owner）。跑：node test/bindmid-test.mjs（非 0 退出=失败）。
import assert from 'node:assert';
import { parseBindMids, mergeMids } from '../lib/bindmid.mjs';
import { cmpMid, pickSubmittedMids } from '../lib/upload.mjs';
import { norm } from '../lib/cdp.mjs';

// ── cmpMid：长度优先再字典序 = 非负整数数值序（修跨位数选错） ──
assert.ok(cmpMid('1000', '999') > 0, '"1000" > "999"');
assert.ok(cmpMid('999', '1000') < 0, '"999" < "1000"');
assert.strictEqual(cmpMid('123', '123'), 0, '相等');
assert.ok(cmpMid('abc', 'abd') < 0, '非数字回退字典序');
console.log('✓ cmpMid 长度优先字典序');

// ── pickSubmittedMids：跨位数取 max + isDel 跳过 ──
{
  const platform = [
    { name: 'v1', id: '999', isDel: false }, { name: 'v1', id: '1000', isDel: false },
    { name: 'v2', id: '500', isDel: true }, { name: 'v2', id: '400', isDel: false },
  ];
  const m = pickSubmittedMids(platform, [norm('v1'), norm('v2')]);
  assert.strictEqual(m.get(norm('v1')), '1000', 'v1 取 max 1000（非字典序 999）');
  assert.strictEqual(m.get(norm('v2')), '400', 'v2 取 400（500 isDel 跳过）');
  console.log('✓ pickSubmittedMids 跨位数取 max + isDel 跳过');
}

// ── parseBindMids：真实结构（req vids + resp vidToMidMap，★大小写不敏感 join） ──
{
  // 真号实测样本：req video_id 全小写，resp vidToMidMap key 混合大小写
  const events = [{
    url: 'https://qianchuan.jinritemai.com/ad/api/creation/material/bind-video-to-owner?aavid=x',
    reqBody: JSON.stringify({ vids: [{ file_name: '6.26-魏文彬-A.mp4', video_id: 'v0dc8eg10000d92ujonog65vo4sgrid0' }] }),
    respBody: JSON.stringify({ data: { vidToMidMap: { 'v0Dc8Eg10000D92Ujonog65Vo4Sgrid0': '7657783787443699750' } }, status_code: 0, message: 'success' }),
  }];
  const { midByName, sawBind } = parseBindMids(events, { norm, kw: '魏文彬' });
  assert.ok(sawBind, 'sawBind=true');
  assert.strictEqual(midByName.get(norm('6.26-魏文彬-A.mp4')), '7657783787443699750', '大小写不敏感 join 拿到 mid');
  console.log('✓ parseBindMids 真实结构 + 大小写不敏感 join（真号回归）');
}
{
  // 多文件 + kw 过滤
  const events = [{
    url: 'x/bind-video-to-owner',
    reqBody: JSON.stringify({ vids: [{ file_name: '魏文彬-A.mp4', video_id: 'VID1' }, { file_name: '张三-B.mp4', video_id: 'VID2' }] }),
    respBody: JSON.stringify({ data: { vidToMidMap: { vid1: 'M1', vid2: 'M2' } } }),
  }];
  const { midByName } = parseBindMids(events, { norm, kw: '魏文彬' });
  assert.strictEqual(midByName.get(norm('魏文彬-A.mp4')), 'M1', 'kw 命中件 join');
  assert.ok(!midByName.has(norm('张三-B.mp4')), '非 kw 件被过滤');
  console.log('✓ parseBindMids 多文件 + kw 过滤');
}
{
  // 非 bind url / 坏 body / 空 / resp 缺 vidToMidMap → 安全无崩
  assert.strictEqual(parseBindMids([{ url: 'x/other', reqBody: '{}', respBody: '{}' }], { norm }).midByName.size, 0, '非 bind url 跳过');
  assert.strictEqual(parseBindMids([{ url: 'x/bind-video-to-owner', reqBody: 'bad', respBody: 'bad' }], { norm }).midByName.size, 0, '坏 body 安全');
  assert.strictEqual(parseBindMids([], { norm }).midByName.size, 0, '空 events');
  assert.strictEqual(parseBindMids([{ url: 'x/bind-video-to-owner', reqBody: JSON.stringify({ vids: [{ file_name: '魏文彬-x.mp4', video_id: 'v1' }] }), respBody: JSON.stringify({ data: {} }) }], { norm, kw: '魏文彬' }).midByName.size, 0, 'resp 无 vidToMidMap → 无 mid');
  console.log('✓ parseBindMids 非bind/坏body/空/缺map 安全');
}

// ── mergeMids：primary 覆盖 secondary + null 安全 ──
{
  const p = new Map([['a', 'P1'], ['b', 'P2']]), s = new Map([['b', 'S2'], ['c', 'S3']]);
  const m = mergeMids(p, s);
  assert.strictEqual(m.get('a'), 'P1'); assert.strictEqual(m.get('b'), 'P2'); assert.strictEqual(m.get('c'), 'S3'); assert.strictEqual(m.size, 3);
  assert.strictEqual(mergeMids(null, null).size, 0, 'null 安全');
  console.log('✓ mergeMids primary 覆盖 + secondary 填补 + null 安全');
}

console.log('\nbindmid-test 全部通过 ✓');
