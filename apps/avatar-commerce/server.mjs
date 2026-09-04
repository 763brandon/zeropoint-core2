import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { openDatabase } from './src/db.mjs';
import { createApi, statusFor } from './src/routes/api.mjs';
import { sendJson, sendStatic, HttpError } from './src/lib/http.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(HERE, 'public');

export function createApp({ db, config }) {
  const api = createApi(db, config);

  return async function handle(req, res) {
    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
    try {
      const route = api.match(req.method, url.pathname);
      if (route) return await route.handler(req, res, { params: route.params, url });

      // A shared look is served by the SPA shell so the slug renders without an
      // account and without a redirect that would cost conversion.
      if (req.method === 'GET' && url.pathname.startsWith('/l/')) return await sendStatic(res, PUBLIC_DIR, '/index.html');
      if (req.method === 'GET') return await sendStatic(res, PUBLIC_DIR, url.pathname);

      throw new HttpError(404, 'Not found');
    } catch (error) {
      const status = statusFor(error);
      if (status >= 500) process.stderr.write(`[500] ${req.method} ${url.pathname} — ${error.stack}\n`);

      // Rejecting a request before its body has fully arrived (a 413, say)
      // leaves unread bytes in the socket. A keep-alive client would send its
      // next request into that backlog and hang, so this connection must not be
      // reused. `req.complete` — not `readableEnded` — is the right test: a
      // body-less GET is complete without ever having been read.
      if (!req.complete) res.setHeader('connection', 'close');
      sendJson(res, status, { error: error.message });
    }
  };
}

export function startServer({ port = Number(process.env.PORT ?? 3000), dbPath = process.env.DB_PATH ?? join(HERE, 'data', 'app.db'), config = {} } = {}) {
  const db = openDatabase(dbPath);
  const resolved = {
    // A generated secret is fine for a local run and fatal in production, so it
    // is announced rather than silently accepted.
    webhookSecret: process.env.WEBHOOK_SECRET ?? randomBytes(16).toString('hex'),
    viewerSalt: process.env.VIEWER_SALT ?? 'local-dev-salt',
    renderProvider: process.env.RENDER_PROVIDER ?? 'local',
    ...config
  };

  const server = createServer(createApp({ db, config: resolved }));
  server.listen(port, () => {
    process.stdout.write(`AI-Avatar Commerce listening on http://localhost:${port}\n`);
    process.stdout.write(`  database:        ${dbPath}\n`);
    process.stdout.write(`  render provider: ${resolved.renderProvider}\n`);
    if (!process.env.WEBHOOK_SECRET) {
      process.stdout.write(`  webhook secret:  ${resolved.webhookSecret}  (generated — set WEBHOOK_SECRET in production)\n`);
    }
  });
  return { server, db, config: resolved };
}

if (import.meta.url === `file://${process.argv[1]}`) startServer();
