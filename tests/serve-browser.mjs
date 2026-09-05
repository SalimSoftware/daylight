import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const development = process.argv[2] === 'development';
const directory = mkdtempSync(join(tmpdir(), 'daylight-browser-'));
const env = { ...process.env, PORT: development ? '8789' : '8788', APP_URL: 'http://localhost:5174', DAYLIGHT_DEV: development ? '1' : '', DAYLIGHT_DATA_DIR: directory, GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', MICROSOFT_CLIENT_ID: '' };
const children = [spawn(process.execPath, ['dist-server/index.mjs'], { env, stdio: 'inherit' })];
if (development) children.push(spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { env, stdio: 'inherit' }));
let stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  await Promise.all(children.map(child => new Promise(resolve => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once('exit', resolve);
    child.kill('SIGTERM');
  })));
  rmSync(directory, { recursive: true, force: true });
  process.exit(code);
}
process.on('SIGTERM', () => { void stop(); });
process.on('SIGINT', () => { void stop(); });
children.forEach(child => {
  child.on('error', error => { console.error(error); void stop(1); });
  child.on('exit', code => { if (!stopping) void stop(code || 1); });
});
