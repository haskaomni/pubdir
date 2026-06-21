# pubdir

A beautiful local directory sharing server with browser previews and optional Cloudflare Tunnel public URLs.

```bash
npx github:haskaomni/pubdir
```

`pubdir` turns the current directory into a read-only web gallery with previews for common file types. Add `cloudflared` and it also creates a public `trycloudflare.com` URL.

## Features

- One-command local directory browser
- Image, video, audio, PDF, text, code, JSON, CSV, Markdown, and log previews
- Public URL through Cloudflare Tunnel when `cloudflared` is installed
- Search/filter inside the current directory
- Read-only by default
- Safe path resolution to keep requests inside the shared directory
- QR code for the public URL

## Usage

```bash
npx github:haskaomni/pubdir
npm exec --yes --package github:haskaomni/pubdir pubdir -- ~/Downloads
npm exec --yes --package github:haskaomni/pubdir pubdir -- --port 9000
npm exec --yes --package github:haskaomni/pubdir pubdir -- --no-tunnel
```

## Options

```text
-p, --port <port>       Local port. Default: first free port from 4173
-b, --bind <address>    Bind address. Default: 127.0.0.1
--no-tunnel             Only start local preview server
--no-qr                 Do not print QR code
-h, --help              Show help
-v, --version           Show version
```

## Public sharing

Install `cloudflared` first:

```bash
brew install cloudflared
# or see Cloudflare docs for Linux/Windows packages
```

Then run:

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

## Security

Anyone with the public URL can read files in the shared directory. Do not run `pubdir` in a directory containing secrets, `.env` files, SSH keys, private backups, credentials, or proprietary data you do not intend to expose.

`pubdir` is read-only in this first version. Uploads, authentication, and expiring links are planned features.

## Development

```bash
npm install
npm run dev
npm run check
```

## License

MIT
