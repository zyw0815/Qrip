# Qrip — Design Specification

> **Date**: 2026-08-12  
> **Status**: Approved  
> **Version**: 0.1.0  

---

## 1. Product Overview

**Qrip** is a desktop GUI application for downloading high-resolution music from Qobuz.  
It wraps the [streamrip](https://github.com/nathom/streamrip) Python core with an Electron + React frontend, replacing the CLI with a polished native-feeling desktop experience.

### 1.1 Design Principles

1. **Practical first** — Every interaction must be obvious and efficient. No confusing workflows.
2. **Beauty matters** — The app should feel premium. Dark purple aesthetic, thoughtful spacing, smooth animations.
3. **No clutter** — Three tabs. One source. No unnecessary options exposed.
4. **Extensible** — Architecture supports adding more sources (Tidal, Deezer) in future versions without rewriting the frontend.

---

## 2. Tech Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Shell | Electron | Mature desktop app framework, direct Node.js ↔ Python communication via child process |
| Frontend | React + TypeScript | Largest ecosystem, best AI tooling support, shadcn/ui component library |
| Styling | Tailwind CSS + shadcn/ui | Rapid development with pre-built accessible components |
| Python Backend | FastAPI | Lightweight REST API wrapping streamrip core modules |
| Audio Core | streamrip (Python) | Imported directly — no CLI subprocess calls |
| Auth | Electron BrowserWindow (OAuth) | In-app browser window for Google → Qobuz login flow |
| Storage | electron-store (JSON) + SQLite | App preferences in JSON, download history via streamrip's existing SQLite DB |
| Build | electron-builder | Cross-platform packaging (macOS target for V1) |

### 2.2 Why Electron over Tauri

- User chose Electron for faster development and mature ecosystem
- Node.js `child_process.spawn` makes Python communication trivial
- V1 targets macOS; cross-platform packaging available later

### 2.3 Why React

- Largest component ecosystem (shadcn/ui)
- Highest quality AI-generated code output
- User's choice after comparing React / Vue / Svelte

---

## 3. Architecture

```
┌─────────────────────────────────────────────┐
│                Electron Shell                │
│  ┌───────────────────────────────────────┐  │
│  │          React Frontend               │  │
│  │   ┌────────┐ ┌──────────┐ ┌───────┐  │  │
│  │   │ Search │ │Downloads │ │Settings│  │  │
│  │   └───┬────┘ └────┬─────┘ └───┬───┘  │  │
│  └───────┼────────────┼───────────┼──────┘  │
│          │            │           │          │
│          └────────────┼───────────┘          │
│                       │ HTTP (localhost)      │
│  ┌────────────────────▼────────────────────┐ │
│  │            FastAPI Server               │ │
│  │  ┌──────────┐ ┌──────────┐ ┌────────┐  │ │
│  │  │ Search   │ │Download  │ │  Auth  │  │ │
│  │  │ API      │ │ API      │ │  API   │  │ │
│  │  └────┬─────┘ └────┬─────┘ └───┬────┘  │ │
│  │       └─────────────┼───────────┘       │ │
│  │              ┌──────▼──────┐            │ │
│  │              │  streamrip  │            │ │
│  │              │  core lib   │            │ │
│  │              └─────────────┘            │ │
│  └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

### 3.1 Key Design Decisions

- **FastAPI as thin wrapper**: Exposes streamrip functionality as REST endpoints. No business logic in the API layer — it delegates to streamrip modules.
- **Unified source interface**: All sources implement a common `SourceClient` abstract class. V1 has `QobuzClient`; adding Tidal means implementing the same interface.
- **React talks only to FastAPI**: No direct filesystem access from the renderer process. All operations go through the Python backend.
- **Electron main process** manages: FastAPI lifecycle (start/stop), OAuth browser windows, system tray, native dialogs.

---

## 4. Page Flow

```
App Launch
    │
    ├─ Valid token cached? ──Yes──→ Main Interface (3 tabs)
    │                                  │
    └─ No ──→ Login Page              ├─ Search Tab
                 │                     ├─ Downloads Tab
                 │ (auth success)      └─ Settings Tab
                 │
                 └──→ Main Interface
```

### 4.1 Login Page (full-screen, not a tab)

An interstitial page that appears on first launch or when the auth token expires. Disappears after successful authentication. The main tab bar (Search | Downloads | Settings) never includes a login tab.

**Three login methods**, switched via sub-tabs:

| Method | UX | Backend |
|--------|----|---------|
| **Google** | Electron opens a `BrowserWindow` to Qobuz's Google OAuth flow. User signs in, Qrip captures the resulting token automatically. | OAuth callback interception |
| **Email** | Two input fields (email + password). Standard form. | POST credentials to Qobuz API, receive token |
| **Token** | Single textarea for pasting a pre-obtained auth token. Advanced users. | Validate token with Qobuz API |

**Post-login**: Token stored encrypted via `electron-store`. On next launch, validate token silently. If expired → show login page again.

**Design specs**:
- Centered card, ~380px wide
- Qrip logo at top with purple gradient text
- Sub-tab switcher for method selection
- Google sign-in button (blue, with Google "G" icon) for the Google method
- Standard form inputs for Email method
- Textarea + button for Token method

### 4.2 Main Interface — 3 Tabs

Top tab bar with three entries. Active tab highlighted with purple accent. No sidebar — tabs provide sufficient navigation for V1's feature set.

```
┌──────────────────────────────────────────┐
│  Qrip        Search  Downloads  Settings │
├──────────────────────────────────────────┤
│                                          │
│          [Tab content area]              │
│                                          │
└──────────────────────────────────────────┘
```

---

## 5. Tab: Search

### 5.1 Mode Switcher

Two sub-modes, toggled by a segmented button at the top of the tab:

- **URL Mode**: Paste a Qobuz link → Resolve → see result → Download
- **Search Mode**: Type keywords → Search → see results → Download

The mode switcher is a pair of toggle buttons with clear active/inactive states.

### 5.2 URL Mode

**Input**: Single text field accepting Qobuz URLs.

Supported link types:
- `open.qobuz.com/track/{id}` → resolves to a single track
- `open.qobuz.com/album/{id}` → resolves to an album
- `open.qobuz.com/playlist/{id}` → resolves to a playlist

Below the input, a hint box shows the three supported URL patterns with their corresponding icons (🎵 Track, 💿 Album, 📋 Playlist).

**Flow**: Paste link → click "Resolve" → see result card with full metadata → click "Download".

### 5.3 Search Mode

**Input**: Keyword search field.

Optional **filter chips** below: Albums / Tracks / Playlists — pre-filter before searching.

Below the filters, a **Recent Searches** section shows previous search queries (stored locally).

**Flow**: Type keyword → (optional) select filter → click "Search" → see results.

### 5.4 Results Display

Each result is shown as a card with:

| Field | Album | Track | Playlist |
|-------|-------|-------|----------|
| Cover art thumbnail | 80×80 💿 | 44×44 🎵 | 44×44 📋 |
| Title | ✓ | ✓ | ✓ |
| Type badge | "Album" | "Track" | "Playlist" |
| Artist | ✓ | ✓ | Creator |
| Year | ✓ | — | — |
| Track count | ✓ | — | ✓ |
| Duration | ✓ | ✓ | ✓ |
| Label | ✓ | — | — |
| **Quality tags** | FLAC 24-bit / 192 kHz / ~3,200 kbps | FLAC 24-bit / 96 kHz | Up to FLAC 24-bit / 192kHz |

**Quality tags** are displayed as green badges (`#10b981`), always visible before downloading.

**Actions**:
- **Album/Playlist**: "Download" button (purple, primary) + "View ▾" to expand track list
- **Track**: "+ Add" button to add to download queue (multiple tracks can be queued)

### 5.5 View Mode (Album Expansion)

Clicking "View ▾" on an album expands it inline to show all tracks with individual quality info and "+ Add" buttons. Useful for selective downloading.

---

## 6. Tab: Downloads

Shows all active, queued, and recently completed downloads.

### 6.1 Active Downloads

Card per downloading item showing:
- Track name
- Progress bar (purple gradient fill)
- Downloaded / Total size
- Current speed (MB/s)
- Pause button (⏸)

**Behavior**: Max N concurrent downloads (configurable, default from streamrip). Others queue.

### 6.2 Queued Downloads

Lighter cards below active downloads, showing:
- ⏳ icon
- Track name
- Parent album name
- Queue position number

### 6.3 Completed / Failed

- Completed items fade out and disappear from the list after a brief moment
- Failed items show ❌ with a "Retry" button
- A "History" section (collapsed by default) shows recent downloads

### 6.4 Download Queue Management

- Pause individual items
- Cancel individual items
- Pause All / Resume All global controls
- Clear completed button

---

## 7. Tab: Settings

Four sections with clear visual separation.

### 7.1 DOWNLOAD Section

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| Base download folder | Text + folder picker button | `~/Music/Qrip` | Root directory for all downloads |
| Audio quality | Dropdown | FLAC 24-bit / 192 kHz | Quality tier from streamrip (0–4) |
| Folder structure | Dropdown (presets + Custom) | `{artist} — {album} ({year})` | Subdirectory naming template |
| File name template | Dropdown (presets + Custom) | `{artist} — {title}` | Track file naming template |

**Preset options for Folder structure**:
1. `{artist} — {album} ({year})` — Daft Punk — Random Access Memories (2013)
2. `{artist} / {album}` — Daft Punk / Random Access Memories
3. `{artist} / ({year}) {album}` — Daft Punk / (2013) Random Access Memories
4. `{artist} — {album}` — Daft Punk — Random Access Memories

**Preset options for File name**:
1. `{artist} — {title}` — Daft Punk — Get Lucky.flac **(default)**
2. `{track}. {title}` — 01. Get Lucky.flac
3. `{track} — {title}` — 01 — Get Lucky.flac
4. `{track} {artist} — {title}` — 01 Daft Punk — Get Lucky.flac

**Custom template builder**: Clicking "+ Custom" expands a visual token builder where users drag/click tokens (`{track}`, `{title}`, `{artist}`, etc.) and separators (`—`, `.`, `/`, `(`, `)`) to assemble their own template. This prevents format errors — tokens are always valid.

Each template selection shows a **live preview** of what the resulting path/filename will look like.

### 7.2 ARTWORK Section

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| Embed cover in audio files | Toggle | **ON** | Embeds cover art into FLAC metadata |
| Embedded cover size | Dropdown | Large (≈1400×1400) | Options: Thumbnail, Small, Large, Original. **Only enabled when Embed is ON** |
| Save cover.jpg separately | Toggle | **OFF** | Saves a separate cover.jpg at highest quality |
| Saved cover max width | Dropdown | Original (no resize) | **Only visible when Save cover is ON** |

### 7.3 ACCOUNT Section

- Current login status with green indicator dot
- Display: "Qobuz — Connected"
- Subtext: "Signed in with Google · user@email.com"
- "Sign Out" button (red outline)
- "Add another Qobuz account" entry (for future multi-account support)

### 7.4 ABOUT Section

Read-only informational rows:
- Version (0.1.0)
- Check for updates → triggers update check
- Licenses → opens license viewer

---

## 8. Lyrics (Deferred)

Qobuz does not provide lyrics via streamrip. Only Tidal fetches and tags lyrics (synced/unsynced). Since V1 is Qobuz-only, no lyrics settings are exposed. When Tidal support is added in a future version, add:

- Embed lyrics toggle (ON by default)
- Prefer synced lyrics toggle

---

## 9. Visual Design System

### 9.1 Theme

- **Base**: Deep dark purple-black (`#08080f` to `#0f0f1a`)
- **Gradient accents**: Subtle radial gradients from purple with low opacity for depth
- **Card backgrounds**: `#141428` to `#1a1a30`
- **Borders**: `#1e1e35` default, `#7c3aed` for active/selected states

### 9.2 Color Palette

| Token | Hex | Usage |
|-------|-----|-------|
| bg-deep | `#08080f` | Page background |
| bg-base | `#0f0f1a` | Card/app shell background |
| bg-card | `#141428` | Elevated cards |
| bg-input | `#1a1a30` | Input fields, select rows |
| border | `#1e1e35` | Default borders |
| border-active | `#7c3aed` | Selected/focused borders |
| purple | `#7c3aed` | Primary actions, toggles ON |
| purple-light | `#a78bfa` | Active text, highlights |
| purple-ghost | `rgba(124,58,237,0.18)` | Subtle purple backgrounds |
| green | `#10b981` | Quality tags, success states |
| red | `#ef4444` | Sign out, errors |

### 9.3 Typography

- **Font**: DM Sans (body), JetBrains Mono (paths, code-like values)
- **Weights**: 300 (subtle), 400 (body), 500 (emphasis), 600 (headings), 700 (logo)
- **Logo**: `letter-spacing: -0.3px`, gradient text from `#a78bfa` to `#7c3aed`

### 9.4 Motion

- Page transitions: subtle `fadeSlideIn` (opacity + 8px Y, 0.3s ease-out)
- Toggle switches: smooth color transition (0.2s)
- Cards: border-color transition on hover (0.2s)
- Progress bars: width transition (0.3s)
- No excessive animations — professional, not playful

### 9.5 Spacing & Layout

- Card padding: 12–16px
- Section gap: 24–28px
- Input heights: 36–42px
- Button heights: 28–42px (sm to primary)
- Border radius: 6–12px (progressive based on element size)

---

## 10. Git Workflow

```
main ──────────────────────────●──●── (releases only)
  │                             │
develop ──────●────●────●───────●── (integration)
  │            │    │    │
  ├─ feat/login
  ├─ feat/search
  ├─ feat/downloads
  └─ feat/settings
```

- **`main`**: Stable releases. Only merged from `develop` when cutting a release.
- **`develop`**: Integration branch. All feature branches merge here.
- **Feature branches**: `feat/<name>`, branched from `develop`, merged back via PR.
- **Issues**: Each feature/bug has a GitHub Issue. Branch named after issue.
- **No `main` → `develop` back-merges** except during release.

### Branch Protection (set in GitHub)

- `main`: Require PR review before merge
- `develop`: Require PR review before merge (optional for solo dev)

---

## 11. Extensibility Points

### 11.1 Adding a New Source (e.g., Tidal)

1. Implement `SourceClient` abstract class in Python backend
2. Add source-specific login UI component (reuse login sub-tab pattern)
3. Add source to search/results (reuse existing card components with source badge)
4. Add source-specific settings (quality tiers, auth management)
5. No frontend architecture changes needed

### 11.2 Adding a New Tab

The tab bar component accepts a configuration array. Adding a tab means:
1. Add entry to tab config
2. Create tab component
3. Add icon and label
No existing tab code is affected.

### 11.3 Multi-Account Support

The Account settings section already has an "Add another account" placeholder. The auth system stores tokens keyed by `(source, email)` to support multiple accounts per source.

---

## 12. Open Questions / Future

| Item | Status |
|------|--------|
| Tidal support | V2 — requires OAuth device flow, MQA decryption |
| Deezer support | V2 — requires ARL cookie auth |
| SoundCloud support | V2+ — low priority (128kbps) |
| Multi-account | V2 — architecture supports it, UI placeholder exists |
| Download scheduling | Future — not in streamrip core |
| Custom theme colors | Future — CSS variables make this straightforward |
| Windows/Linux builds | Future — electron-builder supports all platforms |

---

## 13. Change Log

| Date | Version | Changes |
|------|---------|---------|
| 2026-08-12 | 0.1.0 | Initial design specification |
