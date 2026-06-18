# User Guide

## Features

### Authenticated Voice Cloning Studio

VoiceCloning lets a signed-in user create cloned speech from a short voice reference and typed text. The browser UI guides the user through login, recording, engine selection, generation, playback, and download.

What it does: Generates speech that follows a captured reference voice.
When to use it: Use it when you need a local, private voice cloning workflow backed by OmniVoice or MLX/Qwen.

### Browser Voice Capture

The app records a short reference sample directly in the browser using the microphone. It previews the captured sample and uploads it to the backend for conversion.

What it does: Captures audio with MediaRecorder, stores a preview blob, and uploads the recording.
When to use it: Use it when creating a new voice reference from the current microphone.

### Voice Library

The browser can save named voice samples locally. Saved voices can be selected later and re-uploaded to the backend for a new session.

What it does: Stores voice sample metadata and audio data in browser local storage.
When to use it: Use it when reusing common reference voices without recording again.

### Engine and Language Selection

The UI offers OmniVoice and MLX/Qwen engines, plus English, French, and Spanish language controls in the interface.

What it does: Sends the selected engine and language with the generation request.
When to use it: Use it when choosing between available local synthesis backends or setting language metadata.

### Generation Cancellation

Long-running generation jobs can be cancelled from the UI. The backend supports cancellation for queued and active jobs.

What it does: Sends a cancel request for the current generation job.
When to use it: Use it when a synthesis job is taking too long or was started with the wrong input.

## Usage Instructions

### Log in

Prerequisites: A backend user must exist in the SQLite auth database.

1. Open the VoiceCloning web app.
2. Enter your username and password.
3. Click Log in.

Expected result: The studio controls appear and the top status changes from login required to idle.

### Record a voice sample

Prerequisites: The browser must allow microphone access.

1. Click the microphone button.
2. Speak naturally for about 10 seconds.
3. Click the microphone button again to stop recording.
4. Wait for the upload to complete.

Expected result: A preview player appears and the app shows that the voice is ready.

### Save a voice locally

Prerequisites: A recorded voice sample must be present and browser local storage must be available.

1. Enter a name in the Save this voice field.
2. Click Save.
3. Confirm the named voice appears in the Voice library.

Expected result: The sample is stored in the browser and can be selected later.

### Generate speech

Prerequisites: A voice must be ready.

1. Select an engine.
2. Select an output language.
3. Type the script to synthesize.
4. Click Generate speech.
5. Wait for synthesis to finish.
6. Play or download the generated audio.

Expected result: A generated audio player appears with a download button.

### Cancel generation

Prerequisites: A generation job must be running.

1. Click Cancel while the app is synthesizing speech.
2. Wait for the cancellation state to clear.

Expected result: The active job is cancelled if it is still queued or if the backend process accepts cancellation.

## Configuration

Most users only need browser access, microphone permission, and login credentials. Operators configure the backend with environment variables described in `configuration-guide.md`.

User-facing limits:

| Limit | Default | Effect |
|-------|---------|--------|
| Text length | 5000 characters | Longer scripts are rejected. |
| Audio sample size | 100 MiB | Larger uploads or MCP samples are rejected. |
| Session duration | 12 hours | Expired sessions require login again. |

## Common Workflows

### Create and reuse a voice

1. Log in.
2. Record a short voice sample.
3. Name the sample.
4. Click Save.
5. Generate speech with the current sample.
6. Later, select the saved sample from the Voice library instead of recording again.

Result: The user can reuse a named voice from the same browser.

### Generate with a different engine

1. Record or select a voice.
2. Select OmniVoice for the default engine or MLX/Qwen for the MLX-backed engine.
3. Enter the script.
4. Click Generate speech.

Result: The backend runs the selected engine and returns generated WebM audio to the UI.

### Recover from an expired session

1. If an API action fails because the session expired, log out if needed.
2. Log in again.
3. Re-record or select a saved voice.
4. Retry generation.

Result: The frontend stores a fresh token and authenticated API calls can continue.

## Troubleshooting

### Login errors

#### Username and password are required

Cause: One or both fields are empty.

Resolution:
1. Enter both username and password.
2. Click Log in again.

#### Invalid username or password

Cause: The backend did not find a matching user or the password check failed.

Resolution:
1. Check the username.
2. Ask an operator to create or reset the local user if needed.

### Recording errors

#### Microphone access is not available in this browser

Cause: The browser does not expose `navigator.mediaDevices.getUserMedia`.

Resolution:
1. Use a browser with MediaRecorder and microphone support.
2. Ensure the page is served from a secure context where the browser allows microphone access.

#### Browser permission prompt blocks recording

Cause: Microphone permission has not been granted.

Resolution:
1. Allow microphone access in the browser prompt.
2. If previously blocked, reset site permissions and retry.

### Upload and generation errors

#### No audio file received

Cause: The upload request did not include multipart field `audio`.

Resolution:
1. Record again from the browser UI.
2. Wait for the upload status to finish before generating.

#### Reference voice not found; upload it first

Cause: The backend cannot find the WAV file for the selected `voiceId`.

Resolution:
1. Re-select the saved voice or record a new one.
2. Wait for the voice-ready status.
3. Generate again.

#### text is too long

Cause: The script exceeds the backend `MAX_TEXT_LENGTH` limit.

Resolution:
1. Shorten the script.
2. Ask an operator to increase `MAX_TEXT_LENGTH` if the deployment can support longer requests.

#### Failed to generate cloned audio

Cause: The selected inference engine, model, Conda environment, or ffmpeg conversion failed.

Resolution:
1. Try a shorter script.
2. Try the other engine.
3. Ask an operator to check backend logs, model availability, Conda environment, and ffmpeg configuration.
