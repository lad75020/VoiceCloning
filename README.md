# Voice Cloning Studio

SPA for cloning a voice using [OmniVoice](https://huggingface.co/k2-fsa/OmniVoice) or [MLX/Qwen3-TTS](https://huggingface.co/mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16):

- **Frontend:** Angular 19 + Bootstrap 5 (standalone components, signals, `@for`/`@if` control flow).
- **Backend:** Node.js + Fastify.
- **Auth:** JWT bearer tokens backed by a server-side SQLite users/sessions database.
- **MCP:** Streamable HTTP endpoint for agents at `/mcp`.
- **Inference:** `omnivoice-infer` CLI or `mlx-audio` Qwen3-TTS running inside configured conda envs.
- **Audio pipeline:** Browser or MCP client sends audio → server converts to mono 16 kHz WAV → selected engine generates WAV → server converts to WebM/Opus for HTTP UI or MP3 for MCP.

## Requirements

- Node.js 24+ with `node:sqlite` support (tested on 25)
- `ffmpeg` on `PATH`
- A working conda env named `omnivoice` with `omnivoice-infer` installed (default lookup: `/Volumes/WDBlack4TB/opt/miniconda3`)
- For MLX/Qwen: an Apple Silicon-compatible Python/conda env with `mlx-audio` installed:

```bash
pip install -U mlx-audio
```

Optional environment overrides:

| Variable                 | Default                               |
| ------------------------ | ------------------------------------- |
| `CONDA_BASE`             | `/Volumes/WDBlack4TB/opt/miniconda3`  |
| `CONDA_ENV`              | `omnivoice`                           |
| `OMNIVOICE_MODEL`        | `k2-fsa/OmniVoice`                    |
| `MLX_CONDA_ENV`          | value of `CONDA_ENV`                  |
| `MLX_QWEN_MODEL`         | `mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16` |
| `MLX_QWEN_STT_MODEL`     | `mlx-community/whisper-large-v3-turbo-asr-fp16` |
| `FFMPEG_BIN`             | `ffmpeg`                              |
| `PORT` / `HOST`          | `17992` / `0.0.0.0`                   |
| `MAX_TEXT_LENGTH`        | `5000`                                |
| `MAX_AUDIO_SAMPLE_BYTES` | `104857600`                           |
| `BODY_LIMIT`             | derived from `MAX_AUDIO_SAMPLE_BYTES` |
| `AUTH_DB_PATH`           | `backend/data/auth.sqlite`            |
| `AUTH_JWT_SECRET`        | generated and persisted in SQLite     |
| `AUTH_SESSION_TTL_SECONDS` | `43200`                             |
| `AUTH_INITIAL_USERNAME`  | unset                                 |
| `AUTH_INITIAL_PASSWORD`  | unset                                 |

## Install

```bash
cd backend  && npm install
cd ../frontend && npm install
```

## Run (development — two terminals)

Terminal 1 — backend:

```bash
cd backend
npm run dev        # starts Fastify on :17992 by default
```

Terminal 2 — frontend (proxies `/api` → the backend target configured in `frontend/proxy.conf.json`):

```bash
cd frontend
npx ng serve --open
```

Then open http://localhost:4200.

> ⚠️ Browsers only allow microphone access on `https://` or `http://localhost`. Use `localhost`, not a LAN IP, during development.

## Run (production — single server)

```bash
cd frontend && npx ng build
cd ../backend && npm start
```

The backend detects the built frontend at `frontend/dist/voice-cloning-frontend/browser` and serves it alongside the API at http://localhost:17992.

If there are no users in the auth database and `AUTH_INITIAL_USERNAME` plus `AUTH_INITIAL_PASSWORD` are set, the backend creates that initial user on startup. Otherwise, create users with the script before logging in.

Manage users with the backend scripts:

```bash
cd backend
npm run user:add -- alice "correct horse battery staple"
npm run user:list
npm run user:delete -- alice
```

## Browser voice library

The frontend can save recorded reference samples by name in browser `localStorage`. Selecting a saved voice restores the local audio sample and uploads it to the backend again so generation has a current server-side `voiceId`. Browser storage quotas apply, so very long recordings may fail to save locally.

## HTTP API

All `/api/*` routes except `POST /api/auth/login` require:

```
Authorization: Bearer <jwt>
```

Sessions are stored in SQLite and can be revoked with logout.

### `POST /api/auth/login`

```json
{ "username": "alice", "password": "correct horse battery staple" }
```

Response: `{ "token": "<jwt>", "expiresAt": "...", "user": { ... } }`.

### `GET /api/auth/me`

Returns the authenticated user and session.

### `POST /api/auth/logout`

Revokes the current session.

### `POST /api/upload-voice` (multipart)

| Field      | Type   | Description                          |
| ---------- | ------ | ------------------------------------ |
| `audio`    | file   | Recorded audio (webm/ogg/mp4/wav)    |
| `language` | string | `en` \| `fr` \| `es`                 |

Response: `{ "voiceId": "<uuid>", "language": "en" }`. The file is transcoded to mono 16 kHz PCM WAV and stored under `backend/uploads/<voiceId>.wav`.

### `POST /api/generate` (JSON)

```json
{ "voiceId": "…", "text": "Hello world.", "language": "en", "engine": "omnivoice" }
```

Supported `engine` values are `omnivoice` and `mlx-qwen`. OmniVoice runs:

```
conda run -n omnivoice --no-capture-output \
  omnivoice-infer --model k2-fsa/OmniVoice \
                  --text "<text>" \
                  --ref_audio backend/uploads/<voiceId>.wav \
                  --output backend/outputs/<jobId>.wav
```

MLX/Qwen runs:

```
conda run -n "$MLX_CONDA_ENV" --no-capture-output \
  python -m mlx_audio.tts.generate \
    --model mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16 \
    --text "<text>" \
    --ref_audio backend/uploads/<voiceId>.wav \
    --stt_model mlx-community/whisper-large-v3-turbo-asr-fp16 \
    --output_path backend/outputs \
    --file_prefix <jobId> \
    --audio_format wav \
    --join_audio
```

The generated WAV is converted to WebM/Opus and streamed back as `audio/webm`.

### `GET /api/health`

Returns `{ "status": "ok" }`.

## MCP API

The backend also exposes a Streamable HTTP MCP endpoint. It requires the same bearer token authentication:

```
POST http://localhost:17992/mcp
```

Tool: `clone_voice_to_mp3`

Arguments:

| Field                 | Type   | Description                                                |
| --------------------- | ------ | ---------------------------------------------------------- |
| `voiceSampleBase64`   | string | Base64 reference audio. A `data:<mime>;base64,...` URI also works. |
| `text`                | string | Text to synthesize using the reference voice.              |
| `voiceSampleMimeType` | string | Optional MIME type such as `audio/webm`, `audio/wav`, `audio/mpeg`, `audio/flac`. |
| `voiceSampleFilename` | string | Optional filename fallback for extension detection.        |
| `language`            | string | Optional language hint returned in metadata.               |
| `engine`              | string | Optional `omnivoice` or `mlx-qwen`; defaults to `omnivoice`. |

The tool returns an MCP `audio` content block with `mimeType: "audio/mpeg"` and base64 MP3 data, plus a text metadata block containing `filename`, `voiceId`, and `jobId`.

## Project layout

```
VoiceCloning/
├── backend/
│   ├── server.js          # Fastify app, routes, ffmpeg + inference glue
│   ├── package.json
│   ├── uploads/           # stored reference WAVs
│   ├── outputs/           # generated WAV + WebM
│   └── data/              # SQLite auth database
└── frontend/
    ├── angular.json
    └── src/app/
        ├── app.component.{ts,html,scss}
        ├── auth.service.ts
        ├── audio-recorder.service.ts
        └── voice-cloning.service.ts
```
