# Deployment Guide

## Prerequisites

### Software Requirements

| Software | Minimum Version | Purpose |
|----------|-----------------|---------|
| Node.js | 20 or newer | Backend and Angular tooling runtime |
| npm | Bundled with Node.js | Install dependencies and run scripts |
| ffmpeg | Any version supporting the target formats | Convert uploads to WAV and outputs to WebM or MP3 |
| Conda | Local installation | Run OmniVoice and MLX/Qwen environments |
| OmniVoice environment | Project-specific | Provides `omnivoice-infer` |
| MLX/Qwen environment | Project-specific | Provides `mlx_audio.tts.generate` and related model tooling |

### Runtime Storage

The backend creates and uses these directories:

- `backend/data/` for `auth.sqlite`.
- `backend/uploads/` for uploaded reference audio and converted WAV files.
- `backend/outputs/` for generated audio.

Treat these directories as sensitive runtime data. Voice samples can contain biometric data.

### Required Credentials

- At least one local user must exist in the SQLite auth database.
- A strong JWT signing secret should be supplied with `AUTH_JWT_SECRET` for shared deployments.
- The MCP endpoint uses a generated bearer token stored in SQLite when not explicitly managed elsewhere.

## Build and Release

### Install Dependencies

```bash
cd frontend
npm install

cd ../backend
npm install
```

### Build Frontend

```bash
cd frontend
npm run build
```

The Angular production output is written below `frontend/dist/voice-cloning-frontend`. The backend serves `frontend/dist/voice-cloning-frontend/browser` when present.

### Prepare Backend User

```bash
cd backend
npm run user:add -- alice choose-a-strong-password
```

Use `npm run user:list` to verify users.

## Deployment Process

### Production-Style Local Deployment

1. Install dependencies in both packages.
2. Build the frontend.
3. Configure backend environment variables for the host, port, Conda paths, engine models, auth database, and JWT secret.
4. Create at least one user.
5. Start the backend:

```bash
cd backend
npm start
```

6. Open the backend URL in a browser. If the frontend build exists, the backend serves the app from the same process.

### Development Deployment

Run two processes:

```bash
cd backend
npm run dev
```

```bash
cd frontend
npm start
```

The frontend dev server proxies `/api` to `http://localhost:17992`.

### Rollback

No repository-defined release artifact, container image, or automated rollback process was found. For local deployments, rollback means restoring the previous code checkout, reinstalling dependencies if needed, rebuilding the frontend, and restarting the backend. Preserve `backend/data/auth.sqlite` if users and sessions should survive rollback.

## Health Checks

| Endpoint | Method | Expected Response | Checks |
|----------|--------|-------------------|--------|
| `/api/health` | GET | JSON with `status` equal to `ok` and a list of engines | Backend is running and can report configured engine options |

Authentication is required for `/api/health` because the backend preHandler protects `/api/` routes except login. Check health with a valid user bearer session.

## Operational Procedures

### User Administration

```bash
cd backend
npm run user:add -- alice choose-a-strong-password
npm run user:list
npm run user:delete -- alice
```

The `AUTH_DB_PATH` environment variable can point these commands at a non-default database.

### Logs

The Fastify backend uses the built-in logger at info level. In foreground operation, logs are written to stdout and stderr of the Node.js process.

### Runtime Data Management

- Back up `backend/data/auth.sqlite` if local users must be preserved.
- Periodically review `backend/uploads/` and `backend/outputs/` because generated media can consume disk space.
- Do not commit runtime media or SQLite files to source control.

### Security Operations

- Set `AUTH_JWT_SECRET` explicitly for shared deployments.
- Keep the app behind TLS and trusted network controls before exposing it outside localhost or a private network.
- Protect bearer credentials for both HTTP users and MCP clients.
- Treat uploaded and generated audio as sensitive data.

### Scaling

No horizontal scaling configuration was found. The in-memory generation queue and local filesystem storage make a single backend process the supported deployment shape unless the queue, uploads, outputs, and auth database are externalized.
