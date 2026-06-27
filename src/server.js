import { constants, createReadStream } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import { access, lstat, readdir, realpath } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import mime from 'mime-types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '..', 'public');
const textPreviewLimit = 512 * 1024;

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function authMatches(header, auth) {
  if (!auth || !header?.startsWith('Basic ')) return false;
  const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  if (separator < 0) return false;
  const username = decoded.slice(0, separator);
  const password = decoded.slice(separator + 1);
  return safeEqual(username, auth.username) && safeEqual(password, auth.password);
}

function insideRoot(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function joinSafe(root, requestPath = '') {
  const decoded = decodeURIComponent(String(requestPath)).replace(/^\/+/, '');
  return path.resolve(root, decoded);
}

async function pathInfo(root, requestPath) {
  const target = joinSafe(root, requestPath);
  const resolved = await realpath(target).catch(() => target);
  if (!insideRoot(root, resolved)) {
    const error = new Error('path escapes shared directory');
    error.statusCode = 403;
    throw error;
  }
  const itemStat = await lstat(resolved);
  return { target: resolved, stat: itemStat };
}

function publicPath(root, absolutePath) {
  const relative = path.relative(root, absolutePath);
  return relative ? relative.split(path.sep).join('/') : '';
}

function classify(filePath, itemStat) {
  if (itemStat.isDirectory()) return 'folder';
  const type = mime.lookup(filePath) || 'application/octet-stream';
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  if (type === 'application/pdf') return 'pdf';
  if (type.startsWith('text/') || /json|javascript|xml|yaml|csv|markdown/.test(type)) return 'text';
  return 'download';
}

function displaySize(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function encodePathLink(relativePath, isDirectory = false) {
  const encoded = relativePath
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `/${encoded}${isDirectory && encoded ? '/' : ''}`;
}

async function firstExistingIndex(root, directory) {
  for (const name of ['index.html', 'index.htm']) {
    const candidate = path.join(directory, name);
    try {
      await access(candidate, constants.R_OK);
      const target = await realpath(candidate);
      if (!insideRoot(root, target)) continue;
      const itemStat = await lstat(target);
      if (itemStat.isFile()) return target;
    } catch {
      // Try the next common index filename.
    }
  }
  return null;
}

async function renderDirectoryListing(root, target, requestPath) {
  const entries = await readdir(target, { withFileTypes: true });
  entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));

  const current = publicPath(root, target);
  const rows = [];
  if (current) {
    const parent = publicPath(root, path.dirname(target));
    rows.push(`<li><a href="${encodePathLink(parent, true)}">../</a></li>`);
  }

  for (const entry of entries) {
    const absolute = path.join(target, entry.name);
    const item = await lstat(absolute);
    const rel = publicPath(root, absolute);
    const slash = item.isDirectory() ? '/' : '';
    const size = item.isDirectory() ? '-' : displaySize(item.size);
    rows.push(`<li><a href="${encodePathLink(rel, item.isDirectory())}">${escapeHtml(entry.name)}${slash}</a> <span>${escapeHtml(size)}</span></li>`);
  }

  const title = `Directory listing for /${current}`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body { color: #1f2933; font: 16px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; margin: 2rem; }
    h1 { font-size: 1.25rem; }
    ul { list-style: none; padding: 0; }
    li { align-items: baseline; display: flex; gap: 1rem; padding: .2rem 0; }
    a { color: #0b63ce; text-decoration: none; }
    a:hover { text-decoration: underline; }
    span { color: #6b7280; font-size: .9rem; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <ul>${rows.join('\n')}</ul>
</body>
</html>`;
}

async function findFreePort(start = 4173, host = '127.0.0.1') {
  for (let port = start; port < start + 1000; port += 1) {
    const free = await new Promise((resolve) => {
      const server = createServer();
      server.once('error', () => resolve(false));
      server.once('listening', () => server.close(() => resolve(true)));
      server.listen(port, host);
    });
    if (free) return port;
  }
  throw new Error('no free local port found');
}

export async function startServer({ root, host = '127.0.0.1', port, auth = null, raw = false }) {
  const app = fastify({ logger: false });

  if (auth) {
    app.addHook('onRequest', async (request, reply) => {
      if (authMatches(request.headers.authorization, auth)) return;
      reply.header('WWW-Authenticate', 'Basic realm="pubdir", charset="UTF-8"');
      reply.code(401).send({ error: 'authentication required' });
    });
  }

  if (raw) {
    app.get('/*', async (request, reply) => {
      const requestPath = request.params['*'] || '';
      const { target, stat: itemStat } = await pathInfo(root, requestPath);

      if (itemStat.isDirectory()) {
        const pathname = new URL(request.raw.url, 'http://localhost').pathname;
        if (!pathname.endsWith('/')) {
          reply.redirect(`${pathname}/${request.url.includes('?') ? `?${request.url.split('?').slice(1).join('?')}` : ''}`);
          return;
        }

        const indexFile = await firstExistingIndex(root, target);
        if (indexFile) {
          const indexStat = await lstat(indexFile);
          reply.type(mime.lookup(indexFile) || 'text/html');
          reply.header('Content-Length', String(indexStat.size));
          return createReadStream(indexFile);
        }

        reply.type('text/html; charset=utf-8');
        return renderDirectoryListing(root, target, requestPath);
      }

      reply.type(mime.lookup(target) || 'application/octet-stream');
      reply.header('Content-Length', String(itemStat.size));
      return createReadStream(target);
    });
  } else {
    app.register(fastifyStatic, {
      root: publicDir,
      prefix: '/',
      decorateReply: false,
    });
  }

  if (!raw) app.get('/api/list', async (request) => {
    const currentPath = request.query.path || '';
    const { target, stat: itemStat } = await pathInfo(root, currentPath);
    if (!itemStat.isDirectory()) {
      const error = new Error('not a directory');
      error.statusCode = 400;
      throw error;
    }

    const entries = await readdir(target, { withFileTypes: true });
    const items = await Promise.all(entries.map(async (entry) => {
      const absolute = path.join(target, entry.name);
      const item = await lstat(absolute);
      const rel = publicPath(root, absolute);
      return {
        name: entry.name,
        path: rel,
        type: classify(absolute, item),
        isDirectory: item.isDirectory(),
        size: item.isDirectory() ? null : item.size,
        sizeLabel: item.isDirectory() ? '' : displaySize(item.size),
        modified: item.mtime.toISOString(),
        mime: item.isDirectory() ? 'inode/directory' : (mime.lookup(absolute) || 'application/octet-stream'),
      };
    }));

    items.sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name));

    return {
      rootName: path.basename(root) || root,
      path: publicPath(root, target),
      parent: publicPath(root, path.dirname(target)),
      isRoot: target === root,
      items,
    };
  });

  if (!raw) app.get('/api/preview', async (request, reply) => {
    const currentPath = request.query.path || '';
    const { target, stat: itemStat } = await pathInfo(root, currentPath);
    if (itemStat.isDirectory()) {
      const error = new Error('cannot preview a directory');
      error.statusCode = 400;
      throw error;
    }

    const type = mime.lookup(target) || 'application/octet-stream';
    if (itemStat.size > textPreviewLimit || !(type.startsWith('text/') || /json|javascript|xml|yaml|csv|markdown/.test(type))) {
      const error = new Error('text preview unavailable for this file');
      error.statusCode = 415;
      throw error;
    }

    reply.type('text/plain; charset=utf-8');
    return createReadStream(target);
  });

  if (!raw) app.get('/raw/*', async (request, reply) => {
    const requestPath = request.params['*'] || '';
    const { target, stat: itemStat } = await pathInfo(root, requestPath);
    if (itemStat.isDirectory()) {
      const error = new Error('cannot stream a directory');
      error.statusCode = 400;
      throw error;
    }
    reply.type(mime.lookup(target) || 'application/octet-stream');
    reply.header('Content-Length', String(itemStat.size));
    return createReadStream(target);
  });

  if (!raw) app.get('/download/*', async (request, reply) => {
    const requestPath = request.params['*'] || '';
    const { target, stat: itemStat } = await pathInfo(root, requestPath);
    if (itemStat.isDirectory()) {
      const error = new Error('cannot download a directory');
      error.statusCode = 400;
      throw error;
    }
    reply.type(mime.lookup(target) || 'application/octet-stream');
    reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(target))}`);
    reply.header('Content-Length', String(itemStat.size));
    return createReadStream(target);
  });

  if (!raw) app.setNotFoundHandler((request, reply) => {
    if (request.raw.url.startsWith('/api/') || request.raw.url.startsWith('/raw/') || request.raw.url.startsWith('/download/')) {
      reply.code(404).send({ error: 'not found' });
      return;
    }
    reply.sendFile('index.html');
  });

  const actualPort = port || await findFreePort(4173, host);
  await app.listen({ host, port: actualPort });

  return {
    port: actualPort,
    close: () => app.close(),
  };
}
