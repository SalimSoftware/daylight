import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';

test('production serves the app, assets, calendar state and persistent notes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'daylight-test-'));
  let child: ReturnType<typeof spawn> | undefined;
  async function start() {
    child = spawn(process.execPath, [resolve('dist-server/index.mjs')], {
      env: { ...process.env, PORT: '0', DAYLIGHT_DEV: '', DAYLIGHT_DATA_DIR: directory, GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', MICROSOFT_CLIENT_ID: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return new Promise<string>((done, reject) => {
      const timeout = setTimeout(() => reject(new Error('Server startup timed out')), 10000);
      child!.once('exit', code => { clearTimeout(timeout); reject(new Error(`Server exited with ${code}`)); });
      child!.once('error', error => { clearTimeout(timeout); reject(error); });
      child!.stdout!.on('data', chunk => {
        const match = String(chunk).match(/Open Daylight: (http:\/\/localhost:\d+)/);
        if (match) { clearTimeout(timeout); done(match[1]); }
      });
    });
  }
  async function stop() {
    if (!child || child.exitCode !== null) return;
    const exited = once(child, 'exit');
    child.kill();
    await exited;
  }
  try {
    let url = await start();
    const home = await fetch(url);
    assert.equal(home.status, 200);
    const html = await home.text();
    assert.match(html, /Daylight/);
    const asset = html.match(/src="(\/assets\/[^\"]+\.js)"/)?.[1];
    assert.ok(asset);
    const script = await fetch(`${url}${asset}`);
    assert.equal(script.status, 200);
    assert.match(script.headers.get('content-type')!, /javascript/);
    assert.equal((await fetch(`${url}/assets/missing.js`)).status, 404);
    assert.equal((await fetch(`${url}/assets/missing`)).status, 404);
    assert.equal((await fetch(`${url}/another-view`)).status, 200);
    assert.equal((await fetch(`${url}/api/missing`)).status, 404);
    assert.deepEqual(await (await fetch(`${url}/api/calendar/events?date=2026-09-05`)).json(), { status: 'unconfigured', events: [] });
    assert.deepEqual(await (await fetch(`${url}/api/calendar/events?date=2026-09-05&provider=outlook`)).json(), { status: 'unconfigured', events: [] });
    assert.equal((await fetch(`${url}/api/calendar/connect?provider=outlook`)).status, 503);
    const callback = await fetch(`${url}/api/calendar/microsoft/callback?code=untrusted&state=untrusted`, { redirect: 'manual' });
    assert.equal(callback.status, 302);
    assert.equal(new URL(callback.headers.get('location')!).searchParams.get('calendar'), 'invalid-state');
    assert.equal((await fetch(`${url}/api/calendar/microsoft/disconnect`, { method: 'POST', headers: { Origin: 'https://unrelated.example' } })).status, 403);
    assert.equal((await fetch(`${url}/api/notes/2026-09-05`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 123 }) })).status, 400);
    const save = await fetch(`${url}/api/notes/2026-09-05`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'Persistent test note' }) });
    assert.equal(save.status, 200);
    await stop();
    url = await start();
    const note = await (await fetch(`${url}/api/notes/2026-09-05`)).json();
    assert.equal(note.note.content, 'Persistent test note');
  } finally {
    await stop();
    await rm(directory, { recursive: true, force: true });
  }
});
