# Daylight

Daily notes with Outlook and Google Calendar views. Tested with Node.js 24.

## Run Locally

```sh
npm install
npm run dev
```

Open the URL printed by Vite, normally http://localhost:5173. The API normally runs on port 8787 and redirects browser visits to the frontend in development. Run this app through its server rather than opening `index.html` directly.

If the project is in an iCloud-synced Desktop folder, stop the app and run `npm run setup:local`. It installs the locked dependencies in `~/Library/Caches/Daylight` and links `node_modules` to that local directory. This prevents offloaded (`dataless`) or duplicated dependency files from stalling startup. Source code and notes remain in the project. Run it again after changing dependencies or if macOS clears the cache.

`PORT` selects the API port; `APP_URL` selects the development frontend URL and the return URL after Google Calendar authorization. Set both in `.env` if the defaults are occupied. Vite reports occupied ports instead of silently changing the frontend URL.

For production, `npm start` builds the app and serves it at http://localhost:8787 (or `PORT`). Set `APP_URL` to that URL for the calendar authorization return.

## Data and Calendar

Notes are stored in `data/daylight.db` in both development and production. Back up that file to preserve your notes. `DAYLIGHT_DATA_DIR` overrides the database directory for isolated testing.

Unsaved edits are retained in the browser's local storage when available. A note shows `Saved` only after the server confirms the write. Failed drafts can be retried; do not clear browser storage while a draft remains unsaved.

Home and Notes work without Google credentials. For Calendar, configure the variables shown in `.env.example`, enable the Google Calendar API in your Google Cloud project, and register the exact `GOOGLE_REDIRECT_URI` in its OAuth client. Calendar then offers a connection button.

## Connect a Work Outlook Account

Outlook uses Microsoft sign-in through MSAL and reads your default calendar through Microsoft Graph. It requests delegated `Calendars.ReadBasic` permission for event titles, times, locations, and meeting links. It does not read mail or event bodies, or change calendar events.

An organization-approved Microsoft Entra app registration is required. For a Philip Morris work account, ask your IT team to approve the integration if you cannot register or consent to an application yourself. Do not enter your work password into Daylight or share it in chat.

Give IT these details:

- App name: Daylight, a local, single-user calendar and notes app.
- Microsoft Entra platform: **Mobile and desktop applications**, public client using authorization code flow with PKCE; no client secret.
- Redirect URI: `http://localhost:8787/api/calendar/microsoft/callback`.
- Delegated Microsoft Graph permission: `Calendars.ReadBasic`, plus standard Microsoft sign-in scopes requested by MSAL.
- Needed configuration: Application (client) ID and Directory (tenant) ID. A tenant-specific registration is preferred for a company account.

Set `MICROSOFT_CLIENT_ID`, `MICROSOFT_TENANT_ID`, and `MICROSOFT_REDIRECT_URI` in `.env` using the values provided by IT, then restart `npm run dev`. Open **Calendar**, select **Outlook (work or school)**, and choose **Connect Outlook**. Complete sign-in and any MFA on Microsoft's page. If Microsoft requests administrator approval, IT must grant it before connection can finish.

Microsoft sign-in tokens stay in server memory and are refreshed by MSAL while the app runs. Restarting the server requires connecting again. **Disconnect** removes the account from Daylight's in-memory token cache; it does not sign you out of Outlook elsewhere or revoke consent in Microsoft. This app binds its API to loopback and is intended for local use, not a shared corporate deployment.

References: [Microsoft calendar permissions](https://learn.microsoft.com/en-us/graph/api/user-list-calendarview?view=graph-rest-1.0), [MSAL authorization code flow](https://learn.microsoft.com/en-us/entra/msal/javascript/node/acquire-token-requests), [organization consent controls](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/configure-user-consent).

## Verification

```sh
npm run check
npm test
npm run test:browser
```

`npm test` builds the app and runs notes/server regression tests using a temporary database. Browser tests require Google Chrome installed, use temporary databases, and cover development and production at desktop and mobile sizes. They use ports 5174, 8788, and 8789. Screenshots and failure traces are written to `test-results`.
