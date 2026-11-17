---
name: electron-react-ts-guidelines
description: TypeScript/React coding standards (types, naming, code organization) adapted from PatrickJS/awesome-cursorrules, plus Electron main/preload/renderer separation and IPC security rules for this project. Check before writing new IPC handlers, preload bridges, or shared src/lib/*Core.ts modules.
---

# Electron + React + TypeScript guidelines

Source: the TypeScript rules below are adapted from `typescript.mdc` in
[PatrickJS/awesome-cursorrules](https://github.com/PatrickJS/awesome-cursorrules).
That catalog has no dedicated Electron rule, so the IPC/process-separation
section is written for this codebase's own architecture instead of copied
from anywhere.

## TypeScript

- Prefer `interface` for object shapes, `type` for unions/intersections/mapped types.
- Avoid `any` — use `unknown` and narrow it, or a precise generic.
- Explicit return types on exported functions (internal helpers can infer).
- PascalCase for types/interfaces, camelCase for variables/functions, UPPER_CASE for constants.
- Descriptive booleans: `isLoading`, `hasError`, not `loading`/`error` flags reused for other meanings.
- Keep a type next to where it's used; only hoist to a shared file when 2+ modules need it.

## Electron process separation (this app's own pattern)

This app already follows a strict split — keep new code inside it:

- **Main** (`electron/main/**`): Node access, IPC handlers (`*.ipc.ts`), SQLite/Prisma, Riot/YouTube API calls, filesystem, child processes. Never import React or renderer code here.
- **Preload**: the only bridge — exposes a narrow, typed `window.api.*` surface via `contextBridge.exposeInMainWorld`. Never expose `ipcRenderer` directly or a generic `invoke(channel, ...args)` passthrough; each exposed method maps to one named IPC channel with a typed payload.
- **Renderer** (`src/**`): React only. Talks to main exclusively through the preload-exposed `window.api`, never `require('electron')` directly.

## IPC security

- Validate/parse every payload an IPC handler receives (e.g. with `zod`, already a dependency) before touching the DB or filesystem — the renderer is not a trusted boundary even though it's local.
- Never pass a raw SQL fragment, file path, or shell command built from renderer input straight through; this app already uses Prisma/parameterized queries — keep doing that for any new handler.
- Keep `nodeIntegration: false` / `contextIsolation: true` on every `BrowserWindow` (already the project default) — don't flip these for convenience in a new window.

## Shared `src/lib/<feature>.ts` / `<feature>Core.ts` pattern

- `<feature>Core.ts`: pure functions only, no I/O, no Electron/Supabase imports — these are what get unit-tested with vitest.
- `<feature>.ts`: the `Api` interface + types, implemented once for desktop (IPC-wrapped) and once for web (direct Supabase), calling into the same `Core` functions so behavior can't drift between the two builds.
