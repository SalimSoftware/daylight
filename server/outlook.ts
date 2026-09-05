import type { AccountInfo } from '@azure/msal-node';
import { createOAuthTransactions } from './oauth.js';

const clientId = process.env.MICROSOFT_CLIENT_ID;
const tenant = process.env.MICROSOFT_TENANT_ID || 'organizations';
const redirectUri = process.env.MICROSOFT_REDIRECT_URI || `http://localhost:${process.env.PORT || 8787}/api/calendar/microsoft/callback`;
const scopes = ['https://graph.microsoft.com/Calendars.ReadBasic'];
const msal = clientId ? await import('@azure/msal-node') : null;
const client = clientId && msal ? new msal.PublicClientApplication({ auth: { clientId, authority: `https://login.microsoftonline.com/${encodeURIComponent(tenant)}` } }) : null;
const transactions = createOAuthTransactions();
let account: AccountInfo | null = null;

export type OutlookStatus = 'unconfigured' | 'disconnected' | 'connected' | 'expired' | 'blocked' | 'error';
export function outlookStatus(): OutlookStatus { return !client ? 'unconfigured' : account ? 'connected' : 'disconnected'; }
export async function beginOutlookLogin() {
  if (!client) return null;
  const { state, challenge } = transactions.create();
  const url = await client.getAuthCodeUrl({ scopes, redirectUri, state, prompt: 'select_account', codeChallenge: challenge, codeChallengeMethod: 'S256' });
  return { url, state, secure: new URL(redirectUri).protocol === 'https:' };
}
export async function completeOutlookLogin(code: string | null, state: string | null, browserState: string | undefined, denied: boolean) {
  const codeVerifier = transactions.consume(state, browserState);
  if (!client || !codeVerifier) return 'invalid-state';
  if (denied) return 'denied';
  if (!code) return 'failed';
  try {
    const result = await client.acquireTokenByCode({ code, scopes, redirectUri, codeVerifier });
    if (!result?.account) return 'failed';
    if (account && account.homeAccountId !== result.account.homeAccountId) await client.getTokenCache().removeAccount(account);
    account = result.account;
    return 'connected';
  } catch { return 'failed'; }
}
export async function disconnectOutlook() {
  if (client && account) await client.getTokenCache().removeAccount(account);
  account = null;
}

type GraphEvent = {
  id: string; subject?: string; start?: { dateTime: string }; end?: { dateTime: string };
  isAllDay?: boolean; isCancelled?: boolean; location?: { displayName?: string };
  onlineMeeting?: { joinUrl?: string }; webLink?: string;
};
function utc(value: string | undefined) {
  if (!value) throw new Error('Missing event time.');
  const timestamp = /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? value : `${value}Z`;
  if (Number.isNaN(Date.parse(timestamp))) throw new Error('Invalid event time.');
  return new Date(timestamp).toISOString();
}
function safeLink(value: string | undefined) {
  if (!value) return '';
  try { return new URL(value).protocol === 'https:' ? value : ''; } catch { return ''; }
}
export async function readOutlookEvents(day: string, token: string, request: typeof fetch = fetch) {
  const start = new Date(`${day}T00:00:00`);
  const end = new Date(start); end.setDate(end.getDate() + 1);
  const params = new URLSearchParams({ startDateTime: start.toISOString(), endDateTime: end.toISOString(), '$orderby': 'start/dateTime', '$top': '100', '$select': 'id,subject,start,end,isAllDay,isCancelled,location,onlineMeeting,webLink' });
  let next: string | undefined = `https://graph.microsoft.com/v1.0/me/calendarView?${params}`;
  const events = [];
  let pages = 0;
  while (next) {
    const url = new URL(next);
    if (url.origin !== 'https://graph.microsoft.com' || !url.pathname.startsWith('/v1.0/') || ++pages > 100) throw new Error('Unexpected calendar pagination.');
    const response = await request(url.href, { headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.timezone="UTC"' }, signal: AbortSignal.timeout(15000) });
    if (response.status === 401) return { status: 'expired' as const, events: [] };
    if (response.status === 403) return { status: 'blocked' as const, events: [] };
    if (!response.ok) throw new Error('Outlook calendar request failed.');
    const data = await response.json() as { value: GraphEvent[]; '@odata.nextLink'?: string };
    if (!Array.isArray(data.value)) throw new Error('Invalid calendar response.');
    for (const event of data.value) {
      if (event.isCancelled) continue;
      const meetingLink = safeLink(event.onlineMeeting?.joinUrl);
      events.push({ id: event.id, title: event.subject || 'Untitled event', start: utc(event.start?.dateTime), end: utc(event.end?.dateTime), allDay: Boolean(event.isAllDay), location: event.location?.displayName || '', description: '', link: meetingLink || safeLink(event.webLink), linkLabel: meetingLink ? 'Join meeting' : 'Open in Outlook' });
    }
    next = data['@odata.nextLink'];
  }
  return { status: 'connected' as const, events };
}
export async function outlookEventsForDay(day: string) {
  if (!client || !account) return { status: outlookStatus(), events: [] };
  try {
    const token = await client.acquireTokenSilent({ account, scopes });
    return await readOutlookEvents(day, token.accessToken);
  } catch (error) {
    return { status: msal && error instanceof msal.InteractionRequiredAuthError ? 'expired' as const : 'error' as const, events: [] };
  }
}
