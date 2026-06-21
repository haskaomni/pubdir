import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { access, chmod, mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';

const urlPattern = /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/g;

function cacheDir() {
  const base = process.env.XDG_CACHE_HOME || path.join(process.env.HOME || tmpdir(), '.cache');
  return path.join(base, 'pubdir', 'bin');
}

function platformAsset() {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === 'linux' && arch === 'x64') return { name: 'cloudflared', asset: 'cloudflared-linux-amd64', archive: false };
  if (platform === 'linux' && arch === 'arm64') return { name: 'cloudflared', asset: 'cloudflared-linux-arm64', archive: false };
  if (platform === 'darwin' && arch === 'x64') return { name: 'cloudflared', asset: 'cloudflared-darwin-amd64.tgz', archive: true };
  if (platform === 'darwin' && arch === 'arm64') return { name: 'cloudflared', asset: 'cloudflared-darwin-arm64.tgz', archive: true };
  if (platform === 'win32' && arch === 'x64') return { name: 'cloudflared.exe', asset: 'cloudflared-windows-amd64.exe', archive: false };

  throw new Error(`unsupported platform for cloudflared auto-install: ${platform}/${arch}`);
}

function canRun(command) {
  return new Promise((resolve) => {
    const child = spawn(command, ['--version'], { stdio: 'ignore' });
    child.on('error', () => resolve(false));
    child.on('exit', (code) => resolve(code === 0));
  });
}

function commandPath(command) {
  return new Promise((resolve) => {
    const lookup = process.platform === 'win32' ? 'where' : 'command';
    const args = process.platform === 'win32' ? [command] : ['-v', command];
    const child = spawn(lookup, args, { shell: process.platform !== 'win32' });
    let output = '';
    child.stdout?.on('data', (chunk) => { output += chunk.toString(); });
    child.on('error', () => resolve(null));
    child.on('exit', (code) => resolve(code === 0 ? output.trim().split(/\r?\n/)[0] : null));
  });
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function download(url, destination) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`download failed: ${response.status} ${response.statusText}`);
  await finished(Readable.fromWeb(response.body).pipe(createWriteStream(destination)));
}

async function extractTgz(archive, targetDir) {
  await new Promise((resolve, reject) => {
    const child = spawn('tar', ['-xzf', archive, '-C', targetDir], { stdio: 'ignore' });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`tar exited with code ${code}`))));
  });
}

async function downloadCloudflared(hooks = {}) {
  const asset = platformAsset();
  const dir = cacheDir();
  const target = path.join(dir, asset.name);
  const url = `https://github.com/cloudflare/cloudflared/releases/latest/download/${asset.asset}`;
  const scratch = await mkdtemp(path.join(tmpdir(), 'pubdir-cloudflared-'));

  await mkdir(dir, { recursive: true });
  hooks.onHint?.(`installing cloudflared to ${target}`);

  try {
    if (asset.archive) {
      const archive = path.join(scratch, asset.asset);
      await download(url, archive);
      await extractTgz(archive, scratch);
      await rename(path.join(scratch, 'cloudflared'), target);
    } else {
      await download(url, target);
    }
    if (process.platform !== 'win32') await chmod(target, 0o755);
    return target;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

export async function resolveCloudflared({ autoInstall = true, hooks = {} } = {}) {
  const existing = await commandPath('cloudflared');
  if (existing && await canRun(existing)) return existing;

  const asset = platformAsset();
  const cached = path.join(cacheDir(), asset.name);
  if (await exists(cached)) return cached;

  if (!autoInstall) {
    throw new Error('cloudflared is not installed. Install it or run with --no-tunnel.');
  }

  return downloadCloudflared(hooks);
}

export function startCloudflared(localUrl, { bin = 'cloudflared', ...hooks } = {}) {
  const child = spawn(bin, ['tunnel', '--url', localUrl], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let announced = false;

  const handle = (chunk) => {
    const text = chunk.toString();
    const match = text.match(urlPattern);
    if (match && !announced) {
      announced = true;
      hooks.onUrl?.(match[0]);
    }
  };

  child.stdout.on('data', handle);
  child.stderr.on('data', handle);

  child.on('error', (error) => {
    hooks.onHint?.(error.message);
  });

  child.on('exit', (code) => {
    if (code && !announced) hooks.onHint?.(`cloudflared exited with code ${code}`);
  });

  return {
    stop() {
      child.kill('SIGTERM');
    },
  };
}
