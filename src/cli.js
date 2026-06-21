#!/usr/bin/env node
import { existsSync, statSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import qrcode from 'qrcode-terminal';
import { startServer } from './server.js';
import { resolveCloudflared, startCloudflared } from './tunnel.js';

const VERSION = '0.2.4';

function usage() {
  console.log(`pubdir ${VERSION}

Expose a local directory with a preview-rich web UI and optional Cloudflare Tunnel.

Usage:
  pubdir [directory] [options]

Options:
  -p, --port <port>       Local port. Default: first free port from 4173
  -b, --bind <address>    Bind address. Default: 127.0.0.1
  --auth <user:pass>      Require HTTP Basic Auth
  --no-tunnel             Only start local preview server
  --no-qr                 Do not print QR code
  --no-install            Do not auto-download cloudflared when missing
  -h, --help              Show help
  -v, --version           Show version

Examples:
  pubdir
  pubdir ~/Downloads
  pubdir --auth guest:secret
  pubdir --no-tunnel --port 9000
`);
}

function parseAuth(value) {
  const separator = value.indexOf(':');
  if (separator <= 0 || separator === value.length - 1) {
    throw new Error('--auth must use the format user:pass');
  }
  return {
    username: value.slice(0, separator),
    password: value.slice(separator + 1),
  };
}

function parseArgs(argv) {
  const options = {
    dir: process.cwd(),
    port: undefined,
    bind: '127.0.0.1',
    tunnel: true,
    qr: true,
    autoInstall: true,
    auth: process.env.PUBDIR_AUTH ? parseAuth(process.env.PUBDIR_AUTH) : null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      usage();
      process.exit(0);
    }
    if (arg === '-v' || arg === '--version') {
      console.log(`pubdir ${VERSION}`);
      process.exit(0);
    }
    if (arg === '--no-tunnel') {
      options.tunnel = false;
      continue;
    }
    if (arg === '--no-qr') {
      options.qr = false;
      continue;
    }
    if (arg === '--no-install') {
      options.autoInstall = false;
      continue;
    }
    if (arg === '--auth') {
      const value = argv[++i];
      if (!value) throw new Error(`${arg} requires a value`);
      options.auth = parseAuth(value);
      continue;
    }
    if (arg.startsWith('--auth=')) {
      options.auth = parseAuth(arg.slice('--auth='.length));
      continue;
    }
    if (arg === '-p' || arg === '--port') {
      const value = argv[++i];
      if (!value) throw new Error(`${arg} requires a value`);
      options.port = Number.parseInt(value, 10);
      continue;
    }
    if (arg.startsWith('--port=')) {
      options.port = Number.parseInt(arg.slice('--port='.length), 10);
      continue;
    }
    if (arg === '-b' || arg === '--bind') {
      const value = argv[++i];
      if (!value) throw new Error(`${arg} requires a value`);
      options.bind = value;
      continue;
    }
    if (arg.startsWith('--bind=')) {
      options.bind = arg.slice('--bind='.length);
      continue;
    }
    if (arg.startsWith('-')) throw new Error(`unknown option: ${arg}`);
    options.dir = arg;
  }

  if (options.port !== undefined && (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535)) {
    throw new Error('port must be an integer between 1 and 65535');
  }

  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const root = path.resolve(options.dir);

  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`not a directory: ${root}`);
  }

  const realRoot = await realpath(root);
  const server = await startServer({ root: realRoot, host: options.bind, port: options.port, auth: options.auth });
  const localUrl = `http://${options.bind}:${server.port}`;

  console.log('');
  console.log('pubdir is serving');
  console.log(`  Directory  ${realRoot}`);
  console.log(`  Local      ${localUrl}`);
  if (options.auth) console.log(`  Auth       ${options.auth.username}:********`);
  console.log('');

  let tunnel;
  if (options.tunnel) {
    const cloudflared = await resolveCloudflared({
      autoInstall: options.autoInstall,
      hooks: {
        onHint(message) {
          console.log(`  Tunnel     ${message}`);
        },
      },
    });

    tunnel = startCloudflared(localUrl, {
      bin: cloudflared,
      onUrl(url) {
        console.log(`  Public     ${url}`);
        if (options.qr) qrcode.generate(url, { small: true });
      },
      onHint(message) {
        console.log(`  Tunnel     ${message}`);
      },
    });
  } else {
    console.log('  Tunnel     disabled');
  }

  console.log('Press Ctrl+C to stop.');

  const shutdown = async () => {
    tunnel?.stop();
    await server.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error(`error: ${error.message}`);
  process.exit(1);
});
