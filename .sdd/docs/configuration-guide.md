# Configuration Guide

## Overview

The backend reads environment variables at startup and builds one runtime config object for all six engines in `backend/lib/voice-engines.js`.

Priority:

1. explicit environment variable
2. derived default from another engine-specific variable or `CONDA_ENV`
3. hardcoded default in `voice-engines.js`

## Core variables

| Variable | Default | Purpose |
|---|---|---|
| `HOST` | `0.0.0.0` | Fastify bind address |
| `PORT` | `17992` | Fastify port |
| `FFMPEG_BIN` | `ffmpeg` | Input/output conversion binary |
| `MAX_TEXT_LENGTH` | `5000` | Request validation limit |
| `MAX_AUDIO_SAMPLE_BYTES` | `104857600` | Upload and MCP base64 limit |
| `BODY_LIMIT` | derived | Fastify body limit |
| `AUTH_DB_PATH` | `backend/data/auth.sqlite` | SQLite auth DB |
| `AUTH_JWT_SECRET` | generated and persisted if absent | JWT signing secret |
| `AUTH_SESSION_TTL_SECONDS` | `43200` | Session lifetime |
| `AUTH_INITIAL_USERNAME` | unset | Optional bootstrap user |
| `AUTH_INITIAL_PASSWORD` | unset | Optional bootstrap password |
| `CONDA_BASE` | `/Volumes/WDBlack4TB/opt/miniconda3` | Root used to derive `bin/conda` |
| `CONDA_ENV` | `omnivoice` | Legacy fallback env for engines without their own override |

## Engine variables

### OmniVoice

| Variable | Default |
|---|---|
| `OMNIVOICE_CONDA_ENV` | `CONDA_ENV` |
| `OMNIVOICE_MODEL` | `k2-fsa/OmniVoice` |

### MLX/Qwen

| Variable | Default |
|---|---|
| `MLX_QWEN_CONDA_ENV` | `MLX_CONDA_ENV`, then `QWEN_CONDA_ENV`, then `CONDA_ENV` |
| `MLX_QWEN_MODEL` | `mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16` |
| `MLX_QWEN_STT_MODEL` | `mlx-community/whisper-large-v3-turbo-asr-fp16` |

### Chatterbox

| Variable | Default |
|---|---|
| `CHATTERBOX_CONDA_ENV` | `chatterbox` |
| `CHATTERBOX_REPO_PATH` | unset |
| `CHATTERBOX_MODEL` | `ResembleAI/chatterbox` |
| `CHATTERBOX_DEVICE` | `auto` |
| `CHATTERBOX_T3_MODEL` | `v3` |

### CosyVoice

| Variable | Default |
|---|---|
| `COSYVOICE_CONDA_ENV` | `cosyvoice` |
| `COSYVOICE_REPO_PATH` | unset |
| `COSYVOICE_MODEL_PATH` | unset, required to run |

### F5-TTS

| Variable | Default |
|---|---|
| `F5_TTS_CONDA_ENV` | `f5-tts` |
| `F5_TTS_REPO_PATH` | unset |
| `F5_TTS_MODEL` | `F5TTS_v1_Base` |

### OpenVoice V2

| Variable | Default or derived value |
|---|---|
| `OPENVOICE_CONDA_ENV` | `openvoice` |
| `OPENVOICE_REPO_PATH` | unset |
| `OPENVOICE_CHECKPOINTS_PATH` | unset; set to the extracted `checkpoints_v2` directory |
| `OPENVOICE_DEVICE` | `auto` |
| `OPENVOICE_CONVERTER_CONFIG_PATH` | `${OPENVOICE_CHECKPOINTS_PATH}/converter/config.json` |
| `OPENVOICE_CONVERTER_CHECKPOINT_PATH` | `${OPENVOICE_CHECKPOINTS_PATH}/converter/checkpoint.pth` |
| `OPENVOICE_MELO_LANGUAGE_EN` | `EN_NEWEST` |
| `OPENVOICE_MELO_SPEAKER_EN` | `EN-Newest` |
| `OPENVOICE_SOURCE_SE_EN_PATH` | `${OPENVOICE_CHECKPOINTS_PATH}/base_speakers/ses/en-newest.pth` |
| `OPENVOICE_MELO_LANGUAGE_FR` | `FR` |
| `OPENVOICE_MELO_SPEAKER_FR` | `FR` |
| `OPENVOICE_SOURCE_SE_FR_PATH` | `${OPENVOICE_CHECKPOINTS_PATH}/base_speakers/ses/fr.pth` |
| `OPENVOICE_MELO_LANGUAGE_ES` | `ES` |
| `OPENVOICE_MELO_SPEAKER_ES` | `ES` |
| `OPENVOICE_SOURCE_SE_ES_PATH` | `${OPENVOICE_CHECKPOINTS_PATH}/base_speakers/ses/es.pth` |

## Input normalization

- Engines normalize to the six canonical IDs.
- HTTP aliases such as `mlx`, `qwen`, `cosy`, `f5`, and `openvoice-v2` are accepted.
- MCP schema accepts only the canonical IDs.
- Language inputs normalize to `en`, `fr`, or `es`.
- Locale-style values such as `en-US`, `fr-FR`, and `es_419` map gracefully.

## Health endpoint

`GET /api/health` returns:

- `status: "ok"`
- `engines`: an array of six engine records with:
  - `id`
  - `label`
  - `subtitle`
  - `configured`

`configured: false` means the backend can identify missing required config before starting a model process.

## Runtime validation

| Input or config | Behavior |
|---|---|
| unsupported engine | HTTP 400 or MCP schema rejection |
| invalid `jobId` | HTTP 400 |
| invalid `voiceId` | HTTP 400 |
| text longer than `MAX_TEXT_LENGTH` | HTTP 400 or MCP validation failure |
| missing CosyVoice model path | actionable runtime error before spawn |
| missing OpenVoice checkpoint mapping | actionable runtime error before spawn |
| missing or empty output WAV | engine failure with expected path in the error |
