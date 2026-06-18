# Configuration Guide

## Overview

VoiceCloning is configured with backend environment variables, frontend Angular configuration, and runtime files under `backend/`. The backend reads `process.env` at startup and falls back to defaults in `backend/server.js`. The frontend development server uses `frontend/proxy.conf.json` to forward `/api` requests to the backend.

Precedence is environment variable first, then the default hardcoded in the source. SQLite settings such as the generated JWT secret and MCP auth token are persisted in `backend/data/auth.sqlite` when explicit environment variables are not supplied.

## Environment Variables

### Server

| Variable | Type | Default | Required | Description |
|----------|------|---------|----------|-------------|
| `HOST` | string | `0.0.0.0` | No | Bind address for Fastify. |
| `PORT` | integer | `17992` | No | Backend HTTP port. |
| `BODY_LIMIT` | integer bytes | Computed from `MAX_AUDIO_SAMPLE_BYTES` | No | Maximum request body size for JSON and MCP payloads. |

### Audio and inference

| Variable | Type | Default | Required | Description |
|----------|------|---------|----------|-------------|
| `CONDA_BASE` | path | `/Volumes/WDBlack4TB/opt/miniconda3` | No | Base Conda installation used to locate `conda`. |
| `CONDA_ENV` | string | `omnivoice` | No | Conda environment for OmniVoice inference. |
| `OMNIVOICE_MODEL` | string | `k2-fsa/OmniVoice` | No | OmniVoice model identifier passed to `omnivoice-infer`. |
| `MLX_CONDA_ENV` | string | `QWEN_CONDA_ENV` or `CONDA_ENV` | No | Conda environment for MLX/Qwen inference. |
| `MLX_QWEN_MODEL` | string | `mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16` | No | MLX/Qwen TTS model identifier. |
| `MLX_QWEN_STT_MODEL` | string | `mlx-community/whisper-large-v3-turbo-asr-fp16` | No | STT model passed to MLX/Qwen generation. |
| `FFMPEG_BIN` | command path | `ffmpeg` | No | ffmpeg executable used for input and output conversion. |
| `MAX_TEXT_LENGTH` | integer chars | `5000` | No | Maximum text length accepted by HTTP and MCP generation. |
| `MAX_AUDIO_SAMPLE_BYTES` | integer bytes | `104857600` | No | Maximum uploaded or base64-decoded reference sample size. |

### Authentication

| Variable | Type | Default | Required | Description |
|----------|------|---------|----------|-------------|
| `AUTH_DB_PATH` | path | `backend/data/auth.sqlite` | No | SQLite database path for users, sessions, and auth settings. |
| `AUTH_JWT_SECRET` | string | Generated and stored in SQLite if absent | Recommended for deployment | Secret used to sign user JWTs. Set explicitly for shared deployments. |
| `AUTH_SESSION_TTL_SECONDS` | integer seconds | `43200` | No | Session lifetime for generated JWTs and session rows. |
| `AUTH_INITIAL_USERNAME` | string | unset | No | Optional username used to create the first user if no users exist. |
| `AUTH_INITIAL_PASSWORD` | string | unset | No | Optional password used with `AUTH_INITIAL_USERNAME` for first-user bootstrap. |

## Configuration Files

### `frontend/proxy.conf.json`

The Angular dev server forwards `/api` to `http://localhost:17992`. This matches the backend default port.

### `frontend/angular.json`

The Angular project builds to `frontend/dist/voice-cloning-frontend`, includes assets from `frontend/public`, includes Bootstrap CSS and JS, and uses Karma for `npm test`.

### `backend/data/auth.sqlite`

This runtime SQLite database is created automatically. It contains:

- `users`: local user records and password hashes.
- `sessions`: server-side session rows with token hashes, expiry, and revocation state.
- `auth_settings`: persisted generated values such as the fallback JWT secret and MCP auth token.

Do not commit this database or share it outside the trusted deployment boundary.

## Validation Rules

| Config or input | Rule | Error behavior |
|-----------------|------|----------------|
| `PORT` | Parsed as base-10 integer | Fastify listen fails if the resulting port is invalid. |
| `MAX_TEXT_LENGTH` | Parsed as base-10 integer | Text longer than the value returns a 400 for HTTP generation or fails validation for MCP generation. |
| `MAX_AUDIO_SAMPLE_BYTES` | Parsed as base-10 integer | Multipart upload is limited by Fastify multipart; MCP base64 audio above this size is rejected. |
| `engine` | Normalized to `omnivoice` or `mlx-qwen` | Unsupported values throw an unsupported engine error. |
| `language` | Optional BCP-47-like short language code | Invalid values are ignored for MLX/Qwen command arguments. |
| `jobId` | String matching a UUID-like hex and dash pattern | Invalid generation or cancel job IDs return 400. |
| `voiceId` | String matching a UUID-like hex and dash pattern | Invalid voice IDs return 400 to avoid path traversal. |

## Deployment Profiles

### Development

- Run backend and frontend separately.
- Backend default URL is `http://localhost:17992`.
- Angular `npm start` uses `proxy.conf.json` for `/api`.
- CORS allows all origins in backend source.

### Production-style local run

- Build the frontend first.
- Start the backend from `backend/`.
- The backend serves the Angular production build if `frontend/dist/voice-cloning-frontend/browser` exists.
- Set a strong `AUTH_JWT_SECRET` and protect the service with TLS and network access controls before exposing it beyond a trusted local network.
