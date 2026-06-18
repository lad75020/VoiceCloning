# VoiceCloning

VoiceCloning is an authenticated Angular and Fastify studio for recording a voice sample, generating cloned speech with OmniVoice or MLX/Qwen, and exposing the workflow over both HTTP and MCP.

## Highlights

- Angular 19 frontend with Bootstrap styling, standalone components, signals, and browser audio recording.
- Fastify backend with multipart uploads, static production serving, and a Streamable HTTP MCP endpoint.
- JWT bearer authentication backed by a server-side SQLite users/sessions database.
- Voice sample library in the browser plus backend upload/output storage.
- Inference engines for `omnivoice-infer` and MLX/Qwen TTS through configured conda environments.
- Audio pipeline converts input samples to mono 16 kHz WAV, runs the selected engine, and returns WebM/Opus for the UI or MP3 for MCP clients.

## Repository layout

- `frontend/` - Angular application, Bootstrap assets, audio recorder service, auth service, and voice cloning UI.
- `backend/` - Fastify server, authentication database, upload/output directories, MCP endpoint, and user-management script.
- `backend/scripts/users.js` - CLI for adding, deleting, and listing local users.
- `README.md` - project-level documentation.

## Prerequisites

- Node.js 20+.
- npm.
- `ffmpeg` available on `PATH` or configured with `FFMPEG_BIN`.
- Conda installed at `CONDA_BASE`.
- An OmniVoice environment containing `omnivoice-infer`, or an MLX/Qwen environment containing the required MLX audio tooling.
- Sufficient local disk for uploaded voice samples, generated outputs, model caches, and `backend/data/auth.sqlite`.

## Installation and setup

Install frontend and backend dependencies:

```bash
cd frontend
npm install

cd ../backend
npm install
```

Create the first user from `backend/`:

```bash
npm run user:add -- <username> <password>
```

Important backend environment variables:

```bash
HOST=0.0.0.0
PORT=17992
CONDA_BASE=/Volumes/WDBlack4TB/opt/miniconda3
CONDA_ENV=omnivoice
OMNIVOICE_MODEL=k2-fsa/OmniVoice
MLX_CONDA_ENV=omnivoice
MLX_QWEN_MODEL=mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16
MLX_QWEN_STT_MODEL=mlx-community/whisper-large-v3-turbo-asr-fp16
FFMPEG_BIN=ffmpeg
MAX_TEXT_LENGTH=5000
MAX_AUDIO_SAMPLE_BYTES=104857600
AUTH_DB_PATH=backend/data/auth.sqlite
AUTH_JWT_SECRET=<set-a-secret-for-deployments>
MCP_AUTH_TOKEN=<set-a-shared-mcp-bearer-token>
AUTH_SESSION_TTL_SECONDS=43200
```

## Run and development commands

Development, in two terminals:

```bash
cd backend
npm run dev

cd frontend
npm start
```

Production-style local run:

```bash
cd frontend
npm run build

cd ../backend
npm start
```

The backend can serve the built frontend as static files when the Angular production output is present.

## User and API workflow

- Log in with a local user stored in the backend SQLite database.
- Record or upload a voice sample in the browser.
- Upload the sample to the backend and select an engine/language.
- Submit text for generation.
- Cancel long-running generation jobs when needed.
- Agents can use the backend MCP endpoint for the same voice-cloning workflow.

## Testing and checks

Frontend package scripts include:

```bash
cd frontend
npm test
npm run build
```

Backend scripts include:

```bash
cd backend
npm run user:list
npm start
```

No dedicated backend automated test script is defined in the inspected manifest.

## Configuration and security notes

- Set `AUTH_JWT_SECRET` for deployed or shared environments; otherwise tokens depend on runtime defaults.
- Set `MCP_AUTH_TOKEN` to the shared bearer token expected by MCP clients; the backend no longer generates or persists an MCP token.
- Keep `backend/data/auth.sqlite`, uploads, outputs, and generated media out of source control.
- Protect the MCP endpoint and HTTP API with bearer tokens; do not expose the service publicly without TLS and access controls.
- Uploaded audio can contain biometric data. Treat samples and generated outputs as sensitive user data.
