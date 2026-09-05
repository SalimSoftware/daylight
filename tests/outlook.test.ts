import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createOAuthTransactions } from '../server/oauth.ts';
import { readOutlookEvents } from '../server/outlook.ts';

test('Microsoft callbacks require browser-bound state, expire and cannot be replayed', () => {
  let time = 1000;
  const transactions = createOAuthTransactions(() => time);
  const login = transactions.create();
  assert.equal(transactions.consume(login.state, 'another-browser'), null);
  assert.equal(transactions.consume(null, login.state), null);
  const verifier = transactions.consume(login.state, login.state);
  assert.ok(verifier);
  assert.equal(createHash('sha256').update(verifier).digest('base64url'), login.challenge);
  assert.equal(transactions.consume(login.state, login.state), null);
  const expired = transactions.create();
  time += 600001;
  assert.equal(transactions.consume(expired.state, expired.state), null);
});

test('Outlook loads all pages, normalizes UTC times and skips cancelled events', async () => {
  let calls = 0;
  const request: typeof fetch = async (input, options) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://graph.microsoft.com');
    assert.equal((options?.headers as Record<string, string>).Authorization, 'Bearer test-token');
    assert.equal((options?.headers as Record<string, string>).Prefer, 'outlook.timezone="UTC"');
    calls++;
    if (calls === 1) {
      assert.ok(url.searchParams.get('startDateTime')?.endsWith('Z'));
      assert.ok(url.searchParams.get('endDateTime')?.endsWith('Z'));
      return Response.json({ value: [{ id: 'recurring-instance', subject: 'Team meeting', start: { dateTime: '2026-09-05T10:00:00.0000000' }, end: { dateTime: '2026-09-05T11:00:00.0000000' }, onlineMeeting: { joinUrl: 'https://teams.microsoft.com/meeting' } }, { id: 'cancelled', isCancelled: true }], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/calendarView?$skiptoken=next' });
    }
    return Response.json({ value: [{ id: 'all-day', subject: 'Offsite', isAllDay: true, start: { dateTime: '2026-09-05T00:00:00' }, end: { dateTime: '2026-09-06T00:00:00' }, webLink: 'https://outlook.office.com/calendar/item' }] });
  };
  const result = await readOutlookEvents('2026-09-05', 'test-token', request);
  assert.equal(calls, 2);
  assert.equal(result.status, 'connected');
  assert.equal(result.events.length, 2);
  assert.equal(result.events[0].start, '2026-09-05T10:00:00.000Z');
  assert.equal(result.events[0].linkLabel, 'Join meeting');
  assert.equal(result.events[1].allDay, true);
  assert.equal(result.events[1].linkLabel, 'Open in Outlook');
});

test('Outlook distinguishes expired credentials from denied permissions', async () => {
  for (const [httpStatus, status] of [[401, 'expired'], [403, 'blocked']] as const) {
    const result = await readOutlookEvents('2026-09-05', 'test-token', async () => new Response('', { status: httpStatus }));
    assert.deepEqual(result, { status, events: [] });
  }
  await assert.rejects(readOutlookEvents('2026-09-05', 'test-token', async () => new Response('', { status: 503 })));
});

test('Outlook never forwards a token to an unexpected pagination host', async () => {
  let calls = 0;
  await assert.rejects(readOutlookEvents('2026-09-05', 'test-token', async () => {
    calls++;
    return Response.json({ value: [], '@odata.nextLink': 'https://unrelated.example/collect' });
  }), /Unexpected calendar pagination/);
  assert.equal(calls, 1);
});
