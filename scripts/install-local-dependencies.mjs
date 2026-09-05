import { copyFileSync, existsSync, lstatSync, mkdirSync, renameSync, rmSync, symlinkSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const key = createHash('sha256').update(project).digest('hex').slice(0, 12);
const cache = join(homedir(), 'Library', 'Caches', 'Daylight', key);
mkdirSync(cache, { recursive: true });
for (const name of ['package.json', 'package-lock.json']) copyFileSync(join(project, name), join(cache, name));
const installed = spawnSync('npm', ['ci', '--fetch-retries=0', '--fetch-timeout=30000'], { cwd: cache, stdio: 'inherit' });
if (installed.status !== 0) process.exit(installed.status || 1);

const modules = join(project, 'node_modules');
const backup = join(project, `.daylight-dependencies-${randomUUID()}`);
const hadModules = existsSync(modules) || (() => { try { return lstatSync(modules).isSymbolicLink(); } catch { return false; } })();
if (hadModules) renameSync(modules, backup);
try {
  symlinkSync(join(cache, 'node_modules'), modules, 'dir');
} catch (error) {
  if (hadModules) renameSync(backup, modules);
  throw error;
}
if (hadModules) rmSync(backup, { recursive: true, force: true });
console.log(`Dependencies installed outside the synced Desktop: ${cache}`);
