import 'dotenv/config';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eventsForDay, getAuthorizationUrl, getCalendarStatus, saveAuthorizationCode } from './calendar.js';
import { getNote, saveNote } from './db.js';
import { beginOutlookLogin, completeOutlookLogin, disconnectOutlook, outlookEventsForDay, outlookStatus } from './outlook.js';

const port = Number(process.env.PORT || 8787);
const appUrl = process.env.APP_URL || 'http://localhost:5173';
const validDay = (day: string | undefined): day is string => Boolean(day && /^\d{4}-\d{2}-\d{2}$/.test(day));
const contentTypes: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}
async function readJson(request: IncomingMessage) {
  let body = '';
  for await (const chunk of request) body += chunk;
  return JSON.parse(body || '{}') as { content?: unknown };
}

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, '../dist');
function serveApp(pathname: string, response: ServerResponse) {
  if (process.env.DAYLIGHT_DEV === '1') {
    response.writeHead(302, { Location: new URL(pathname, appUrl).href });
    return response.end();
  }
  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = normalize(join(web, relativePath));
  if (!file.startsWith(`${web}/`)) return json(response, 404, { error: 'Not found.' });
  const found = existsSync(file) && statSync(file).isFile();
  if (!found && (extname(pathname) || pathname.startsWith('/assets/'))) return json(response, 404, { error: 'Asset not found.' });
  const requested = found ? file : join(web, 'index.html');
  if (!existsSync(requested)) return json(response, 404, { error: 'Build the web application before starting production mode.' });
  response.writeHead(200, {
    'Content-Type': contentTypes[extname(requested)] || 'application/octet-stream',
    'Cache-Control': extname(requested) === '.html' ? 'no-cache' : 'public, max-age=3600',
  });
  createReadStream(requested).on('error', () => response.destroy()).pipe(response);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
  const parts = url.pathname.split('/');
  try {
    if (request.method === 'GET' && parts[1] === 'api' && parts[2] === 'notes' && validDay(parts[3])) return json(response, 200, { note: getNote(parts[3]) });
    if (request.method === 'PUT' && parts[1] === 'api' && parts[2] === 'notes' && validDay(parts[3])) {
      const body = await readJson(request);
      return typeof body.content === 'string' ? json(response, 200, { note: saveNote(parts[3], body.content) }) : json(response, 400, { error: 'Text content is required.' });
    }
    const outlook = url.searchParams.get('provider') === 'outlook';
    if (request.method === 'GET' && url.pathname === '/api/calendar/status') return json(response, 200, { status: outlook ? outlookStatus() : getCalendarStatus() });
    if (request.method === 'GET' && url.pathname === '/api/calendar/events') return validDay(url.searchParams.get('date') || undefined) ? json(response, 200, await (outlook ? outlookEventsForDay : eventsForDay)(url.searchParams.get('date')!)) : json(response, 400, { error: 'A valid date is required.' });
    if (request.method === 'GET' && url.pathname === '/api/calendar/connect') {
      if (outlook) {
        const login = await beginOutlookLogin();
        if (!login) return json(response, 503, { error: 'Outlook needs a Microsoft app registration before you can connect.' });
        response.writeHead(302, { Location: login.url, 'Cache-Control': 'no-store', 'Set-Cookie': `daylight_oauth=${login.state}; HttpOnly; SameSite=Lax; Path=/api/calendar/microsoft; Max-Age=600${login.secure ? '; Secure' : ''}` });
        return response.end();
      }
      const authorizationUrl = await getAuthorizationUrl();
      if (!authorizationUrl) return json(response, 503, { error: 'Google Calendar credentials are not configured.' });
      response.writeHead(302, { Location: authorizationUrl }); return response.end();
    }
    if (request.method === 'GET' && url.pathname === '/api/calendar/microsoft/callback') {
      const browserState = request.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith('daylight_oauth='))?.slice('daylight_oauth='.length);
      const result = await completeOutlookLogin(url.searchParams.get('code'), url.searchParams.get('state'), browserState, url.searchParams.has('error'));
      const returnUrl = new URL(appUrl);
      returnUrl.searchParams.set('calendar', result);
      returnUrl.searchParams.set('provider', 'outlook');
      response.writeHead(302, { Location: returnUrl.href, 'Cache-Control': 'no-store', 'Set-Cookie': 'daylight_oauth=; HttpOnly; SameSite=Lax; Path=/api/calendar/microsoft; Max-Age=0', 'Referrer-Policy': 'no-referrer' });
      return response.end();
    }
    if (request.method === 'POST' && url.pathname === '/api/calendar/microsoft/disconnect') {
      if (!request.headers.origin || ![new URL(appUrl).origin, url.origin].includes(request.headers.origin)) return json(response, 403, { error: 'Invalid request origin.' });
      await disconnectOutlook();
      return json(response, 200, { status: outlookStatus() });
    }
    if (request.method === 'GET' && url.pathname === '/api/calendar/callback') {
      const code = url.searchParams.get('code');
      if (!code) return json(response, 400, { error: 'Calendar connection was cancelled.' });
      await saveAuthorizationCode(code);
      const returnUrl = new URL(appUrl);
      returnUrl.searchParams.set('calendar', 'connected');
      returnUrl.searchParams.set('provider', 'google');
      response.writeHead(302, { Location: returnUrl.href }); return response.end();
    }
    if (url.pathname.startsWith('/api/')) return json(response, 404, { error: 'Not found.' });
    serveApp(url.pathname, response);
  } catch (error) {
    console.error(error); json(response, 500, { error: 'Something went wrong. Please try again.' });
  }
});
server.listen(port, '127.0.0.1', () => {
  const address = server.address();
  const boundPort = typeof address === 'object' && address ? address.port : port;
  console.log(`Open Daylight: ${process.env.DAYLIGHT_DEV === '1' ? appUrl : `http://localhost:${boundPort}`}`);
  if (process.env.DAYLIGHT_DEV !== '1' && !existsSync(join(web, 'index.html'))) console.error('Missing web build. Run npm run build, then npm start.');
});
