# Documentation Evidence Packet

This packet records the evidence gathered before writing the documentation set.

## Codebase-memory-mcp discovery

Project id: `Volumes-WDBlack4TB-Code-VoiceCloning`
Root path: `/Volumes/WDBlack4TB/Code/VoiceCloning`
Index status: ready
Indexed graph size: 213 nodes, 374 edges

Tools used:

- `list_projects` confirmed the project is indexed.
- `index_status` confirmed the graph is ready.
- `get_graph_schema` reported Function, Method, Class, Interface, File, Module, Folder, Variable, Section, and Project nodes.
- `get_architecture` reported the indexed graph summary.
- `search_graph` found backend functions, frontend classes, routes documented in README sections, configuration variables, and core methods.
- `query_graph` inspected CALLS, DEFINES, and DEFINES_METHOD relationships.
- `trace_path` traced `generateClonedAudio`, `authenticateRequest`, `createVoiceCloningMcpServer`, `submit`, frontend `generate`, `uploadVoice`, `toggleRecording`, and `login`.
- `get_code_snippet` loaded source for `generateClonedAudio`, `createVoiceCloningMcpServer`, `GenerationJobQueue`, `AppComponent`, `VoiceCloningService`, `AudioRecorderService`, and `AuthService`.
- `search_code` confirmed the environment variables read from `process.env`.

## Repository evidence

Primary source files:

- `backend/server.js`: Fastify server, authentication, SQLite schema, upload and generation routes, MCP endpoint, inference command execution, and job queue.
- `backend/scripts/users.js`: user administration CLI for the SQLite auth database.
- `backend/package.json`: backend scripts and Fastify/MCP dependencies.
- `frontend/src/app/app.component.ts`: main Angular UI state and workflows.
- `frontend/src/app/app.component.html`: login, recording, saved voices, generation, cancellation, and download UI.
- `frontend/src/app/audio-recorder.service.ts`: MediaRecorder-based recording.
- `frontend/src/app/auth.service.ts`: login/logout/session refresh and bearer header creation.
- `frontend/src/app/voice-cloning.service.ts`: HTTP client calls to upload, generate, and cancel generation.
- `frontend/angular.json`: Angular build, serve, assets, Bootstrap, and Karma configuration.
- `frontend/proxy.conf.json`: development proxy to the backend on port 17992.
- `README.md`: existing overview, prerequisites, commands, security notes, and workflow summary.

## Evidence gaps

- No `.sdd` contracts or specs existed before this run, so the API reference skill was not used to generate `.sdd/docs/api-reference.md`.
- No Dockerfile, compose file, or CI/CD workflow was found in the inspected evidence.
- No dedicated backend automated test script is defined in `backend/package.json`.
- The codebase-memory `get_architecture` response is graph-summary only, so architecture detail was synthesized from graph queries, snippets, and repository files.
