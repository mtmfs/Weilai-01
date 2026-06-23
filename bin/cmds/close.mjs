// close：优雅关闭目标通道的调试 Chrome 实例（CDP Browser.close，只关该 port 那一个）。
// ★铁律：重置 Chrome 一律用这个，绝不用 Stop-Process/taskkill chrome —— 那会杀光用户正常浏览器，
//   且强杀触发 Crashpad 崩溃转储填满 C 盘。Browser.close 优雅退出、保登录态、零崩溃转储。
import { loadConfig } from '../../lib/config.mjs';
import { connectBrowser } from '../../lib/cdp.mjs';
import { log, out } from '../../lib/log.mjs';

export async function runClose({ flags, pos }) {
  const id = pos[0];
  if (id !== 'jie3' && id !== 'jie6') { const e = new Error('用法: weilai close <jie3|jie6>'); e.code = 'E_USAGE'; throw e; }
  const port = loadConfig(id).target.port;
  let ok = false, note = '';
  try {
    const b = await connectBrowser(port);
    await b.send('Browser.close');
    b.close();
    ok = true; note = `已优雅关闭调试 Chrome :${port}（只关此实例，保登录态）`;
    log.ok(note);
  } catch (e) {
    note = `:${port} 没在跑或已关（${e.message}）`;
    log.warn(note);
  }
  if (flags.json) out({ command: 'close', target: id, port, closed: ok, note });
}
