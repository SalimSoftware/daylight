import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { notesStore } from './notesStore';

type View = 'home' | 'calendar' | 'notes';
type Event = { id: string; title: string; start: string; end: string; location: string; description: string; link: string; linkLabel?: string; allDay: boolean };
type CalendarState = 'connected' | 'disconnected' | 'expired' | 'unconfigured' | 'blocked' | 'error';
type CalendarProvider = 'outlook' | 'google';

const monthFormatter = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });
const headlineFormatter = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
const weekdayFormatter = new Intl.DateTimeFormat(undefined, { weekday: 'long' });
const detailDateFormatter = new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
const timeFormatter = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

function localDate(date = new Date()) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function toDate(day: string) { const [year, month, date] = day.split('-').map(Number); return new Date(year, month - 1, date); }
function addDays(day: string, count: number) { const date = toDate(day); date.setDate(date.getDate() + count); return localDate(date); }
function formatTime(value: string, allDay: boolean) { return allDay ? 'All day' : Number.isNaN(Date.parse(value)) ? 'Time unavailable' : timeFormatter.format(new Date(value)); }
function dateKey(date: Date) { return localDate(date); }

function Arrow({ direction }: { direction: 'left' | 'right' }) { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={direction === 'left' ? 'm15 18-6-6 6-6' : 'm9 18 6-6-6-6'} /></svg>; }
function CalendarIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="15" rx="2" /><path d="M7.5 3.5v4M16.5 3.5v4M3.5 10h17" /></svg>; }
function NotesIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3.5h8.5L19 8v12.5H6z" /><path d="M14 3.5V8h5M9 12h6M9 15.5h6" /></svg>; }
function CloseIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>; }

function DayPicker({ selected, onSelect, onClose }: { selected: string; onSelect(day: string): void; onClose(): void }) {
  const [cursor, setCursor] = useState(() => { const date = toDate(selected); return new Date(date.getFullYear(), date.getMonth(), 1); });
  const today = localDate();
  const days = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const start = new Date(first); start.setDate(first.getDate() - ((first.getDay() + 6) % 7));
    return Array.from({ length: 42 }, (_, index) => { const date = new Date(start); date.setDate(start.getDate() + index); return date; });
  }, [cursor]);
  return <div className="picker-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="picker" role="dialog" aria-modal="true" aria-label="Choose a date" onMouseDown={(event) => event.stopPropagation()}>
      <div className="picker-head"><button className="icon-button" aria-label="Previous month" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}><Arrow direction="left" /></button><strong>{monthFormatter.format(cursor)}</strong><button className="icon-button" aria-label="Next month" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}><Arrow direction="right" /></button></div>
      <div className="weekdays">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => <span key={day}>{day}</span>)}</div>
      <div className="calendar-grid">{days.map((date) => { const key = dateKey(date); const outside = date.getMonth() !== cursor.getMonth(); return <button key={key} className={`calendar-day ${outside ? 'outside' : ''} ${key === selected ? 'selected' : ''} ${key === today ? 'today' : ''}`} aria-label={headlineFormatter.format(date)} aria-pressed={key === selected} onClick={() => { onSelect(key); onClose(); }}>{date.getDate()}</button>; })}</div>
      <button className="today-action" onClick={() => { onSelect(today); onClose(); }}>Today</button>
    </section>
  </div>;
}

function App() {
  const [day, setDay] = useState(localDate);
  const [view, setView] = useState<View>(() => new URLSearchParams(window.location.search).has('calendar') ? 'calendar' : 'home');
  const [provider, setProvider] = useState<CalendarProvider>(() => new URLSearchParams(window.location.search).get('provider') === 'google' ? 'google' : 'outlook');
  const [authResult, setAuthResult] = useState(() => new URLSearchParams(window.location.search).get('calendar'));
  const [pickerOpen, setPickerOpen] = useState(false);
  const today = localDate();
  const date = toDate(day);
  const navigate = (amount: number) => setDay(previous => addDays(previous, amount));
  const title = headlineFormatter.format(date);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete('calendar');
    url.searchParams.delete('provider');
    window.history.replaceState(null, '', url);
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!notesStore.hasUnsaved()) return;
      void notesStore.flushAll();
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, []);

  return <main className="app-shell">
    <header className="topbar">
      <button className="brand" onClick={() => setView('home')} aria-label="Go to daily home">daylight</button>
      <button className="today-link" onClick={() => setDay(today)} disabled={day === today}>Today</button>
    </header>
    <section className="day-heading" aria-live="polite">
      <span>{weekdayFormatter.format(date)}</span>
      <h1>{detailDateFormatter.format(date)}</h1>
      <div className="day-controls">
        <button className="round-control" onClick={() => navigate(-1)} aria-label="Previous day"><Arrow direction="left" /></button>
        <button className="date-button" onClick={() => setPickerOpen(true)} aria-label="Open date selector"><CalendarIcon /><span>{title}</span></button>
        <button className="round-control" onClick={() => navigate(1)} aria-label="Next day"><Arrow direction="right" /></button>
      </div>
    </section>
    {view === 'home' && <Home onOpen={setView} />}
    {view === 'calendar' && <CalendarView key={`${day}:${provider}`} day={day} provider={provider} onProviderChange={setProvider} authResult={authResult} onDismissNotice={() => setAuthResult(null)} onBack={() => setView('home')} />}
    {view === 'notes' && <NotesView key={day} day={day} onBack={() => setView('home')} />}
    <footer><button className="calendar-fab" onClick={() => setPickerOpen(true)} aria-label="Choose another day"><CalendarIcon /></button></footer>
    {pickerOpen && <DayPicker selected={day} onSelect={setDay} onClose={() => setPickerOpen(false)} />}
  </main>;
}

function Home({ onOpen }: { onOpen(view: View): void }) {
  return <section className="home-actions" aria-label="Choose an area">
    <button className="area-card calendar-card" onClick={() => onOpen('calendar')}><span className="card-icon"><CalendarIcon /></span><span><strong>Calendar</strong><small>Today's meetings &amp; events</small></span><span className="card-arrow"><Arrow direction="right" /></span></button>
    <button className="area-card notes-card" onClick={() => onOpen('notes')}><span className="card-icon"><NotesIcon /></span><span><strong>Notes</strong><small>Write notes for today</small></span><span className="card-arrow"><Arrow direction="right" /></span></button>
  </section>;
}

function CalendarView({ day, provider, onProviderChange, authResult, onDismissNotice, onBack }: { day: string; provider: CalendarProvider; onProviderChange(value: CalendarProvider): void; authResult: string | null; onDismissNotice(): void; onBack(): void }) {
  const [events, setEvents] = useState<Event[]>([]);
  const [state, setState] = useState<CalendarState>('connected');
  const [loading, setLoading] = useState(true);
  const activeRequest = useRef<AbortController | null>(null);
  const loadEvents = useCallback(async () => {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setLoading(true);
    try {
      const response = await fetch(`/api/calendar/events?date=${day}&provider=${provider}`, { signal: controller.signal });
      if (!response.ok) throw new Error('Calendar could not be loaded.');
      const result = await response.json();
      if (!Array.isArray(result.events)) throw new Error('Invalid calendar response.');
      if (!controller.signal.aborted) { setEvents(result.events); setState(result.status || 'error'); }
    }
    catch { if (!controller.signal.aborted) { setEvents([]); setState('error'); } }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }, [day, provider]);
  useEffect(() => { void loadEvents(); return () => activeRequest.current?.abort(); }, [loadEvents]);
  const disconnect = async () => {
    try {
      const response = await fetch('/api/calendar/microsoft/disconnect', { method: 'POST' });
      if (!response.ok) throw new Error('Disconnect failed.');
      await loadEvents();
    } catch { setState('error'); }
  };
  return <section className="content-view">
    <div className="view-heading"><button className="back-button" onClick={onBack}><Arrow direction="left" /> Back</button><div><span className="eyebrow">Your day</span><h2>Calendar</h2></div><button className="refresh" aria-label="Refresh calendar" title="Refresh calendar" onClick={loadEvents} disabled={loading}>{loading ? 'Refreshing' : 'Refresh'}</button></div>
    <div className="calendar-account"><label htmlFor="calendar-provider">Account</label><select id="calendar-provider" value={provider} onChange={event => { onDismissNotice(); onProviderChange(event.target.value as CalendarProvider); }}><option value="outlook">Outlook (work or school)</option><option value="google">Google Calendar</option></select>{provider === 'outlook' && ['connected', 'expired', 'blocked'].includes(state) && <button className="disconnect" onClick={disconnect}>Disconnect</button>}</div>
    {provider === 'outlook' && authResult && authResult !== 'connected' && <div className="calendar-notice" role="alert"><p>{authResult === 'invalid-state' ? 'This sign-in attempt has expired. Please connect again.' : 'Microsoft sign-in did not finish. If administrator approval is requested, contact your IT team.'}</p><button className="icon-button" aria-label="Dismiss sign-in message" onClick={onDismissNotice}><CloseIcon /></button></div>}
    {loading ? <div className="state"><span className="loader" />Loading your calendar…</div> : state === 'connected' && events.length > 0 ? <div className="event-list">{events.map(event => <article className="event" key={event.id}><time>{formatTime(event.start, event.allDay)}</time><div><h3>{event.title}</h3>{!event.allDay && <p>{formatTime(event.start, false)} – {formatTime(event.end, false)}</p>}{event.location && <p className="event-detail">{event.location}</p>}{event.description && <p className="event-description">{event.description}</p>}{event.link && <a href={event.link} target="_blank" rel="noreferrer">{event.linkLabel || 'Join meeting'} <span>↗</span></a>}</div></article>)}</div> : <CalendarState state={state} provider={provider} onRetry={loadEvents} onReconnect={() => { window.location.href = `/api/calendar/connect?provider=${provider}`; }} />}
  </section>;
}

function CalendarState({ state, provider, onReconnect, onRetry }: { state: CalendarState; provider: CalendarProvider; onReconnect(): void; onRetry(): void }) {
  const name = provider === 'outlook' ? 'Outlook' : 'Google Calendar';
  if (state === 'connected') return <div className="state empty-state"><CalendarIcon /><h3>A clear day</h3><p>There are no meetings or events scheduled.</p></div>;
  if (state === 'unconfigured') return <div className="state empty-state"><CalendarIcon /><h3>Connect your calendar</h3><p>{provider === 'outlook' ? 'Your Outlook connection needs to be set up. Ask your IT team to approve Daylight for read-only calendar access.' : 'Google Calendar is not available yet. Your daily notes are still available.'}</p></div>;
  if (state === 'disconnected') return <div className="state empty-state"><CalendarIcon /><h3>Your calendar is not connected</h3><p>Connect {name} to see the day’s meetings here.</p><button className="primary-button" onClick={onReconnect}>Connect {name}</button></div>;
  if (state === 'blocked') return <div className="state empty-state"><CalendarIcon /><h3>Calendar access was not granted</h3><p>Your work account may require IT approval for Daylight to read your calendar.</p><button className="primary-button" onClick={onReconnect}>Connect {name} again</button></div>;
  return <div className="state empty-state"><CalendarIcon /><h3>{state === 'expired' ? 'Your connection has expired' : 'We couldn’t load your calendar'}</h3><p>{state === 'expired' ? `Reconnect ${name} to continue.` : 'Please check your connection and try again.'}</p><button className="primary-button" onClick={state === 'expired' ? onReconnect : onRetry}>{state === 'expired' ? 'Reconnect calendar' : 'Try again'}</button></div>;
}

function NotesView({ day, onBack }: { day: string; onBack(): void }) {
  const subscribe = useCallback((listener: () => void) => notesStore.subscribe(day, listener), [day]);
  const snapshot = useCallback(() => notesStore.get(day), [day]);
  const { content, status } = useSyncExternalStore(subscribe, snapshot);
  const error = status === 'load-error' || status === 'save-error';
  useEffect(() => { void notesStore.load(day); return () => { void notesStore.flush(day); }; }, [day]);
  return <section className="content-view notes-view">
    <div className="view-heading"><button className="back-button" onClick={onBack}><Arrow direction="left" /> Back</button><div><span className="eyebrow">Daily note</span><h2>Notes</h2></div><span role="status" className={`save-state ${error ? 'error' : status}`}>{status === 'loading' ? 'Loading' : status === 'saving' ? 'Saving…' : status === 'load-error' ? 'Couldn’t load' : status === 'save-error' ? 'Not saved' : 'Saved'}</span></div>
    <label className="sr-only" htmlFor="daily-note">Notes for this day</label><textarea id="daily-note" autoFocus value={content} disabled={status === 'loading' || status === 'load-error'} onChange={event => notesStore.change(day, event.target.value)} placeholder="Begin writing…" />
    {error && <div role="alert" className="note-error"><p>{status === 'load-error' ? 'Your note could not be loaded.' : 'Your changes are still here, but have not been saved to the server.'}</p><button className="retry-save" onClick={() => status === 'load-error' ? notesStore.load(day) : notesStore.flush(day)}>{status === 'load-error' ? 'Try loading again' : 'Try saving again'}</button></div>}
  </section>;
}

export default App;
