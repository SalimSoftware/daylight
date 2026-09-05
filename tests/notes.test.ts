import assert from 'node:assert/strict';
import test from 'node:test';
import { createNotesStore } from '../src/notesStore.ts';

const day = '2026-09-05';
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function memoryStorage() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
}

test('failed reads do not enable editing or overwrite existing server notes', async () => {
  let failing = true;
  const store = createNotesStore(async () => failing ? new Response('unavailable', { status: 503 }) : Response.json({ note: { content: 'Existing note' } }));
  await store.load(day);
  assert.equal(store.get(day).status, 'load-error');
  store.change(day, 'Should not overwrite');
  assert.equal(store.hasUnsaved(), false);
  failing = false;
  await store.load(day);
  assert.deepEqual(store.get(day), { content: 'Existing note', status: 'saved' });
});

test('HTTP save failures preserve drafts across navigation and store recreation', async () => {
  const storage = memoryStorage();
  let failing = true;
  const request: typeof fetch = async (_url, options) => {
    if (!options) return Response.json({ note: null });
    return failing ? new Response('', { status: 500 }) : Response.json({ note: JSON.parse(String(options.body)) });
  };
  const store = createNotesStore(request, storage);
  await store.load(day);
  store.change(day, 'Keep my draft');
  await store.flush(day);
  assert.deepEqual(store.get(day), { content: 'Keep my draft', status: 'save-error' });
  const recovered = createNotesStore(request, storage);
  await recovered.load(day);
  assert.equal(recovered.get(day).content, 'Keep my draft');
  failing = false;
  await recovered.flush(day);
  assert.equal(recovered.get(day).status, 'saved');
  assert.equal(storage.getItem(`daylight:draft:${day}`), null);
});

test('writes are serialized and an older completion cannot mark a newer edit saved', async () => {
  const first = deferred<Response>();
  const second = deferred<Response>();
  const writes: string[] = [];
  const store = createNotesStore(async (_url, options) => {
    if (!options) return Response.json({ note: null });
    writes.push(JSON.parse(String(options.body)).content);
    return writes.length === 1 ? first.promise : second.promise;
  });
  await store.load(day);
  store.change(day, 'First');
  const flushing = store.flush(day);
  store.change(day, 'Second');
  assert.deepEqual(writes, ['First']);
  first.resolve(Response.json({ note: { content: 'First' } }));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(writes, ['First', 'Second']);
  assert.deepEqual(store.get(day), { content: 'Second', status: 'saving' });
  second.resolve(Response.json({ note: { content: 'Second' } }));
  await flushing;
  assert.deepEqual(store.get(day), { content: 'Second', status: 'saved' });
});

test('out-of-order reads and immediate navigation keep notes attached to their dates', async () => {
  const oldRead = deferred<Response>();
  const next = '2026-09-06';
  const writes: { url: string; content: string }[] = [];
  const store = createNotesStore(async (url, options) => {
    if (options) {
      const body = JSON.parse(String(options.body));
      writes.push({ url: String(url), content: body.content });
      return Response.json({ note: body });
    }
    return String(url).endsWith(day) ? oldRead.promise : Response.json({ note: { content: 'Next day' } });
  });
  const loading = store.load(day);
  await store.load(next);
  oldRead.resolve(Response.json({ note: { content: 'Old day' } }));
  await loading;
  assert.equal(store.get(next).content, 'Next day');
  store.change(day, 'Last edit before leaving');
  await store.flush(day);
  assert.deepEqual(writes, [{ url: `/api/notes/${day}`, content: 'Last edit before leaving' }]);
  assert.equal(store.get(next).content, 'Next day');
});

test('empty drafts survive reload and unconfirmed saves remain errors', async () => {
  const storage = memoryStorage();
  storage.setItem(`daylight:draft:${day}`, '');
  const store = createNotesStore(async () => Response.json({ note: { content: 'Unexpected old content' } }), storage);
  assert.equal(store.get(day).content, '');
  await store.flush(day);
  assert.equal(store.get(day).status, 'save-error');
  assert.equal(storage.getItem(`daylight:draft:${day}`), '');
});
