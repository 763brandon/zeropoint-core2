import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const MAX_BODY_BYTES = 64 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon'
};

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function createRouter() {
  const routes = [];

  const add = (method, pattern, handler) => {
    const keys = [];
    const source = pattern
      .replace(/[.+*?^${}()|[\]\\]/g, '\\$&')
      .replace(/:(\w+)/g, (_, key) => {
        keys.push(key);
        return '([^/]+)';
      });
    routes.push({ method, regex: new RegExp(`^${source}$`), keys, handler });
  };

  return {
    get: (p, h) => add('GET', p, h),
    post: (p, h) => add('POST', p, h),
    match(method, pathname) {
      for (const route of routes) {
        if (route.method !== method) continue;
        const found = route.regex.exec(pathname);
        if (!found) continue;
        const params = Object.fromEntries(route.keys.map((key, i) => [key, decodeURIComponent(found[i + 1])]));
        return { handler: route.handler, params };
      }
      return null;
    }
  };
}

/**
 * Reads a request body with a hard cap. An unbounded read is a trivial memory
 * exhaustion vector, and the raw text is retained because webhook signatures
 * must be verified against exact bytes, not against a re-serialised object.
 */
export async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'Request body too large');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return { raw: '', json: {} };
  try {
    return { raw, json: JSON.parse(raw) };
  } catch {
    throw new HttpError(400, 'Body must be valid JSON');
  }
}

export function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store'
  });
  res.end(body);
}

export function sendText(res, status, body, contentType = 'text/plain; charset=utf-8', headers = {}) {
  res.writeHead(status, { 'content-type': contentType, 'content-length': Buffer.byteLength(body), ...headers });
  res.end(body);
}

/**
 * Static file serving, confined to `root`. The normalize-and-prefix check
 * rejects traversal (`../`) before any read is attempted.
 */
export async function sendStatic(res, root, requestPath) {
  const relative = normalize(requestPath).replace(/^(\.\.[/\\])+/, '');
  const target = join(root, relative === '/' || relative === '' ? 'index.html' : relative);
  if (!target.startsWith(normalize(root))) throw new HttpError(403, 'Forbidden');

  try {
    const file = await readFile(target);
    const type = MIME[extname(target)] ?? 'application/octet-stream';
    res.writeHead(200, { 'content-type': type, 'content-length': file.length });
    res.end(file);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EISDIR') throw new HttpError(404, 'Not found');
    throw error;
  }
}
