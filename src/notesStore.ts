type Status = 'loading' | 'saved' | 'saving' | 'load-error' | 'save-error';
export type NoteState = { content: string; status: Status };
type Entry = {
  state: NoteState; loaded: boolean; dirty: boolean; revision: number;
  timer?: ReturnType<typeof setTimeout>; loading?: Promise<void>; saving?: Promise<void>;
  listeners: Set<() => void>;
};
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function createNotesStore(request: typeof fetch = (...args) => fetch(...args), storage?: Storage) {
  const entries = new Map<string, Entry>();
  const draftKey = (day: string) => `daylight:draft:${day}`;
  function entry(day: string) {
    let value = entries.get(day);
    if (!value) {
      let draft: string | null = null;
      try { draft = storage?.getItem(draftKey(day)) ?? null; } catch { /* In-memory drafts still work when storage is unavailable. */ }
      value = { state: { content: draft ?? '', status: draft === null ? 'loading' : 'save-error' }, loaded: draft !== null, dirty: draft !== null, revision: 0, listeners: new Set() };
      entries.set(day, value);
    }
    return value;
  }
  function update(value: Entry, state: NoteState) {
    value.state = state;
    value.listeners.forEach(listener => listener());
  }
  async function load(day: string) {
    const value = entry(day);
    if (value.loaded) return;
    if (value.loading) return value.loading;
    update(value, { ...value.state, status: 'loading' });
    value.loading = (async () => {
      try {
        const response = await request(`/api/notes/${day}`);
        if (!response.ok) throw new Error('Note could not be loaded.');
        const result = await response.json();
        if (!result || !('note' in result) || (result.note !== null && typeof result.note?.content !== 'string')) throw new Error('Invalid note response.');
        value.loaded = true;
        update(value, { content: result.note?.content ?? '', status: 'saved' });
      } catch { update(value, { ...value.state, status: 'load-error' }); }
      finally { value.loading = undefined; }
    })();
    return value.loading;
  }
  async function flush(day: string): Promise<void> {
    const value = entry(day);
    clearTimeout(value.timer);
    value.timer = undefined;
    if (value.saving) return value.saving;
    if (!value.dirty) return;
    const revision = value.revision;
    const content = value.state.content;
    update(value, { ...value.state, status: 'saving' });
    // Serialize writes for each date so an older save cannot overwrite a newer edit.
    value.saving = (async () => {
      try {
        const response = await request(`/api/notes/${day}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }), keepalive: true });
        if (!response.ok) throw new Error('Note could not be saved.');
        const result = await response.json();
        if (result?.note?.content !== content) throw new Error('Save was not confirmed.');
        if (value.revision === revision) {
          value.dirty = false;
          try { storage?.removeItem(draftKey(day)); } catch { /* Keep the server-confirmed state if storage is unavailable. */ }
          update(value, { content, status: 'saved' });
        }
      } catch {
        if (value.revision === revision) update(value, { ...value.state, status: 'save-error' });
      } finally {
        value.saving = undefined;
      }
    })();
    await value.saving;
    if (value.dirty && value.revision !== revision) await flush(day);
  }
  return {
    get: (day: string) => entry(day).state,
    subscribe(day: string, listener: () => void) {
      const value = entry(day);
      value.listeners.add(listener);
      return () => { value.listeners.delete(listener); };
    },
    load, flush,
    change(day: string, content: string) {
      const value = entry(day);
      if (!value.loaded) return;
      value.revision++;
      value.dirty = true;
      try { storage?.setItem(draftKey(day), content); } catch { /* Navigation is still protected by the in-memory draft. */ }
      update(value, { content, status: 'saving' });
      clearTimeout(value.timer);
      value.timer = setTimeout(() => { void flush(day); }, 650);
    },
    hasUnsaved: () => [...entries.values()].some(value => value.dirty),
    flushAll: () => Promise.all([...entries.keys()].map(flush)),
  };
}

let storage: Storage | undefined;
try { storage = globalThis.localStorage; } catch { /* Storage may be blocked by browser settings. */ }
export const notesStore = createNotesStore(undefined, storage);
