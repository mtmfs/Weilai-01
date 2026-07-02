// test/bindmid-test.mjs —— jie6 mid 捕获纯函数离线单测（无 CDP）：getPath/extractPairs/parseBindMids/mergeMids + cmpMid 字典序回归。
// 跑：node test/bindmid-test.mjs （非 0 退出 = 失败）。真号只需填 BIND_FIELDS 字段路径 + selectors.bindVideo，控制流由这些单测锁死。
import assert from 'node:assert';
import { getPath, extractPairs, parseBindMids, mergeMids, BIND_FIELDS } from '../lib/bindmid.mjs';
import { cmpMid, pickSubmittedMids } from '../lib/upload.mjs';
import { norm } from '../lib/cdp.mjs';

// ── cmpMid：长度优先再字典序 = 非负整数数值序（修旧「String>String」跨位数选错） ──
assert.ok(cmpMid('1000', '999') > 0, '"1000" > "999"（数值序，非字典序）');
assert.ok(cmpMid('999', '1000') < 0, '"999" < "1000"');
assert.strictEqual(cmpMid('123', '123'), 0, '相等');
assert.ok(cmpMid('7300000000000002000', '7300000000000001999') > 0, '同位数长雪花按字典序=数值序');
assert.ok(cmpMid('abc', 'abd') < 0, '非数字回退字典序');
console.log('✓ cmpMid 长度优先字典序（修跨位数选错）');

// ── pickSubmittedMids：每名取 max-mid（用 cmpMid，跨位数正确）+ isDel 跳过 ──
{
  const platform = [
    { name: 'v1', id: '999', isDel: false },
    { name: 'v1', id: '1000', isDel: false }, // 更大（数值），旧字典序会误选 999
    { name: 'v2', id: '500', isDel: true },   // isDel 跳过
    { name: 'v2', id: '400', isDel: false },
  ];
  const m = pickSubmittedMids(platform, [norm('v1'), norm('v2')]);
  assert.strictEqual(m.get(norm('v1')), '1000', 'v1 取 max-mid 1000（非字典序 999）');
  assert.strictEqual(m.get(norm('v2')), '400', 'v2 取 400（500 被 isDel 跳过）');
  console.log('✓ pickSubmittedMids 跨位数取 max + isDel 跳过');
}

// ── getPath ──
assert.strictEqual(getPath({ a: { b: 1 } }, 'a.b'), 1);
assert.deepStrictEqual(getPath({ x: [1] }, ''), { x: [1] });   // '' 返自身
assert.strictEqual(getPath({}, 'a.b.c'), undefined);           // 中途缺
assert.strictEqual(getPath(null, 'a'), undefined);
console.log('✓ getPath 点分键 + 空路径返自身 + 缺路径 undefined');

// 测试字段（模拟真号确认后的字段路径；控制流不随之变）
const F = { bind: { list: 'materials', name: 'file_name', vid: 'video_id', mid: null }, create: { list: 'materials', vid: 'video_id', mid: 'material_id' } };

// ── extractPairs ──
{
  const req = JSON.stringify({ materials: [{ file_name: '魏文彬-A.mp4', video_id: 'vid1' }] });
  const pairs = extractPairs(req, null, F.bind);
  assert.strictEqual(pairs.length, 1);
  assert.strictEqual(pairs[0].name, '魏文彬-A.mp4');
  assert.strictEqual(pairs[0].vid, 'vid1');
  assert.strictEqual(pairs[0].mid, null);
  console.log('✓ extractPairs 抽 name/vid');
}
{
  assert.deepStrictEqual(extractPairs('not json', null, F.bind), [], '坏 JSON');
  assert.deepStrictEqual(extractPairs(null, null, F.bind), [], 'null body');
  assert.deepStrictEqual(extractPairs(JSON.stringify({ materials: 'x' }), null, F.bind), [], 'list 非数组');
  console.log('✓ extractPairs 坏 body/缺字段安全忽略');
}

// ── parseBindMids：两跳 join / 直接给 mid / kw 过滤 / 空 ──
{
  const events = [
    { url: 'x/bind-video-to-owner', reqBody: JSON.stringify({ materials: [{ file_name: '魏文彬-A.mp4', video_id: 'vid1' }, { file_name: '魏文彬-B.mp4', video_id: 'vid2' }] }), respBody: null },
    { url: 'x/material/create', reqBody: null, respBody: JSON.stringify({ materials: [{ video_id: 'vid1', material_id: 'mid-A' }, { video_id: 'vid2', material_id: 'mid-B' }] }) },
  ];
  const { midByName, sawBind } = parseBindMids(events, { norm, kw: '魏文彬', fields: F });
  assert.ok(sawBind, 'sawBind=true');
  assert.strictEqual(midByName.get(norm('魏文彬-A.mp4')), 'mid-A', 'A 经 vid1→mid-A 两跳 join');
  assert.strictEqual(midByName.get(norm('魏文彬-B.mp4')), 'mid-B', 'B 经 vid2→mid-B 两跳 join');
  console.log('✓ parseBindMids 两跳 join（name→vid→mid）');
}
{
  const F2 = { bind: { list: 'materials', name: 'file_name', vid: 'video_id', mid: 'material_id' }, create: F.create };
  const events = [{ url: 'x/bind', reqBody: JSON.stringify({ materials: [{ file_name: '魏文彬-C.mp4', video_id: 'vid3', material_id: 'mid-C' }] }), respBody: null }];
  const { midByName } = parseBindMids(events, { norm, kw: '魏文彬', fields: F2 });
  assert.strictEqual(midByName.get(norm('魏文彬-C.mp4')), 'mid-C', 'bind 直接给 mid（优先于 join）');
  console.log('✓ parseBindMids bind 直接给 mid');
}
{
  const events = [{ url: 'x/bind', reqBody: JSON.stringify({ materials: [{ file_name: '张三-X.mp4', video_id: 'vidx' }] }), respBody: null }];
  const { midByName, sawBind } = parseBindMids(events, { norm, kw: '魏文彬', fields: F });
  assert.strictEqual(midByName.size, 0, '非 kw 文件被过滤');
  assert.ok(!sawBind, 'kw 过滤后 sawBind=false');
  console.log('✓ parseBindMids kw 过滤');
}
{
  const { midByName, sawBind } = parseBindMids([], { norm, kw: '魏文彬', fields: F });
  assert.strictEqual(midByName.size, 0);
  assert.ok(!sawBind);
  console.log('✓ parseBindMids 空 events');
}

// ── mergeMids：primary 覆盖 secondary + null 安全 ──
{
  const primary = new Map([['a', 'P1'], ['b', 'P2']]);
  const secondary = new Map([['b', 'S2'], ['c', 'S3']]);
  const m = mergeMids(primary, secondary);
  assert.strictEqual(m.get('a'), 'P1');
  assert.strictEqual(m.get('b'), 'P2', 'primary 覆盖 secondary');
  assert.strictEqual(m.get('c'), 'S3', 'secondary 填补');
  assert.strictEqual(m.size, 3);
  assert.strictEqual(mergeMids(null, null).size, 0, 'null 安全');
  console.log('✓ mergeMids primary 覆盖 + secondary 填补 + null 安全');
}

// ── BIND_FIELDS 占位结构就位（真号只填字段路径值） ──
assert.ok(BIND_FIELDS.bind && BIND_FIELDS.create, 'BIND_FIELDS 有 bind/create 段');
console.log('✓ BIND_FIELDS 占位结构就位（真号填字段路径）');

console.log('\nbindmid-test 全部通过 ✓');
