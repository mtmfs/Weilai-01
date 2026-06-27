// lib/tier.mjs —— 主管级解锁闸（隔离烧钱通道 paid）。
// v1：环境变量解锁。普通用户看不到也跑不了 paid 命令；主管设 WEILAI_SUPERVISOR=1 后解锁。
// 解锁与否只控制"付费通道命令是否可见/可跑"，不碰异步/台账/上传核心。
export function supervisorUnlocked() {
  const v = process.env.WEILAI_SUPERVISOR;
  return v === '1' || v === 'true' || v === 'yes';
}
