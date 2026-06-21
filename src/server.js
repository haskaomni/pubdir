import { createReadStream } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import { lstat, readdir, realpath } from 'node:fs/promises';
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

export async function startServer({ root, host = '127.0.0.1', port, auth = null }) {
  const app = fastify({ logger: false });

  if (auth) {
    app.addHook('onRequest', async (request, reply) => {
      if (authMatches(request.headers.authorization, auth)) return;
      reply.header('WWW-Authenticate', 'Basic realm="pubdir", charset="UTF-8"');
      reply.code(401).send({ error: 'authentication required' });
    });
  }

  app.register(fastifyStatic, {
    root: publicDir,
    prefix: '/',
    decorateReply: false,
  });

  app.get('/api/list', async (request) => {
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

  app.get('/api/preview', async (request, reply) => {
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

  app.get('/raw/*', async (request, reply) => {
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

  app.get('/download/*', async (request, reply) => {
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

  app.setNotFoundHandler((request, reply) => {
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
