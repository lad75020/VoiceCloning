# Developer Guide

## Backend entry points

- `backend/server.js` Fastify routes, auth, MCP transport, queue, and generation orchestration
- `backend/lib/voice-engines.js` engine metadata, alias normalization, language normalization, env resolution, and argv construction
- `backend/inference/common.py` shared Python adapter helpers
- `backend/inference/*.py` engine-specific adapters

## Frontend entry points

- `frontend/src/app/app.component.ts` UI state and engine options
- `frontend/src/app/app.component.html` six-engine selector and workflow screens
- `frontend/src/app/app.component.scss` responsive engine card layout
- `frontend/src/app/voice-cloning.service.ts` upload, generate, and cancel requests

## Local setup

```bash
cd frontend
npm install

cd ../backend
npm install
npm run user:add -- dev dev-password
```

Run development processes:

```bash
cd backend
npm run dev
```

```bash
cd frontend
npm start
```

## Engine development rules

- Add new engine metadata only in `backend/lib/voice-engines.js`.
- Keep canonical IDs stable once exposed through `/api/health` or MCP.
- Use `spawn(cmd, args)` only. Do not introduce shell command composition for inference.
- Preserve the existing request contract:
  - `jobId`
  - `voiceId`
  - `text`
  - `language`
  - `engine`
- Keep HTTP and MCP on the same `generateClonedAudio` path.
- If an engine needs Python API glue, prefer a small adapter under `backend/inference/`.

## Backend test strategy

The backend test suite is intentionally model-free.

Coverage:

- canonical engine IDs
- alias normalization
- unsupported engine rejection
- language normalization
- command construction and adapter argv assembly for all six engines

Why:

- the risky logic in this repository is path/config/argv orchestration, not the third-party model internals
- loading multi-GB weights in CI or local test runs is impractical
- command-construction tests catch regressions without touching operator model installs

Commands:

```bash
cd backend
npm test
npm run check:syntax
```

`npm run check:syntax` covers:

- `node --check server.js`
- `node --check lib/voice-engines.js`
- `python3 -m py_compile inference/*.py`

## Frontend verification

```bash
cd frontend
npm run build
```

The UI is considered valid for this feature when:

- six engine cards render cleanly
- the same generate/cancel behavior still works
- saved voices, upload, and playback remain unchanged

## Common extension points

- Add new aliases in `ENGINE_ALIASES`
- Add new language mapping behavior in `normalizeLanguageCode`
- Add new engine command construction in `buildVoiceEngineCommand`
- Add new adapter-side device handling in `backend/inference/common.py`
