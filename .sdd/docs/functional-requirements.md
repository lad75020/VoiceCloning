# Functional Requirements

## Authentication and access

- FR-001: The system shall require authentication for protected HTTP routes and the MCP endpoint.
- FR-002: The system shall keep the existing JWT plus SQLite-backed session model.
- FR-003: The feature shall not weaken current browser auth or MCP auth behavior.

## Upload and reference handling

- FR-004: The system shall continue accepting one uploaded reference sample and converting it to mono 16 kHz WAV before inference.
- FR-005: The feature shall preserve existing browser recording, saved voice reuse, and MCP base64-audio upload behavior.

## Engine selection

- FR-006: The system shall expose exactly six canonical engine IDs:
  - `omnivoice`
  - `mlx-qwen`
  - `chatterbox`
  - `cosyvoice`
  - `f5-tts`
  - `openvoice`
- FR-007: The HTTP API shall normalize sensible aliases to those canonical IDs.
- FR-008: `/api/health` and MCP schema shall advertise the canonical IDs only.

## Inference orchestration

- FR-009: The backend shall support isolated Conda env, repo path, and model/checkpoint path configuration for each engine.
- FR-010: The backend shall invoke engines with child-process argv arrays and no shell execution.
- FR-011: The backend shall pass `AbortSignal` cancellation through the queue to active inference processes.
- FR-012: The backend shall verify that each engine created the exact expected non-empty WAV file before output conversion.
- FR-013: The backend shall return actionable engine configuration or runtime errors when inference cannot run.

## Engine-specific behavior

- FR-014: `omnivoice` shall preserve the existing `omnivoice-infer` reference-cloning path, show a required picker of supported instruction attributes when selected, accept the selected tags as `voice_prompt`, validate them before inference, and forward them as `--instruct`.
- FR-015: `mlx-qwen` shall preserve joined WAV output and language forwarding, show a required tone-description modal when selected, accept that description as `voice_prompt`, pass it to the VoiceDesign checkpoint as `--instruct`, and generate without a reference recording.
- FR-016: `chatterbox` shall use the current multilingual Chatterbox API with configurable device selection, reference audio, and language.
- FR-017: `cosyvoice` shall use a zero-shot or cross-lingual cloning API that does not add a reference transcript to the request contract, concatenate yielded chunks, and save one WAV.
- FR-018: `f5-tts` shall use the supported CLI with `--ref_text ''` and an exact output directory plus file target.
- FR-019: `openvoice` shall synthesize a base speaker through MeloTTS, extract the target speaker embedding, and tone-convert through OpenVoice V2 using configured checkpoint paths and language mappings.

## Shared HTTP and MCP behavior

- FR-020: HTTP and MCP shall continue sharing `generateClonedAudio`.
- FR-021: Browser output shall remain WebM/Opus.
- FR-022: MCP output shall remain MP3.
- FR-023: Queueing and cancellation semantics shall remain unchanged.

## Frontend behavior

- FR-024: The UI shall render six engine options with short subtitles.
- FR-025: `EngineOption` shall carry its subtitle directly rather than using a two-engine template conditional.
- FR-026: The interaction flow for record, upload, generate, cancel, play, and download shall remain unchanged.

## Testability

- FR-027: The backend shall expose engine metadata, alias normalization, and command construction from an importable module.
- FR-028: The repository shall include `node:test` coverage for:
  - all six canonical engines
  - alias normalization
  - unsupported engines
  - command and adapter argument construction
- FR-029: Backend tests shall not load model weights.
