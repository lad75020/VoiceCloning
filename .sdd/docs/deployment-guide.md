# Deployment Guide

## Supported shape

The supported deployment shape is still one backend process with:

- local SQLite auth storage
- local upload and output directories
- one in-memory generation queue
- one active synthesis job at a time

## Prerequisites

- Node.js 20+ and npm
- `ffmpeg`
- Conda at `CONDA_BASE`
- Prepared per-engine Conda environments and model/checkpoint paths
- Sufficient local disk for:
  - `backend/data/auth.sqlite`
  - `backend/uploads`
  - `backend/outputs`
  - model repositories and checkpoints outside the repo

## Install and build

```bash
cd frontend
npm install
npm run build

cd ../backend
npm install
npm test
npm run check:syntax
```

Create at least one user:

```bash
cd backend
npm run user:add -- alice choose-a-strong-password
```

## Engine preparation

Before starting the backend, provision only the engines you intend to expose.

- `omnivoice`: install `omnivoice-infer` in `OMNIVOICE_CONDA_ENV`
- `mlx-qwen`: install `mlx-audio` in `MLX_QWEN_CONDA_ENV`
- `chatterbox`: install the repo in `CHATTERBOX_CONDA_ENV`, optionally with `CHATTERBOX_REPO_PATH`
- `cosyvoice`: install the repo in `COSYVOICE_CONDA_ENV` and set `COSYVOICE_MODEL_PATH`
- `f5-tts`: install the repo or package in `F5_TTS_CONDA_ENV`
- `openvoice`: install OpenVoice and MeloTTS in `OPENVOICE_CONDA_ENV`, set `OPENVOICE_CHECKPOINTS_PATH`, and verify the per-language source speaker embeddings

The app never downloads multi-GB models during `npm install`.

## Start

```bash
cd backend
npm start
```

If `frontend/dist/voice-cloning-frontend/browser` exists, the backend serves the frontend build.

## Verification

Authenticated checks:

1. Log in through the browser UI.
2. Call `GET /api/health`.
3. Confirm all intended engine IDs appear.
4. Confirm `configured: true` only for engines whose Conda env and model/checkpoint settings are ready.

Runtime verification:

1. Upload a short voice sample.
2. Generate once with each enabled engine.
3. Confirm the backend returns:
   - WebM/Opus for browser requests
   - MP3 for MCP requests
4. Confirm cancellation still works on a long-running request.

## Operational notes

- Queue behavior is process-local. Restarting the process drops queued jobs.
- Output verification is strict. If an engine writes to the wrong path or leaves an empty WAV, the request fails explicitly.
- OpenVoice, CosyVoice, Chatterbox, and F5-TTS can have larger Python dependency footprints than OmniVoice or MLX/Qwen. Isolate them in separate Conda envs.
- Protect the deployment with TLS and network controls before exposing it outside a trusted private network.

## Rollback

Rollback remains manual:

1. restore the previous checkout
2. rebuild the frontend if required
3. restart the backend
4. preserve `backend/data/auth.sqlite` if users and sessions should survive
