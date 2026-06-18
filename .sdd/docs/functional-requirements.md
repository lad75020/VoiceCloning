# Functional Requirements

## 4. Functional Requirements

### 4.1 Authentication and Sessions

- FR-001: The system SHALL require authentication for protected HTTP API routes and the MCP endpoint.
  [INFERRED: HIGH] Source: `backend/server.js:142-158`, `backend/server.js:170-176`
  - Precondition: A request targets `/api/` or `/mcp`, except login and MCP OPTIONS.
  - Postcondition: Authenticated requests receive `request.user` and `request.session`.
  - Error: Return 401 with an authentication error when credentials are missing or invalid.

- FR-002: The system SHALL authenticate users with local username/password records.
  [INFERRED: HIGH] Source: `backend/server.js:828-840`, `backend/server.js:207-221`
  - Precondition: The request body contains string `username` and `password` fields.
  - Postcondition: A valid user receives a signed JWT and session metadata.
  - Error: Return 400 for missing credentials and 401 for invalid credentials.

- FR-003: The system SHALL support logout by revoking the current session.
  [INFERRED: HIGH] Source: `backend/server.js:848-854`
  - Precondition: The request is authenticated.
  - Postcondition: The session row has `revoked_at` set.
  - Error: Future use of the same token fails session validation.

### 4.2 Voice Capture and Upload

- FR-004: The system SHALL record a reference voice in supported browsers.
  [INFERRED: HIGH] Source: `frontend/src/app/audio-recorder.service.ts:13-47`, `frontend/src/app/app.component.ts:128-147`
  - Precondition: Browser microphone APIs are available and permission is granted.
  - Postcondition: The UI has a recorded Blob and preview URL.
  - Error: Show a microphone or recording error in the UI.

- FR-005: The system SHALL upload a reference audio sample and convert it to WAV.
  [INFERRED: HIGH] Source: `backend/server.js:920-960`, `backend/server.js:627-636`
  - Precondition: Multipart field `audio` contains an audio file.
  - Postcondition: The backend stores the original file, creates a converted WAV, and returns `voiceId` and `language`.
  - Error: Return 400 when no audio file is received and 500 when ffmpeg conversion fails.

- FR-006: The system SHALL support locally saved browser voice samples.
  [INFERRED: MEDIUM] Source: `frontend/src/app/app.component.ts:198-367`
  - Precondition: Browser local storage is available.
  - Postcondition: Named voice samples are stored, listed, selectable, updateable, and deletable in the browser.
  - Error: Show a local storage or saved voice loading error when persistence fails.

### 4.3 Speech Generation

- FR-007: The system SHALL generate cloned speech from uploaded voice audio and target text.
  [INFERRED: HIGH] Source: `backend/server.js:986-1053`, `backend/server.js:639-664`
  - Precondition: A valid `voiceId` exists, text is non-empty and under the configured limit, and the selected engine is supported.
  - Postcondition: The response body contains WebM audio and generation metadata headers.
  - Error: Return 400 for invalid input, 404 when the reference voice is missing, 409 when cancelled, and 500 when inference or conversion fails.

- FR-008: The system SHALL support OmniVoice and MLX/Qwen synthesis engines.
  [INFERRED: HIGH] Source: `backend/server.js:64-73`, `backend/server.js:552-560`, `backend/server.js:646-650`
  - Precondition: The requested engine is `omnivoice`, `mlx-qwen`, or a supported alias.
  - Postcondition: The selected engine runs and is reported in response metadata.
  - Error: Unsupported engine values fail generation.

- FR-009: The system SHALL enforce text length limits.
  [INFERRED: HIGH] Source: `backend/server.js:575-581`, `backend/server.js:996-1000`, `frontend/src/app/app.component.html:297-308`
  - Precondition: User or MCP client submits text for synthesis.
  - Postcondition: Accepted text is passed to the selected engine.
  - Error: Text longer than `MAX_TEXT_LENGTH` is rejected.

### 4.4 Job Queue and Cancellation

- FR-010: The system SHALL queue generation jobs and run at most one active job per backend process.
  [INFERRED: HIGH] Source: `backend/server.js:666-751`
  - Precondition: A generation request or MCP tool call is accepted.
  - Postcondition: The job is queued, becomes active when no other active job exists, and resolves or rejects when done.
  - Error: Duplicate job IDs throw an error.

- FR-011: The system SHALL allow users to cancel their own generation jobs.
  [INFERRED: HIGH] Source: `backend/server.js:701-723`, `backend/server.js:963-978`
  - Precondition: The authenticated user supplies a valid job ID.
  - Postcondition: Queued jobs are removed, active jobs receive abort, and the cancel route returns status.
  - Error: Return 403 for another user's job, 404 for a missing job, and 400 for an invalid job ID.

### 4.5 MCP Tooling

- FR-012: The system SHALL expose an MCP tool that clones a voice sample to MP3.
  [INFERRED: HIGH] Source: `backend/server.js:755-824`, `backend/server.js:865-912`
  - Precondition: The MCP request uses the configured bearer token and provides base64 audio plus text.
  - Postcondition: The MCP response contains MP3 audio content and JSON metadata.
  - Error: Non-POST MCP methods return JSON-RPC method-not-allowed errors; handler failures return JSON-RPC internal errors.

## 4B. Business Rules and Invariants

### Invariants

- INV-001: Protected API requests require a valid bearer session.
  [INFERRED: HIGH] Source: `backend/server.js:142-158`, `backend/server.js:276-315`

- INV-002: MCP requests require the MCP bearer token, not a user session token.
  [INFERRED: HIGH] Source: `backend/server.js:276-279`, `backend/server.js:317-334`

- INV-003: Reference voice paths are derived from server-generated IDs, and generation validates `voiceId` before building a path.
  [INFERRED: HIGH] Source: `backend/server.js:937-950`, `backend/server.js:1002-1007`

- INV-004: The backend queue has only one active generation job at a time.
  [INFERRED: HIGH] Source: `backend/server.js:666-751`

### Business Rules

- BR-001: Users can only cancel their own generation jobs.
  [INFERRED: HIGH] Source: `backend/server.js:701-708`

- BR-002: Browser generation returns WebM audio, while MCP generation returns MP3 audio.
  [INFERRED: HIGH] Source: `backend/server.js:789-799`, `backend/server.js:1022-1053`

- BR-003: Saved voice names are case-insensitively reused rather than duplicated.
  [INFERRED: MEDIUM] Source: `frontend/src/app/app.component.ts:198-219`

- BR-004: Invalid saved voice entries in local storage are ignored on load.
  [INFERRED: MEDIUM] Source: `frontend/src/app/app.component.ts:340-347`

## 4C. Decision Logic

- DL-001: If the engine normalizes to MLX/Qwen, run MLX/Qwen inference; otherwise run OmniVoice.
  Business meaning: The user can choose between local synthesis backends while sharing the same upload and output pipeline.
  [INFERRED: HIGH] Source: `backend/server.js:552-560`, `backend/server.js:646-650`

- DL-002: If a generation job is queued, cancellation removes it immediately; if active, cancellation aborts its child process group; otherwise the current status is returned.
  Business meaning: Users get best-effort cancellation for both waiting and running synthesis jobs.
  [INFERRED: HIGH] Source: `backend/server.js:701-723`

- DL-003: If the frontend has no token, it shows the login flow; otherwise it shows the studio workflow.
  Business meaning: Voice cloning controls are only available after authentication.
  [INFERRED: HIGH] Source: `frontend/src/app/app.component.html:43-100`

## 4D. Computed Values and Transformations

- CV-001: Password hash
  Formula: PBKDF2-SHA256 over the password with a random base64url salt, 210000 iterations, and 32 output bytes.
  Business meaning: Store password verifiers without storing plaintext passwords.
  [INFERRED: HIGH] Source: `backend/server.js:207-221`, `backend/scripts/users.js:41-45`

- CV-002: Generated JWT
  Formula: Base64url JSON header plus base64url JSON payload signed with HMAC-SHA256.
  Business meaning: Give users a portable bearer credential while retaining server-side session revocation.
  [INFERRED: HIGH] Source: `backend/server.js:224-355`

- CV-003: Generation duration header
  Formula: Difference between start and end high-resolution process time, formatted with two decimal places.
  Business meaning: Show users how long synthesis took.
  [INFERRED: MEDIUM] Source: `backend/server.js:1014-1052`

## 4E. Side Effects and Events

### Filesystem Side Effects

- SE-001: Upload stores the original sample and converted WAV in `backend/uploads`.
  [INFERRED: HIGH] Source: `backend/server.js:920-960`

- SE-002: Generation writes temporary WAV and final WebM or MP3 files in `backend/outputs`, then attempts to delete the temporary WAV.
  [INFERRED: HIGH] Source: `backend/server.js:639-664`

### Database Side Effects

- SE-003: Login deletes expired or revoked sessions and inserts a new session.
  [INFERRED: HIGH] Source: `backend/server.js:839-840`, `backend/server.js:336-355`

- SE-004: Logout marks the current session as revoked.
  [INFERRED: HIGH] Source: `backend/server.js:848-854`

### External Calls

- EXT-001: ffmpeg is spawned for input and output conversion.
  [INFERRED: HIGH] Source: `backend/server.js:361-400`, conversion helpers traced by codebase-memory.

- EXT-002: `omnivoice-infer` is spawned for OmniVoice generation.
  [INFERRED: HIGH] Source: `backend/server.js`, `generateClonedAudio` trace.

- EXT-003: `conda run ... mlx_audio.tts.generate` is spawned for MLX/Qwen generation.
  [INFERRED: HIGH] Source: `backend/server.js:520-549`

## 5. User Stories

### US-01 - Generate cloned speech (Priority: P1) MVP

As a signed-in user, I want to record a voice sample and generate speech from typed text, so that I can create cloned voice audio locally.
[INFERRED: HIGH]

Independent Test: Log in, record a sample, enter text, generate, and confirm a WebM audio player appears.

Acceptance Scenarios:
1. Given a valid session and uploaded voice, when the user submits text, then the backend returns generated WebM audio.
   Source: `backend/server.js:986-1053`
2. Given a missing reference voice, when the user submits generation, then the backend returns 404.
   Source: `backend/server.js:1007-1012`

### US-02 - Reuse a saved voice (Priority: P2)

As a signed-in user, I want to save named voice samples in my browser, so that I can reuse them without recording every time.
[INFERRED: MEDIUM]

Independent Test: Record a sample, save it with a name, reload the page, select the saved voice, and generate.

### US-03 - Cancel a long generation (Priority: P2)

As a signed-in user, I want to cancel a running generation job, so that I can stop a long or mistaken synthesis request.
[INFERRED: HIGH]

Independent Test: Start generation and click Cancel while synthesis is active.

### US-04 - Clone voice through MCP (Priority: P2)

As an AI agent, I want an MCP tool that accepts base64 reference audio and target text, so that I can generate MP3 voice-cloned speech programmatically.
[INFERRED: HIGH]

Independent Test: Call the `clone_voice_to_mp3` MCP tool with valid base64 audio and text and confirm MP3 audio content is returned.

## 6. User Flows

### 6.1 Browser Generation Flow

Actor: Signed-in user
Precondition: Backend is running, user exists, browser supports microphone recording.
Trigger: User opens the app and logs in.

1. User logs in.
   - System: Creates session and stores bearer token.
2. User records a voice sample.
   - System: Captures a Blob and previews it.
3. System uploads the sample.
   - System: Converts audio to WAV and returns `voiceId`.
4. User selects engine, language, and script.
5. User generates speech.
   - System: Queues job, runs engine, converts output, and returns WebM audio.
6. User plays or downloads the generated audio.

Error paths:
- At step 1, invalid credentials show login error.
- At step 2, browser microphone failure shows a microphone error.
- At step 3, conversion failure shows upload failure.
- At step 5, missing reference or engine failure shows generation failure.

### 6.2 MCP Generation Flow

Actor: MCP client
Precondition: Client has the MCP bearer credential and base64-encoded reference audio.
Trigger: Client calls `clone_voice_to_mp3`.

1. Client posts to `/mcp`.
   - System: Validates MCP bearer credential.
2. Tool decodes and stores reference audio.
   - System: Converts the reference to WAV.
3. Tool submits generation job.
   - System: Runs selected engine and converts output to MP3.
4. Tool returns audio content and JSON metadata.

Error paths:
- Invalid bearer credential returns an MCP authentication error.
- Invalid base64 or oversized audio fails validation.
- Inference or conversion failure returns an MCP internal error.
