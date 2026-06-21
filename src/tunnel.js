import { spawn } from 'node:child_process';

const urlPattern = /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/g;

export function startCloudflared(localUrl, hooks = {}) {
  const child = spawn('cloudflared', ['tunnel', '--url', localUrl], {
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
    if (/command not found|ENOENT/i.test(text)) hooks.onHint?.('cloudflared not found');
  };

  child.stdout.on('data', handle);
  child.stderr.on('data', handle);

  child.on('error', (error) => {
    if (error.code === 'ENOENT') {
      hooks.onHint?.('cloudflared is not installed. Install it or run with --no-tunnel.');
      return;
    }
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
