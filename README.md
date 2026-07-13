# VoiceCloning

VoiceCloning is an authenticated Angular + Fastify studio for recording a reference voice, generating cloned speech over HTTP or MCP, and returning browser WebM/Opus or MCP MP3 output without changing the existing queue, cancellation, and upload workflow. MLX/Qwen prompts for a natural-language voice description, Fun-CosyVoice 3 uses validated tone tags, and OpenVoice offers weighted English style controls.

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
MLX_QWEN_MODEL=mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-bf16

CHATTERBOX_CONDA_ENV=chatterbox
CHATTERBOX_REPO_PATH=/absolute/path/to/chatterbox
CHATTERBOX_MODEL=ResembleAI/chatterbox
CHATTERBOX_DEVICE=auto
CHATTERBOX_T3_MODEL=v3

COSYVOICE_CONDA_ENV=cosyvoice
COSYVOICE_REPO_PATH=/absolute/path/to/CosyVoice
COSYVOICE_MODEL=FunAudioLLM/Fun-CosyVoice3-0.5B-2512
# Optional legacy local override; takes precedence over COSYVOICE_MODEL:
# COSYVOICE_MODEL_PATH=/absolute/path/to/CosyVoice/pretrained_models/Fun-CosyVoice3-0.5B

F5_TTS_CONDA_ENV=f5-tts
F5_TTS_REPO_PATH=/absolute/path/to/F5-TTS
F5_TTS_MODEL=F5TTS_v1_Base

OPENVOICE_CONDA_ENV=openvoice
OPENVOICE_REPO_PATH=/absolute/path/to/OpenVoice
OPENVOICE_CHECKPOINTS_PATH=/absolute/path/to/OpenVoice/checkpoints_v2
OPENVOICE_V1_CHECKPOINTS_PATH=/absolute/path/to/OpenVoice/checkpoints
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
OPENVOICE_V1_BASE_CONFIG_PATH=
OPENVOICE_V1_BASE_CHECKPOINT_PATH=
OPENVOICE_V1_STYLE_SE_PATH=
OPENVOICE_V1_CONVERTER_CONFIG_PATH=
OPENVOICE_V1_CONVERTER_CHECKPOINT_PATH=
```

Notes:

- `CONDA_ENV` remains the fallback default for legacy OmniVoice and MLX/Qwen setups.
- `cosyvoice` defaults to `FunAudioLLM/Fun-CosyVoice3-0.5B-2512`; no `COSYVOICE_MODEL_PATH` is required. On its first use, the adapter resolves that Hugging Face ID into the local Hugging Face cache. Set `COSYVOICE_MODEL` to another model ID or use the legacy `COSYVOICE_MODEL_PATH` for a prepared local directory.
- `OPENVOICE_CHECKPOINTS_PATH` is required to run `openvoice`.
- If `OPENVOICE_CONVERTER_CONFIG_PATH` or `OPENVOICE_CONVERTER_CHECKPOINT_PATH` are unset, the backend derives:
  - `${OPENVOICE_CHECKPOINTS_PATH}/converter/config.json`
  - `${OPENVOICE_CHECKPOINTS_PATH}/converter/checkpoint.pth`
- If `OPENVOICE_SOURCE_SE_<LANG>_PATH` is unset, the backend derives:
  - `${OPENVOICE_CHECKPOINTS_PATH}/base_speakers/ses/<lowercase-normalized-speaker>.pth`
- `OPENVOICE_V1_CHECKPOINTS_PATH` is needed only for a nonzero English style. If unset, it defaults to `${OPENVOICE_REPO_PATH}/checkpoints`, or to a sibling `checkpoints` directory beside `OPENVOICE_CHECKPOINTS_PATH`.
- The V1 style defaults under that root are:
  - `base_speakers/EN/config.json`
  - `base_speakers/EN/checkpoint.pth`
  - `base_speakers/EN/en_style_se.pth`
  - `converter/config.json`
  - `converter/checkpoint.pth`
- The five API style keys are `happy`, `sad`, `terrified`, `cheerful`, and `friendly`; every supplied amount must be a finite number from `0` to `1`. `happy` maps to OpenVoice V1’s upstream `excited` speaker. The blend retains each continuous amount, adds neutral `max(0, 1 - max(style amounts))`, then normalizes all weights.
- Omitted or all-zero styles retain the existing V2 neutral path for English, French, and Spanish. Any nonzero style is rejected unless `engine` is `openvoice` and the output language is English.

## Per-engine setup

These are explicit manual setup commands. They are not run during `npm install`.

### OmniVoice

```bash
conda create -n omnivoice python=3.10 -y
conda run -n omnivoice pip install omnivoice
```

- Runtime command: `omnivoice-infer`.
- Selecting OmniVoice opens a required attribute picker. The browser sends the selected supported tags as `voice_prompt`; the backend validates them and forwards them as `omnivoice-infer --instruct`. OmniVoice does not accept free-form prose.
- Reference input: converted mono 16 kHz WAV.
- Output verification: backend requires the exact `${jobId}.wav` to exist and be non-empty.

### MLX/Qwen

```bash
conda create -n mlx-qwen python=3.10 -y
conda run -n mlx-qwen pip install mlx-audio
```

- Best on Apple Silicon.
- Selecting MLX/Qwen opens a required tone-description modal. The browser sends the description as the top-level `voice_prompt` field of the `/api/generate` JSON body (maximum 1000 characters); no reference recording is required.
- The backend maps `voice_prompt` to `mlx_audio.tts.generate --instruct`, the MLX/Qwen parameter for CustomVoice emotion/style and VoiceDesign descriptions.
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
conda run -n cosyvoice pip install huggingface_hub
# Optional pre-download (the adapter otherwise downloads/caches this on first use):
conda run -n cosyvoice python -c "from huggingface_hub import snapshot_download; snapshot_download('FunAudioLLM/Fun-CosyVoice3-0.5B-2512', local_dir='/absolute/path/to/CosyVoice/pretrained_models/Fun-CosyVoice3-0.5B')"
```

On Apple Silicon, preinstalling `openai-whisper` without build isolation avoids its legacy `pkg_resources` build failure with current setuptools. The adapter automatically adds both the CosyVoice root and `third_party/Matcha-TTS` to `sys.path`.

- Backend adapter: `backend/inference/cosyvoice_adapter.py`.
- Default model: `FunAudioLLM/Fun-CosyVoice3-0.5B-2512` from Hugging Face. A prepared local directory remains supported through the legacy `COSYVOICE_MODEL_PATH` override.
- API used: `AutoModel(...).inference_instruct2(text, instruction, reference_audio, stream=False)`, following upstream `cosyvoice3_example`.
- Selecting Fun-CosyVoice 3 opens a required tone-tag picker. `voice_prompt` must contain one or more comma-separated values from this exact lowercase allowlist: `adventurous, ambitious, ancient, angry, artistic, authoritative, bold, brave, calm, charming, cheerful, clever, commanding, compassionate, confident, conflicted, contempt, courageous, creative, cunning, curious, dark, deceptive, dedicated, defiant, determined, disciplined, disgusted, empathetic, energetic, fearful, fearless, happy, heroic, hopeful, humble, imaginative, indifferent, insightful, intelligent, introspective, joyful, loyal, merciless, mysterious, noble, objective, optimistic, passionate, patient, proud, relaxed, relentless, responsible, sad, selfless, serious, shocked, stealthy, surprised, vengeful, vigilant, wise, fast, loud, slow, soft, adventurer, alchemist, architect, chef, craftsman, detective, doctor, girl, knight, leader, merchant, peppa, poet, robot, ruler, scholar, wanderer, warrior, witch, youth`.
- The backend canonicalizes case and comma whitespace, rejects anything outside that allowlist, then builds the fixed English `You are a helpful assistant.` instruction. Arbitrary prompt text is never passed to the model.
- No user-supplied reference transcript is added to the request contract.

### F5-TTS

```bash
git clone https://github.com/SWivid/F5-TTS.git /absolute/path/to/F5-TTS
conda create -n f5-tts python=3.11 -y
conda run -n f5-tts pip install -e /absolute/path/to/F5-TTS
```

- Runtime command: `f5-tts_infer-cli`.
- The backend passes `--ref_text ''` so the CLI can use its built-in ASR path.
- The backend specifies `--output_dir` and `--output_file` and then verifies the expected WAV path exactly.

### OpenVoice V2 and English V1 style assets

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

For the style controls, download the OpenVoice **V1** checkpoint archive linked from the upstream [OpenVoice V1 usage instructions](https://github.com/myshell-ai/OpenVoice/blob/main/docs/USAGE.md) and extract it into `/absolute/path/to/OpenVoice/checkpoints` (or set `OPENVOICE_V1_CHECKPOINTS_PATH` to its extracted root). Verify this layout before starting the backend:

```text
checkpoints/
  base_speakers/EN/config.json
  base_speakers/EN/checkpoint.pth
  base_speakers/EN/en_style_se.pth
  converter/config.json
  converter/checkpoint.pth
```

When a style amount is nonzero, the adapter uses OpenVoice V1 `BaseSpeakerTTS` with a weighted speaker-embedding interpolation and then V1 tone-color conversion. It does not mix rendered audio. The V1 expressive English checkpoint is intentionally not used for French or Spanish.

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
- OmniVoice and Qwen `voice_prompt` validation and `--instruct` forwarding
- OpenVoice style validation, V1 argv construction, and zero-style V2 fallback

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
