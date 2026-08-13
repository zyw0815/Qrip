**English** | [中文](README.zh-CN.md)

<div align="center">

# Qrip

**A beautiful desktop GUI for downloading hi-res music from Qobuz — built on top of streamrip.**

[![CI](https://github.com/zyw0815/Qrip/actions/workflows/build.yml/badge.svg)](https://github.com/zyw0815/Qrip/actions/workflows/build.yml)
[![release](https://img.shields.io/github/v/release/zyw0815/Qrip)](https://github.com/zyw0815/Qrip/releases)
[![license](https://img.shields.io/badge/license-MIT-blue)](#license)

[Download](#download) · [Features](#features) · [Screenshots](#screenshots) · [Build from source](#build-from-source) · [Architecture](#architecture) · [License](#license)

</div>

---

## Download

Grab the latest build from the [Releases](https://github.com/zyw0815/Qrip/releases) page:

| Platform | File | Size |
| --- | --- | --- |
| Windows | `Qrip Setup 0.1.0.exe` | ~80 MB |
| macOS (Apple Silicon) | `Qrip-0.1.0-arm64.dmg` | ~130 MB |

Requirements:

- Windows 10 or later
- macOS 11.0 or later (Apple Silicon)

> Install and run — no Python install needed. The backend is compiled into a standalone binary that ships inside the app. macOS builds are Apple Silicon (arm64) only; Intel Mac users see [Build from source](#build-from-source).
>
> The installers are currently unsigned: macOS shows an "unidentified developer" warning (right-click → Open, or allow it in System Settings), Windows SmartScreen asks for confirmation.

## Features

- **Sign in with Qobuz**: the app opens a Qobuz login window and captures your auth token automatically — any login method works (Google, Apple, email). Credentials are stored locally and reused until they expire; every login window starts fresh so switching accounts is easy. A paste-a-token fallback is available.
- **Search & browse**: keyword search across albums, tracks and playlists, with covers, quality tags (FLAC bit depth / sample rate), year, label and duration shown up front. Results load more pages on demand.
- **Paste a link**: drop a Qobuz track / album / playlist URL and download it directly.
- **High-res downloads**: up to 24-bit / 192 kHz FLAC, quality configurable in settings.
- **Album track list**: expand an album to see every track and download individual ones.
- **Live progress**: per-item progress bars, speed and queue management on the Downloads tab — pause / resume / delete, with partial files cleaned up when you cancel.
- **No database, no dedup**: everything is always downloadable; existing files are simply overwritten.
- **Sensible defaults**: `{artist} — {album} ({year})` folder layout, `{artist} — {title}` file names, cover embedded in the audio files.
- **Naming templates**: pick from presets or assemble your own from tokens, with a live preview.
- **Cover art options**: embed in audio files, optionally save `cover.jpg` separately.
- **Extensible design**: Qobuz-only today, but the architecture keeps the door open for more sources.

## Screenshots

![Qrip](img/screenshot.png)

## Build from source

> Most users should just grab a packaged build from [Download](#download). This section is for running / packaging from source.

Requires Python 3.10+ and Node.js 20+.

Backend dependencies:

```bash
pip install -r python/requirements-build.txt
```

Frontend dependencies:

```bash
npm install
```

Run in development (Electron + Vite + FastAPI):

```bash
npm run electron:dev
```

Build the backend binary (PyInstaller, standalone, no Python needed at runtime):

```bash
npm run build:backend
```

Package the app (electron-builder — run on macOS for a `.dmg`, on Windows for an `.exe`):

```bash
npm run electron:build
```

The output is placed in the `release/` directory.

PyInstaller cannot cross-compile, so a macOS `.dmg` must be built on macOS and a Windows `.exe` on Windows. To build automatically, push a `v*` tag (e.g. `v0.1.0`) or trigger the workflow manually from the Actions tab: GitHub Actions builds both packages and attaches them to the release.

Intel Macs: the arm64 build runs only on Apple Silicon. GitHub's free Intel macOS runners are scarce and being retired, so CI does not produce an Intel (x86_64) build. If you need one, build it on an Intel Mac with `npm run electron:build` (that build also runs on Apple Silicon via Rosetta).

## Architecture

Qrip is three layers working together:

```
┌─────────────────────────────────────────┐
│  Electron (desktop shell)               │
│  · window & lifecycle management        │
│  · spawns the backend as a child proc   │
│  · OAuth window + token capture         │
│  · OS integration (file dialogs, links) │
├─────────────────────────────────────────┤
│  React + TypeScript (UI, inside Electron)│
│  · Login / Search / Downloads / Settings│
│  · talks to the backend over HTTP       │
├─────────────────────────────────────────┤
│  FastAPI (backend, localhost:8000)      │
│  · wraps the streamrip core library     │
│  · auth / search / download / config    │
└─────────────────────────────────────────┘
           ↓ calls
   streamrip core (vendored in this repo)
```

Highlights:

- **Token capture**: the OAuth window is created with a fresh in-memory session every time (no remembered accounts), and the `X-User-Auth-Token` header that the Qobuz web player sends after login is intercepted via `webRequest`.
- **Real progress bars**: streamrip's terminal progress bars don't work in a GUI, so Qrip polls the download folder's file sizes to derive progress and speed.
- **Pause / resume / cancel**: streamrip's download loop is a blocking sync loop that the event loop can't interrupt. Qrip monkey-patches it — the real transfer runs in a worker thread, and the chunk callback becomes the control point for pausing (sleeps the transfer thread), resuming and cancelling (raises through, closes file handles cleanly). Cancelling also sweeps away partial files and empty folders.
- **Serial downloads**: one track at a time, matching the streamrip CLI experience.

## License

Qrip is released under the [MIT License](LICENSE).

Qrip vendors the [streamrip](https://github.com/nathom/streamrip) core library (in `streamrip/`), which remains under its original GPL-3.0 license — see `streamrip/LICENSE`.

## Notes

This tool is for downloading music you have the rights to — your own Qobuz purchases and streams, for personal use only.

**This software must not be used for any commercial purpose.**
