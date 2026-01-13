<p style="text-align: center">
    <img src="https://raw.githubusercontent.com/RyanGarber/v10m/refs/heads/main/src/apps/web/static/logo.png" height="100" />
    <br>
    <img src="https://github.com/RyanGarber/v10m/actions/workflows/ci-cd.yml/badge.svg">
</p>

# About

v10m is a versatile media downloader with built-in compression. It functions as a library, a command-line interface, and a website all-in-one.

# Installation

### Node.js

- Clone the repository
- Run `node build.js`

### Docker

- Coming soon

# Configuration

v10m will look for command line arguments, environment variables, `./v10m.config.json`, and `~/.v10m.config.json`, each of which overriding the last.

```typescript
debug: false,
workers: {
    max: 2,
    loopMs: 1000,
    cleanupMs: 300000,
},
web: {
    url: 'http://127.0.0.1:8080',
    host: '127.0.0.1',
    port: 8080,
    path: '/',
    maxUploadSizeMb: 500,
    targetSizeListMb: [10, 25, 50],
    defaultDownloadFilename: 'video-download',
},
```

# Usage

### CLI

- `v10m download [url] [--output] [--cookies] [-u] [-p]`
- `v10m transcode [file] [--output] [--target-size-kb]`

### Web

- `v10m-web [--host] [--port]`

# Tests

This project is 100% self-written with the exception of tests. Tests are not fun code, so I let Antigravity write them. I have looked over them and they seem to be adequate, but do not expect them to be perfect. I welcome any contributions to improve them.
