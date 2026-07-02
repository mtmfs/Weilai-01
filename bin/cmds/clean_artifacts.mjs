// clean-artifacts：清运行产物目录。默认 dry-run；--apply 才删除目录内容。
import { ROOT } from '../../lib/config.mjs';
import { cleanArtifacts } from '../../lib/artifacts.mjs';
import { log, out } from '../../lib/log.mjs';

function mb(bytes) {
  return (bytes / 1024 / 1024).toFixed(2);
}

export async function runCleanArtifacts({ flags }) {
  const res = cleanArtifacts(ROOT, { apply: !!flags.apply });
  if (flags.json) {
    out({ command: 'clean-artifacts', ...res });
    return;
  }
  log.step(`${res.applied ? '清理' : '扫描'}运行产物目录`);
  for (const item of res.before) {
    log.info(`${item.name}: ${item.fileCount} 文件 / ${item.dirCount} 目录 / ${mb(item.bytes)} MB`);
    for (const e of item.entries) log.diag(`${e.type === 'dir' ? 'dir ' : 'file'} ${e.path}${e.bytes ? ` (${e.bytes} bytes)` : ''}`);
  }
  if (!res.applied) {
    log.info('dry-run：加 --apply 才真删。');
    return;
  }
  log.ok(`已清理 ${res.totals.fileCount} 文件、${res.totals.dirCount} 目录，释放约 ${mb(res.totals.bytes)} MB`);
}
