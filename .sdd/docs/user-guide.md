# User Guide

## What changed

The studio now offers six engines instead of two:

- OmniVoice
- MLX/Qwen
- Chatterbox
- CosyVoice
- F5-TTS
- OpenVoice V2

The rest of the browser workflow is unchanged:

1. log in
2. record or reuse a saved voice
3. choose an engine and language
4. generate speech
5. cancel if needed
6. play or download the result

## Generate speech

Prerequisites:

- you are logged in
- a reference voice is uploaded and shows as ready

Steps:

1. Select one of the six engine cards.
2. Select `English`, `Français`, or `Español`.
3. Enter the script.
4. Click `Generate speech`.
5. Wait for synthesis.

Expected result:

- a generated audio player appears
- the download button still returns a `.webm` file for browser usage

## Engine notes

### OmniVoice

- general multilingual option
- uses the existing OmniVoice backend path

### MLX/Qwen

- best fit for Apple Silicon deployments
- uses MLX plus joined WAV output under the hood

### Chatterbox

- multilingual prompt-based cloning
- can use MPS, CPU, or CUDA depending backend setup

### CosyVoice

- cross-lingual cloning path
- does not require you to type a transcript for the reference voice

### F5-TTS

- uses its CLI path
- backend lets the CLI transcribe the reference audio internally

### OpenVoice V2

- uses MeloTTS plus tone conversion
- depends on extra checkpoints compared with the other engines

## Troubleshooting

### Unsupported engine

Cause:

- a non-canonical engine id was sent from a custom client and could not be normalized

Resolution:

- use one of `omnivoice`, `mlx-qwen`, `chatterbox`, `cosyvoice`, `f5-tts`, or `openvoice`

### Engine is listed but not configured

Cause:

- `/api/health` marks the engine as `configured: false`

Resolution:

- ask the operator to set the missing Conda env, repo path, model path, or checkpoint path for that engine

### Expected WAV output was not created

Cause:

- the upstream engine process exited without creating the exact output file the backend asked for

Resolution:

- ask the operator to review the backend error message, which now includes the engine id and the expected output path

### OpenVoice language mapping error

Cause:

- the backend could not find the required OpenVoice or MeloTTS mapping for `en`, `fr`, or `es`

Resolution:

- ask the operator to verify `OPENVOICE_MELO_*` and `OPENVOICE_SOURCE_SE_*_PATH`
