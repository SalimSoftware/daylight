import { test, expect } from '@playwright/test';

test('home renders, dates navigate, and calendar has a visible unconfigured state', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Go to daily home' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Calendar Today' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Notes Write' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('home.png'), fullPage: true });
  const heading = await page.getByRole('heading', { level: 1 }).textContent();
  await page.getByRole('button', { name: 'Next day', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).not.toHaveText(heading!);
  await page.getByRole('button', { name: 'Previous day', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading!);
  await page.getByRole('button', { name: 'Open date selector' }).click();
  const dialog = page.getByRole('dialog', { name: 'Choose a date' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Next month' }).click();
  await dialog.getByRole('button', { name: 'Today', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: 'Calendar Today' }).click();
  await expect(page.getByRole('heading', { name: 'Connect your calendar' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('an immediate date change saves edits to the original day and reloads them', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Notes Write' }).click();
  const editor = page.getByRole('textbox', { name: 'Notes for this day' });
  await expect(editor).toBeEnabled();
  const draft = `A note from ${testInfo.project.name}`;
  await editor.fill(draft);
  await page.getByRole('button', { name: 'Next day', exact: true }).click();
  await expect(editor).toBeEnabled();
  await expect(editor).not.toHaveValue(draft);
  await page.getByRole('button', { name: 'Previous day', exact: true }).click();
  await expect(editor).toHaveValue(draft);
  await expect(page.getByRole('status')).toHaveText('Saved');
  await page.reload();
  await page.getByRole('button', { name: 'Notes Write' }).click();
  await expect(editor).toHaveValue(draft);
  await page.screenshot({ path: testInfo.outputPath('notes.png'), fullPage: true });
});

test('failed writes keep a recoverable draft and retry confirms saving', async ({ page }) => {
  await page.route('**/api/notes/*', async route => {
    if (route.request().method() === 'PUT') await route.fulfill({ status: 503, json: { error: 'Unavailable' } });
    else await route.fulfill({ json: { note: null } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Notes Write' }).click();
  const editor = page.getByRole('textbox', { name: 'Notes for this day' });
  await expect(editor).toBeEnabled();
  await editor.fill('Recover this draft');
  await expect(page.getByRole('status')).toHaveText('Not saved');
  page.on('dialog', dialog => dialog.accept());
  await page.reload();
  await page.getByRole('button', { name: 'Notes Write' }).click();
  await expect(editor).toHaveValue('Recover this draft');
  await expect(page.getByRole('button', { name: 'Try saving again' })).toBeVisible();
  await page.unroute('**/api/notes/*');
  await page.getByRole('button', { name: 'Try saving again' }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
});

test('failed reads cannot be mistaken for an empty editable note', async ({ page }) => {
  await page.route('**/api/notes/*', route => route.fulfill({ status: 500, json: { error: 'Unavailable' } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Notes Write' }).click();
  await expect(page.getByRole('status')).toHaveText('Couldn’t load');
  await expect(page.getByRole('textbox')).toBeDisabled();
  await page.unroute('**/api/notes/*');
  await page.getByRole('button', { name: 'Try loading again' }).click();
  await expect(page.getByRole('textbox')).toBeEnabled();
});

test('calendar displays events, empty days, disconnected and failure states', async ({ page }) => {
  let body: unknown = { status: 'connected', events: [{ id: 'meeting', title: 'Planning session', start: '2026-09-05T10:00:00Z', end: '2026-09-05T11:00:00Z', location: 'Office', description: '', link: '', allDay: false }] };
  let status = 200;
  await page.route('**/api/calendar/events?*', route => route.fulfill({ status, json: body }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Calendar Today' }).click();
  await expect(page.getByRole('heading', { name: 'Planning session' })).toBeVisible();
  body = { status: 'connected', events: [] };
  await page.getByRole('button', { name: 'Refresh calendar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'A clear day' })).toBeVisible();
  body = { status: 'disconnected', events: [] };
  await page.getByRole('button', { name: 'Refresh calendar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Connect Outlook', exact: true })).toBeVisible();
  status = 503;
  await page.getByRole('button', { name: 'Refresh calendar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'We couldn’t load your calendar' })).toBeVisible();
});

test('a delayed calendar response cannot replace the newly selected day', async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let originalDate: string | null = null;
  await page.route('**/api/calendar/events?*', async route => {
    const date = new URL(route.request().url()).searchParams.get('date');
    originalDate ??= date;
    if (date === originalDate) {
      await held;
      await route.fulfill({ json: { status: 'disconnected', events: [] } }).catch(() => {});
    } else await route.fulfill({ json: { status: 'connected', events: [] } });
  });
  await page.goto('/');
  const requested = page.waitForRequest('**/api/calendar/events?*');
  await page.getByRole('button', { name: 'Calendar Today' }).click();
  await requested;
  await page.getByRole('button', { name: 'Next day', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'A clear day' })).toBeVisible();
  release();
  await expect(page.getByRole('heading', { name: 'A clear day' })).toBeVisible();
});

test('failed JavaScript loading shows a useful screen instead of a blank page', async ({ page }) => {
  await page.route(/\/(assets\/.*\.js|src\/main\.tsx)(\?.*)?$/, route => route.abort());
  await page.goto('/');
  await expect(page.getByText("Daylight couldn't load. Check your connection and reload.")).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reload', exact: true })).toBeVisible();
});

test('Outlook is the default account and switching to Google reloads the provider', async ({ page }, testInfo) => {
  await page.route('**/api/calendar/events?*', route => route.fulfill({ json: { status: 'disconnected', events: [] } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Calendar Today' }).click();
  await expect(page.getByLabel('Account', { exact: true })).toHaveValue('outlook');
  await expect(page.getByRole('button', { name: 'Connect Outlook', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('outlook.png'), fullPage: true });
  const googleRequest = page.waitForRequest(request => request.url().includes('/api/calendar/events?') && new URL(request.url()).searchParams.get('provider') === 'google');
  await page.getByLabel('Account', { exact: true }).selectOption('google');
  await googleRequest;
  await expect(page.getByRole('button', { name: 'Connect Google Calendar', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next day', exact: true }).click();
  await expect(page.getByLabel('Account', { exact: true })).toHaveValue('google');
});

test('Microsoft denial returns to Calendar with a dismissible message', async ({ page }) => {
  await page.goto('/?calendar=denied&provider=outlook');
  await expect(page.getByRole('heading', { name: 'Calendar', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Microsoft sign-in did not finish');
  await page.getByRole('button', { name: 'Dismiss sign-in message' }).click();
  await expect(page.getByRole('alert')).not.toBeVisible();
  expect(new URL(page.url()).searchParams.has('calendar')).toBe(false);
});

test('Outlook permission failures are visible and connected accounts can disconnect', async ({ page }) => {
  let status = 'blocked';
  await page.route('**/api/calendar/events?*', route => route.fulfill({ json: { status, events: [] } }));
  await page.route('**/api/calendar/microsoft/disconnect', route => {
    expect(route.request().method()).toBe('POST');
    status = 'disconnected';
    return route.fulfill({ json: { status } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Calendar Today' }).click();
  await expect(page.getByRole('heading', { name: 'Calendar access was not granted' })).toBeVisible();
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Connect Outlook', exact: true })).toBeVisible();
});
