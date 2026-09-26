import { spawn, spawnSync } from 'node:child_process';
import { existsSync, copyFileSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { parse } from '../backend/node_modules/dotenv/lib/main.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const backend = resolve(root, 'backend');
const onlyBackend = process.argv.includes('--backend-only');
if (!existsSync(resolve(backend, '.env'))) copyFileSync(resolve(backend, '.env.example'), resolve(backend, '.env'));
const config = { ...parse(readFileSync(resolve(backend, '.env'))), ...process.env };
const port = Number(config.PORT || 3001);
const host = config.HOST === '0.0.0.0' ? '127.0.0.1' : config.HOST || '127.0.0.1';
const api = `http://${host}:${port}`;
const children = [];
let stopping = false;
function stop(code = 0) { if (stopping) return; stopping = true; for (const child of children) child.kill(); process.exitCode = code; }
process.on('SIGINT', () => stop()); process.on('SIGTERM', () => stop());
function launch(args, cwd, env = process.env) {
  const child = spawn(process.execPath, args, { cwd, stdio: 'inherit', windowsHide: true, env }); children.push(child);
  child.on('error', e => { console.error(e.message); stop(1); });
  child.on('exit', code => { if (!stopping) stop(code || 0); });
  return child;
}
async function occupied(port) { return new Promise(resolve => { const socket = net.connect({ host: '127.0.0.1', port }); socket.setTimeout(1000); socket.once('connect', () => { socket.destroy(); resolve(true); }); socket.once('error', () => { socket.destroy(); resolve(false); }); socket.once('timeout', () => { socket.destroy(); resolve(false); }); }); }
async function health() { try { return await (await fetch(`${api}/health`, { signal: AbortSignal.timeout(1500) })).json(); } catch { return null; } }
async function main() {
  if (await occupied(port)) {
    const current = await health();
    if (current?.service !== 'routewise' || current?.flowVersion !== 1) throw new Error(`Port ${port} is occupied by an older or different server. Press Ctrl+C in its terminal, then run this launcher again.`);
    console.log(`Reusing RouteWise backend at ${api} (${current.dataMode}).`);
  } else {
    const tsc = resolve(backend, 'node_modules/typescript/bin/tsc');
    if (!existsSync(tsc)) throw new Error('Install backend dependencies first: cd backend, then pnpm install.');
    const build = spawnSync(process.execPath, [tsc, '-p', 'tsconfig.build.json'], { cwd: backend, stdio: 'inherit', windowsHide: true });
    if (build.status !== 0) throw new Error('Backend build failed.');
    launch([resolve(backend, 'dist/src/server.js')], backend);
    for (let attempt = 0; attempt < 40; attempt++) { if (await health()) break; if (stopping) throw new Error('Backend stopped during startup.'); await new Promise(r => setTimeout(r, 250)); }
    if (!(await health())) throw new Error('Backend did not become ready.');
  }
  console.log(`API documentation: ${api}/docs/`);
  if (onlyBackend) return;
  if (await occupied(3000)) {
    let own = false;
    try { own = (await (await fetch('http://localhost:3000/backend-check', { signal: AbortSignal.timeout(15000) })).text()).includes('RouteWise • Connection check'); } catch {}
    if (!own) throw new Error('Port 3000 is occupied by another app. Stop that app or run --backend-only.');
    console.log('Reusing RouteWise frontend at http://localhost:3000/backend-check');
  } else {
    const next = resolve(root, 'node_modules/next/dist/bin/next');
    if (!existsSync(next)) throw new Error('Install frontend dependencies first: npm install in the project root.');
    launch([next, 'dev', '--hostname', '127.0.0.1', '--port', '3000'], root, { ...process.env, ROUTEWISE_API_URL: api });
  }
  console.log('Open http://localhost:3000/backend-check . Keep this terminal open. Ctrl+C stops only servers started by this launcher.');
}
main().catch(error => { console.error(error.message); stop(1); });
