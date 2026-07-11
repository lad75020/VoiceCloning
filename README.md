# VoiceCloning

VoiceCloning is an authenticated Angular + Fastify studio for recording a reference voice, generating cloned speech over HTTP or MCP, and returning browser WebM/Opus or MCP MP3 output without changing the existing queue, cancellation, and upload workflow.

## Engines

Canonical engine IDs:

- `omnivoice`
- `mlx-qwen`
- `chatterbox`
- `cosyvoice`
- `f5-tts`
- `openvoice`

HTTP requests accept sensible aliases such as `mlx`, `qwen`, `cosy`, `f5`, and `openvoice-v2`, but `/api/health` and MCP expose only the six canonical IDs above.

## Repository layout

- `frontend/` Angular UI, auth client, audio recorder, and engine selector.
- `backend/` Fastify API, MCP endpoint, auth database, queue, and inference orchestration.
- `backend/lib/voice-engines.js` shared engine metadata, alias normalization, language mapping, and argv construction.
- `backend/inference/` Python adapters for Chatterbox, CosyVoice, and OpenVoice V2.
- `backend/test/voice-engines.test.js` backend command-construction tests that do not load models.
- `.sdd/docs/` architecture, configuration, deployment, developer, functional, user, and evidence documentation.

## Prerequisites

- Node.js 20+.
- npm.
- `ffmpeg` on `PATH`, or set `FFMPEG_BIN`.
- Conda installed at `CONDA_BASE`.
- Enough disk for model caches, OpenVoice checkpoints, uploads, outputs, and `backend/data/auth.sqlite`.

## Install application dependencies

```bash
cd frontend
npm install

cd ../backend
npm install
```

Create a local user from `backend/`:

```bash
npm run user:add -- <username> <password>
```

## Backend environment variables

Core server variables:

```bash
HOST=0.0.0.0
PORT=17992
FFMPEG_BIN=ffmpeg
MAX_TEXT_LENGTH=5000
MAX_AUDIO_SAMPLE_BYTES=104857600
BODY_LIMIT=147849216
AUTH_DB_PATH=backend/data/auth.sqlite
AUTH_JWT_SECRET=<set-explicitly-for-shared-deployments>
AUTH_SESSION_TTL_SECONDS=43200
AUTH_INITIAL_USERNAME=
AUTH_INITIAL_PASSWORD=
CONDA_BASE=/Volumes/WDBlack4TB/opt/miniconda3
CONDA_ENV=omnivoice
```

Per-engine variables:

```bash
OMNIVOICE_CONDA_ENV=omnivoice
OMNIVOICE_MODEL=k2-fsa/OmniVoice

MLX_QWEN_CONDA_ENV=omnivoice
MLX_QWEN_MODEL=mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16
MLX_QWEN_STT_MODEL=mlx-community/whisper-large-v3-turbo-asr-fp16

CHATTERBOX_CONDA_ENV=chatterbox
CHATTERBOX_REPO_PATH=/absolute/path/to/chatterbox
CHATTERBOX_MODEL=ResembleAI/chatterbox
CHATTERBOX_DEVICE=auto
CHATTERBOX_T3_MODEL=v3

COSYVOICE_CONDA_ENV=cosyvoice
COSYVOICE_REPO_PATH=/absolute/path/to/CosyVoice
COSYVOICE_MODEL_PATH=/absolute/path/to/CosyVoice/pretrained_models/CosyVoice2-0.5B

F5_TTS_CONDA_ENV=f5-tts
F5_TTS_REPO_PATH=/absolute/path/to/F5-TTS
F5_TTS_MODEL=F5TTS_v1_Base

OPENVOICE_CONDA_ENV=openvoice
OPENVOICE_REPO_PATH=/absolute/path/to/OpenVoice
OPENVOICE_CHECKPOINTS_PATH=/absolute/path/to/OpenVoice/checkpoints_v2
OPENVOICE_DEVICE=auto
OPENVOICE_CONVERTER_CONFIG_PATH=
OPENVOICE_CONVERTER_CHECKPOINT_PATH=
OPENVOICE_MELO_LANGUAGE_EN=EN_NEWEST
OPENVOICE_MELO_SPEAKER_EN=EN-Newest
OPENVOICE_SOURCE_SE_EN_PATH=
OPENVOICE_MELO_LANGUAGE_FR=FR
OPENVOICE_MELO_SPEAKER_FR=FR
OPENVOICE_SOURCE_SE_FR_PATH=
OPENVOICE_MELO_LANGUAGE_ES=ES
OPENVOICE_MELO_SPEAKER_ES=ES
OPENVOICE_SOURCE_SE_ES_PATH=
```

Notes:

- `CONDA_ENV` remains the fallback default for legacy OmniVoice and MLX/Qwen setups.
- `COSYVOICE_MODEL_PATH` is required to run `cosyvoice`.
- `OPENVOICE_CHECKPOINTS_PATH` is required to run `openvoice`.
- If `OPENVOICE_CONVERTER_CONFIG_PATH` or `OPENVOICE_CONVERTER_CHECKPOINT_PATH` are unset, the backend derives:
  - `${OPENVOICE_CHECKPOINTS_PATH}/converter/config.json`
  - `${OPENVOICE_CHECKPOINTS_PATH}/converter/checkpoint.pth`
- If `OPENVOICE_SOURCE_SE_<LANG>_PATH` is unset, the backend derives:
  - `${OPENVOICE_CHECKPOINTS_PATH}/base_speakers/ses/<lowercase-normalized-speaker>.pth`

## Per-engine setup

These are explicit manual setup commands. They are not run during `npm install`.

### OmniVoice

```bash
conda create -n omnivoice python=3.10 -y
conda run -n omnivoice pip install omnivoice
```

- Runtime command: `omnivoice-infer`.
- Reference input: converted mono 16 kHz WAV.
- Output verification: backend requires the exact `${jobId}.wav` to exist and be non-empty.

### MLX/Qwen

```bash
conda create -n mlx-qwen python=3.10 -y
conda run -n mlx-qwen pip install mlx-audio
```

- Best on Apple Silicon.
- Uses `mlx_audio.tts.generate` plus `--join_audio` so the backend expects one exact WAV file.

### Chatterbox

```bash
git clone https://github.com/resemble-ai/chatterbox.git /absolute/path/to/chatterbox
conda create -n chatterbox python=3.11 -y
conda run -n chatterbox pip install 'setuptools<81'
conda run -n chatterbox pip install -e /absolute/path/to/chatterbox
```

- Backend adapter: `backend/inference/chatterbox_adapter.py`.
- API used: `chatterbox.mtl_tts.ChatterboxMultilingualTTS.from_pretrained(...).generate(...)`.
- Device selection: `CHATTERBOX_DEVICE=auto` prefers CUDA, then MPS, then CPU.
- `CHATTERBOX_MODEL=ResembleAI/chatterbox` uses the upstream fixed Hugging Face repository; alternatively set it to a local checkpoint directory accepted by `from_local`.

### CosyVoice

```bash
git clone --recursive https://github.com/FunAudioLLM/CosyVoice.git /absolute/path/to/CosyVoice
conda create -n cosyvoice python=3.10 -y
conda run -n cosyvoice pip install 'setuptools<81' wheel
conda run -n cosyvoice pip install --no-build-isolation openai-whisper
conda run -n cosyvoice pip install -r /absolute/path/to/CosyVoice/requirements.txt
conda run -n cosyvoice pip install modelscope
conda run -n cosyvoice python -c "from modelscope import snapshot_download; snapshot_download('iic/CosyVoice2-0.5B', local_dir='/absolute/path/to/CosyVoice/pretrained_models/CosyVoice2-0.5B')"
```

On Apple Silicon, preinstalling `openai-whisper` without build isolation avoids its legacy `pkg_resources` build failure with current setuptools. The adapter automatically adds both the CosyVoice root and `third_party/Matcha-TTS` to `sys.path`.

- Backend adapter: `backend/inference/cosyvoice_adapter.py`.
- API used: `AutoModel(...).inference_cross_lingual(text, prompt_audio, stream=False)`.
- No user-supplied reference transcript is added to the request contract.
- `COSYVOICE_MODEL_PATH` must point at the prepared local model directory.

### F5-TTS

```bash
git clone https://github.com/SWivid/F5-TTS.git /absolute/path/to/F5-TTS
conda create -n f5-tts python=3.11 -y
conda run -n f5-tts pip install -e /absolute/path/to/F5-TTS
```

- Runtime command: `f5-tts_infer-cli`.
- The backend passes `--ref_text ''` so the CLI can use its built-in ASR path.
- The backend specifies `--output_dir` and `--output_file` and then verifies the expected WAV path exactly.

### OpenVoice V2

```bash
git clone https://github.com/myshell-ai/OpenVoice.git /absolute/path/to/OpenVoice
git clone https://github.com/myshell-ai/MeloTTS.git /absolute/path/to/MeloTTS
conda create -n openvoice python=3.9 -y
conda run -n openvoice pip install 'setuptools<81' 'Cython<3'
conda install -n openvoice -c conda-forge 'av=10' 'ffmpeg=5' -y
conda run -n openvoice pip install -e /absolute/path/to/OpenVoice
conda run -n openvoice pip install -e /absolute/path/to/MeloTTS
conda run -n openvoice python -m unidic download
conda run -n openvoice python -c "import nltk; nltk.download('averaged_perceptron_tagger_eng')"
TMPDIR=/tmp conda run -n openvoice python -c "from huggingface_hub import snapshot_download; snapshot_download('myshell-ai/OpenVoiceV2', local_dir='/absolute/path/to/OpenVoice/checkpoints_v2', local_dir_use_symlinks=False)"
```

The conda-forge PyAV/FFmpeg pins avoid building legacy `av==10` against an incompatible current Homebrew FFmpeg. The Hugging Face repository is a maintained checkpoint source when the upstream S3 archive is unavailable.

- Backend adapter: `backend/inference/openvoice_adapter.py`.
- Flow: synthesize a base speaker with MeloTTS, extract the target speaker embedding from the uploaded reference, then tone-convert with OpenVoice V2.
- Required checkpoint root: `OPENVOICE_CHECKPOINTS_PATH`.
- Expected defaults under that root:
  - `converter/config.json`
  - `converter/checkpoint.pth`
  - `base_speakers/ses/<speaker>.pth`

## Run locally

Development:

```bash
cd backend
npm run dev

cd ../frontend
npm start
```

Production-style local run:

```bash
cd frontend
npm run build

cd ../backend
npm start
```

## Testing and verification

Backend tests do not load models. They cover:

- canonical engine IDs
- alias normalization
- unsupported engine rejection
- language normalization
- argv and adapter argument construction for all six engines

Commands:

```bash
cd backend
npm test
npm run check:syntax

cd ../frontend
npm run build
```

## Platform and license caveats

- `mlx-qwen` is the most Apple-Silicon-specific engine in this repository.
- `chatterbox` and `f5-tts` support MPS through their upstream PyTorch stacks; `cosyvoice` currently follows upstream device selection and generally runs on CUDA when available or CPU otherwise; `openvoice` depends on OpenVoice/MeloTTS support for the selected device.
- OpenVoice V2 also depends on MeloTTS assets and speaker embeddings.
- This repository does not bundle third-party model weights, checkpoints, or upstream repositories.
- Verify each upstream repository and model card license before downloading, redistributing, or using the corresponding engine in production.

## Security and operations

- HTTP API routes and `/mcp` remain authenticated.
- User sessions are stored server-side in `backend/data/auth.sqlite`.
- MCP auth remains the current shared-token workflow persisted in `auth_settings`.
- Uploaded audio and generated speech are sensitive biometric-like data. Keep `backend/data`, `backend/uploads`, and `backend/outputs` private.
