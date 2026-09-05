import { getSetting, setSetting } from './db.js';

const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:8787/api/calendar/callback';
const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
const scopes = 'https://www.googleapis.com/auth/calendar.readonly';

export type CalendarStatus = 'connected' | 'disconnected' | 'expired' | 'unconfigured';
type Tokens = { access_token?: string; refresh_token?: string; expiry_date?: number };
type GoogleEvent = { id?: string; summary?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string }; location?: string; description?: string; hangoutLink?: string; htmlLink?: string };

function tokens(): Tokens | null {
  const value = getSetting('google_tokens');
  return value ? JSON.parse(value) as Tokens : null;
}
function saveTokens(value: Tokens) { setSetting('google_tokens', JSON.stringify(value)); }

export function getCalendarStatus(): CalendarStatus {
  if (!clientId || !clientSecret) return 'unconfigured';
  return getSetting('google_tokens') ? 'connected' : 'disconnected';
}

export async function getAuthorizationUrl() {
  if (!clientId || !clientSecret) return null;
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', access_type: 'offline', prompt: 'consent', scope: scopes });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

async function requestToken(params: URLSearchParams) {
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params });
  if (!response.ok) throw new Error('Google token request failed.');
  return response.json() as Promise<{ access_token?: string; refresh_token?: string; expires_in?: number }>;
}

export async function saveAuthorizationCode(code: string) {
  if (!clientId || !clientSecret) throw new Error('Google Calendar has not been configured.');
  const received = await requestToken(new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }));
  saveTokens({ access_token: received.access_token, refresh_token: received.refresh_token, expiry_date: Date.now() + (received.expires_in ?? 3600) * 1000 });
}

async function accessToken() {
  const saved = tokens();
  if (!saved?.access_token) return null;
  if (!saved.expiry_date || saved.expiry_date > Date.now() + 60_000) return saved.access_token;
  if (!saved.refresh_token || !clientId || !clientSecret) return null;
  const refreshed = await requestToken(new URLSearchParams({ refresh_token: saved.refresh_token, client_id: clientId, client_secret: clientSecret, grant_type: 'refresh_token' }));
  saveTokens({ ...saved, access_token: refreshed.access_token, expiry_date: Date.now() + (refreshed.expires_in ?? 3600) * 1000 });
  return refreshed.access_token ?? null;
}

export async function eventsForDay(day: string) {
  if (getCalendarStatus() !== 'connected') return { status: getCalendarStatus(), events: [] };
  const token = await accessToken();
  if (!token) return { status: 'expired' as const, events: [] };
  const start = new Date(`${day}T00:00:00`);
  const end = new Date(start); end.setDate(end.getDate() + 1);
  const params = new URLSearchParams({ timeMin: start.toISOString(), timeMax: end.toISOString(), singleEvents: 'true', orderBy: 'startTime' });
  try {
    const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, { headers: { Authorization: `Bearer ${token}` } });
    if (response.status === 401) return { status: 'expired' as const, events: [] };
    if (!response.ok) return { status: 'error' as const, events: [] };
    const data = await response.json() as { items?: GoogleEvent[] };
    return { status: 'connected' as const, events: (data.items ?? []).map((event) => ({
      id: event.id ?? crypto.randomUUID(), title: event.summary || 'Untitled event', start: event.start?.dateTime || event.start?.date || '', end: event.end?.dateTime || event.end?.date || '',
      location: event.location || '', description: event.description || '', link: event.hangoutLink || event.htmlLink || '', allDay: Boolean(event.start?.date && !event.start?.dateTime),
    })) };
  } catch { return { status: 'error' as const, events: [] }; }
}
