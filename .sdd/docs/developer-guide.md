# Developer Guide

## Development Environment Setup

### Prerequisites

- Node.js 20 or newer. The repository currently runs on Node.js with ES modules and `node:sqlite`.
- npm for both frontend and backend packages.
- ffmpeg on `PATH`, or set `FFMPEG_BIN` to the executable path.
- Conda at the path configured by `CONDA_BASE`.
- An OmniVoice-capable Conda environment and, optionally, an MLX/Qwen-capable environment.

### First-Time Setup

1. Install frontend dependencies:

```bash
cd frontend
npm install
```

2. Install backend dependencies:

```bash
cd ../backend
npm install
```

3. Create a local user:

```bash
npm run user:add -- alice choose-a-strong-password
```

4. Start the backend:

```bash
npm run dev
```

5. In another terminal, start the Angular dev server:

```bash
cd ../frontend
npm start
```

The Angular dev server forwards `/api` to the backend configured in `frontend/proxy.conf.json`.

### Updating Your Environment

After pulling changes, refresh dependencies in each package that changed:

```bash
cd frontend
npm install
cd ../backend
npm install
```

## Project Structure

```text
VoiceCloning/
  backend/
    package.json
    server.js
    scripts/users.js
    data/
    uploads/
    outputs/
  frontend/
    package.json
    angular.json
    proxy.conf.json
    public/
    src/app/
      app.component.ts
      app.component.html
      app.component.scss
      app.config.ts
      audio-recorder.service.ts
      auth.service.ts
      voice-cloning.service.ts
```

Key starting points:

- Start with `frontend/src/app/app.component.ts` for UI state and user workflows.
- Read `frontend/src/app/voice-cloning.service.ts` for HTTP API use from the UI.
- Read `backend/server.js` for authentication, routes, generation, conversion, and MCP behavior.
- Read `backend/scripts/users.js` for local auth database administration.

## Coding Conventions

### Frontend

- Angular standalone components and dependency injection are used.
- State is managed with Angular signals and computed signals.
- Services wrap browser and HTTP concerns: `AudioRecorderService`, `AuthService`, and `VoiceCloningService`.
- Component methods use async/await for workflows that combine recording, upload, and generation.
- User-visible errors are stored in signals and rendered by the component template.

### Backend

- The backend is a single ES module, `backend/server.js`.
- Route handlers use Fastify async functions.
- Password hashing uses PBKDF2 with SHA-256 and per-password salts.
- Session validation combines JWT verification with SQLite session lookup and revocation checks.
- Long-running generation is isolated behind `GenerationJobQueue` and child process helpers.
- Filesystem paths are built with `path.join` from known backend directories.

### Formatting

No explicit formatter or linter configuration was found in the inspected files. Follow the existing style: two-space indentation in JSON, semicolons in TypeScript and JavaScript, single quotes in source strings where already used, and concise async route handlers.

## Testing

### Test Structure

- Frontend tests are configured through Angular/Karma in `frontend/angular.json` and `frontend/package.json`.
- The Angular schematics configuration sets `skipTests` for generated components, classes, directives, guards, interceptors, pipes, resolvers, and services.
- No dedicated backend automated test command is defined in `backend/package.json`.

### Running Checks

```bash
# Frontend unit test runner
cd frontend
npm test

# Frontend production build
npm run build

# Backend startup check
cd ../backend
npm start

# List auth users
npm run user:list
```

## Adding New Features

### Frontend workflow

1. Add UI state and orchestration to `AppComponent` or a new focused service.
2. Add HTTP calls to `VoiceCloningService` when the feature crosses the backend boundary.
3. Update `app.component.html` and `app.component.scss` for user interaction and presentation.
4. Build the frontend with `npm run build`.

### Backend workflow

1. Add validation and route handling in `backend/server.js`.
2. Reuse helpers such as `authenticateRequest`, `runCommand`, `storeReferenceAudioFromBuffer`, and `generateClonedAudio` where possible.
3. Keep long-running work cancellable by passing AbortSignal through `GenerationJobQueue` and command helpers.
4. Update `backend/scripts/users.js` only for user administration behavior.

### Integration patterns

- UI API calls should include headers from `AuthService.authHeaders()`.
- New protected backend routes under `/api/` are automatically subject to the preHandler authentication hook unless explicitly exempted in `requiresAuthentication`.
- New MCP tools should be registered in `createVoiceCloningMcpServer` and should share core business functions with HTTP routes where possible.
