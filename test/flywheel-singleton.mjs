// test/flywheel-singleton.mjs —— 飞轮 pidfile 单例：函数级、离线、无 Chrome。用临时 pidfile，不碰真台账。
// 跑：node test/flywheel-singleton.mjs （非 0 退出 = 失败）。
import assert from 'node:assert';
import { existsSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireFlywheelSingleton, touchHeartbeat, releaseFlywheelSingleton, readFlywheelStatus, isPidAlive } from '../lib/lockfile.mjs';

const PID = join(tmpdir(), `weilai-run-test-${process.pid}.pid`);
const DEAD = 0x7ffffffe; // 极大 pid，几乎必死
const clean = () => { try { rmSync(PID, { force: true }); } catch (e) {} };
const putPid = (obj) => writeFileSync(PID, JSON.stringify({ startedAt: new Date().toISOString(), ...obj }));
clean();

// 1) 活飞轮（本进程 pid 必活、心跳新鲜）→ 二次 acquire 硬拒 E_SINGLETON
acquireFlywheelSingleton(PID, { channels: ['jie3'] }); // 首次无 pidfile → 抢占成功
assert.throws(() => acquireFlywheelSingleton(PID, { channels: ['jie3'] }), (e) => e.code === 'E_SINGLETON', '活飞轮应硬拒 E_SINGLETON');
console.log('✓ 活飞轮二次启动硬拒 E_SINGLETON');

// 2) 死 pid → 判 stale 抢占成功
putPid({ pid: DEAD, channels: ['jie3'], heartbeatAt: Date.now() });
assert.ok(!isPidAlive(DEAD), '构造的极大 pid 应判死');
acquireFlywheelSingleton(PID, { channels: ['jie6'] }); // 不抛
assert.strictEqual(readFlywheelStatus(PID).pid, process.pid, '抢占后 pidfile 应属本进程');
console.log('✓ 死 pid → stale 抢占');

// 3) 心跳陈旧（pid 活但 heartbeat 老）→ stale 抢占（覆盖 Windows pid 复用）
putPid({ pid: process.pid, channels: ['x'], heartbeatAt: Date.now() - 10 * 60000 });
assert.ok(!readFlywheelStatus(PID).alive, '心跳陈旧应判 not alive');
acquireFlywheelSingleton(PID, { channels: ['jie3'] }); // 不抛（stale 抢占）
assert.ok(readFlywheelStatus(PID).alive, '抢占后应 alive（新心跳）');
console.log('✓ 心跳陈旧 → stale 抢占（根治 pid 复用）');

// 4) touchHeartbeat 刷新 + release 清理（pidfile 属本进程）
const hb0 = JSON.parse(readFileSync(PID, 'utf8')).heartbeatAt;
assert.ok(touchHeartbeat(PID), 'touchHeartbeat 应成功（pidfile 属本进程）');
assert.ok(JSON.parse(readFileSync(PID, 'utf8')).heartbeatAt >= hb0, 'heartbeatAt 应被刷新');
releaseFlywheelSingleton(PID);
assert.ok(!existsSync(PID), 'release 后 pidfile 应删除');
console.log('✓ touchHeartbeat 刷新 + release 清理');

// 5) release/touchHeartbeat 不误动他人 pidfile
putPid({ pid: DEAD, channels: ['x'], heartbeatAt: Date.now() });
releaseFlywheelSingleton(PID);
assert.ok(existsSync(PID), 'release 不应删属他人的 pidfile');
assert.ok(!touchHeartbeat(PID), 'touchHeartbeat 不应刷属他人的 pidfile');
clean();
console.log('✓ release/touchHeartbeat 不误动他人 pidfile');

console.log('\nflywheel-singleton: ALL PASS');
