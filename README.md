# pubdir

A beautiful local directory sharing server with browser previews and optional Cloudflare Tunnel public URLs.

```bash
npx github:haskaomni/pubdir
```

`pubdir` turns the current directory into a read-only web gallery with previews for common file types. It can also create a public `trycloudflare.com` URL through Cloudflare Tunnel. If `cloudflared` is missing, `pubdir` downloads it automatically into the local user cache.

## Features

- One-command local directory browser
- Image, video, audio, PDF, text, code, JSON, CSV, Markdown, and log previews
- Public URL through Cloudflare Tunnel
- Auto-installs `cloudflared` when needed
- Optional HTTP Basic Auth with `--auth user:pass`
- Search/filter inside the current directory
- Read-only by default
- Safe path resolution to keep requests inside the shared directory
- QR code for the public URL

## Usage

```bash
npx github:haskaomni/pubdir
npm exec --yes --package github:haskaomni/pubdir pubdir -- ~/Downloads
npm exec --yes --package github:haskaomni/pubdir pubdir -- --auth guest:secret
npm exec --yes --package github:haskaomni/pubdir pubdir -- --port 9000
npm exec --yes --package github:haskaomni/pubdir pubdir -- --no-tunnel
```

For a pinned version:

```bash
npx --yes github:haskaomni/pubdir#v0.2.8
```

## Options

```text
-p, --port <port>       Local port. Default: first free port from 4173
-b, --bind <address>    Bind address. Default: 127.0.0.1
--auth <user:pass>      Require HTTP Basic Auth
--no-tunnel             Only start local preview server
--no-qr                 Do not print QR code
--no-install            Do not auto-download cloudflared when missing
-h, --help              Show help
-v, --version           Show version
```

You can also set auth with an environment variable:

```bash
PUBDIR_AUTH=guest:secret npx github:haskaomni/pubdir
```

## Public sharing

Run:

```bash
npx github:haskaomni/pubdir
```

You will see output like:

```text
pubdir is serving
  Directory  /Users/me/project
  Local      http://127.0.0.1:4173
  Public     https://example-example-example.trycloudflare.com
```

If `cloudflared` is not already installed, `pubdir` downloads the latest release from Cloudflare's GitHub releases into:

```text
~/.cache/pubdir/bin/cloudflared
```

Use `--no-install` if you want to require a preinstalled `cloudflared` binary.

## Password protection

```bash
npx github:haskaomni/pubdir --auth guest:secret
```

The generated public URL will require the username `guest` and password `secret` before any directory listing, preview, raw file, or download route is served.

## Security

Anyone with the public URL can attempt to access the shared directory. Use `--auth user:pass` for public links, and do not run `pubdir` in a directory containing secrets, `.env` files, SSH keys, private backups, credentials, or proprietary data you do not intend to expose.

`pubdir` is read-only in this first version. Uploads and expiring links are planned features.

## Development

```bash
npm install
npm run dev
npm run check
```

## License

MIT
