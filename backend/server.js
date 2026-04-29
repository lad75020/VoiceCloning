import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import * as z from 'zod/v4';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import { createWriteStream } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pipeline } from 'stream/promises';
import {
  createHmac,
  pbkdf2Sync,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'crypto';
import { DatabaseSync } from 'node:sqlite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const UPLOADS_DIR = path.join(__dirname, 'uploads');
const OUTPUTS_DIR = path.join(__dirname, 'outputs');
const DATA_DIR = path.join(__dirname, 'data');

// Environment configuration
const CONDA_BASE = process.env.CONDA_BASE || '/Volumes/WDBlack4TB/opt/miniconda3';
const CONDA_ENV = process.env.CONDA_ENV || 'omnivoice';
const OMNIVOICE_MODEL = process.env.OMNIVOICE_MODEL || 'k2-fsa/OmniVoice';
const MLX_CONDA_ENV = process.env.MLX_CONDA_ENV || process.env.QWEN_CONDA_ENV || CONDA_ENV;
const MLX_QWEN_MODEL = process.env.MLX_QWEN_MODEL || 'mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16';
const MLX_QWEN_STT_MODEL = process.env.MLX_QWEN_STT_MODEL || 'mlx-community/whisper-large-v3-turbo-asr-fp16';
const FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg';
const PORT = parseInt(process.env.PORT || '17992', 10);
const HOST = process.env.HOST || '0.0.0.0';
const MAX_TEXT_LENGTH = parseInt(process.env.MAX_TEXT_LENGTH || '5000', 10);
const MAX_AUDIO_SAMPLE_BYTES = parseInt(process.env.MAX_AUDIO_SAMPLE_BYTES || `${100 * 1024 * 1024}`, 10);
const BODY_LIMIT = parseInt(process.env.BODY_LIMIT || `${Math.ceil(MAX_AUDIO_SAMPLE_BYTES * 1.4) + 1024 * 1024}`, 10);
const AUTH_DB_PATH = process.env.AUTH_DB_PATH || path.join(DATA_DIR, 'auth.sqlite');
let AUTH_JWT_SECRET = process.env.AUTH_JWT_SECRET || null;
const AUTH_SESSION_TTL_SECONDS = parseInt(process.env.AUTH_SESSION_TTL_SECONDS || `${12 * 60 * 60}`, 10);
const AUTH_INITIAL_USERNAME = process.env.AUTH_INITIAL_USERNAME || null;
const AUTH_INITIAL_PASSWORD = process.env.AUTH_INITIAL_PASSWORD || null;
const MCP_AUTH_TOKEN_KEY = 'mcp_auth_token';

const AUDIO_EXT_BY_MIME = {
  'audio/aac': 'aac',
  'audio/flac': 'flac',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/webm': 'webm',
  'audio/x-flac': 'flac',
  'audio/x-m4a': 'm4a',
  'audio/x-wav': 'wav',
};

const VOICE_CLONING_ENGINES = {
  omnivoice: {
    id: 'omnivoice',
    label: 'OmniVoice',
  },
  'mlx-qwen': {
    id: 'mlx-qwen',
    label: 'MLX/Qwen',
  },
};

await fs.mkdir(UPLOADS_DIR, { recursive: true });
await fs.mkdir(OUTPUTS_DIR, { recursive: true });
await fs.mkdir(DATA_DIR, { recursive: true });

const authDb = new DatabaseSync(AUTH_DB_PATH);
authDb.exec('PRAGMA journal_mode = WAL');
authDb.exec('PRAGMA foreign_keys = ON');
authDb.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

  CREATE TABLE IF NOT EXISTS auth_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

if (!AUTH_JWT_SECRET) {
  const storedSecret = authDb.prepare('SELECT value FROM auth_settings WHERE key = ?').get('jwt_secret')?.value;
  AUTH_JWT_SECRET = storedSecret || randomBytes(32).toString('base64url');
  if (!storedSecret) {
    authDb.prepare('INSERT INTO auth_settings (key, value) VALUES (?, ?)').run('jwt_secret', AUTH_JWT_SECRET);
  }
}

const MCP_AUTH_TOKEN = getOrCreateAuthSetting(MCP_AUTH_TOKEN_KEY, () => randomBytes(32).toString('base64url'));

const userCount = authDb.prepare('SELECT COUNT(*) AS count FROM users').get().count;
if (userCount === 0 && AUTH_INITIAL_USERNAME && AUTH_INITIAL_PASSWORD) {
  authDb.prepare(`
    INSERT INTO users (id, username, password_hash, created_at)
    VALUES (?, ?, ?, ?)
  `).run(randomUUID(), AUTH_INITIAL_USERNAME, hashPassword(AUTH_INITIAL_PASSWORD), new Date().toISOString());
  console.warn(`Created initial user "${AUTH_INITIAL_USERNAME}" from AUTH_INITIAL_USERNAME/AUTH_INITIAL_PASSWORD.`);
} else if (userCount === 0) {
  console.warn('No auth users exist. Create one with: npm run user:add -- <username> <password>');
}

const fastify = Fastify({
  logger: { level: 'info' },
  bodyLimit: BODY_LIMIT,
});

await fastify.register(cors, {
  origin: '*',
  exposedHeaders: ['X-Generation-Duration-Seconds', 'X-Generation-Job-Id', 'X-Voice-Cloning-Engine', 'X-Language', 'MCP-Session-Id'],
});
await fastify.register(multipart, {
  limits: { fileSize: MAX_AUDIO_SAMPLE_BYTES },
});

fastify.addHook('preHandler', async (request, reply) => {
  if (isMcpRoute(request)) {
    setMcpCorsHeaders(reply);
  }

  if (!requiresAuthentication(request)) {
    return;
  }

  const authResult = authenticateRequest(request);
  if (!authResult.ok) {
    return reply.code(401).send({ error: authResult.error });
  }

  request.user = authResult.user;
  request.session = authResult.session;
});

// Serve Angular build output if present
const FRONTEND_DIST = path.join(__dirname, '..', 'frontend', 'dist', 'voice-cloning-frontend', 'browser');
try {
  await fs.access(FRONTEND_DIST);
  await fastify.register(fastifyStatic, { root: FRONTEND_DIST, prefix: '/' });
  fastify.log.info(`Serving frontend from ${FRONTEND_DIST}`);
} catch {
  fastify.log.warn('Frontend build not found; API-only mode.');
}

function requiresAuthentication(request) {
  const url = request.url.split('?')[0];
  if (url === '/api/auth/login' || (url === '/mcp' && request.method === 'OPTIONS')) {
    return false;
  }
  return url.startsWith('/api/') || url === '/mcp';
}

function isMcpRoute(request) {
  return request.url.split('?')[0] === '/mcp';
}

function setMcpCorsHeaders(reply) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id',
    'Access-Control-Expose-Headers': 'MCP-Session-Id',
  };

  for (const [name, value] of Object.entries(headers)) {
    reply.header(name, value);
    reply.raw?.setHeader(name, value);
  }
}

function getOrCreateAuthSetting(key, createValue) {
  const storedValue = authDb.prepare('SELECT value FROM auth_settings WHERE key = ?').get(key)?.value;
  if (storedValue) {
    return storedValue;
  }

  const value = createValue();
  authDb.prepare('INSERT INTO auth_settings (key, value) VALUES (?, ?)').run(key, value);
  return value;
}

function hashPassword(password) {
  const salt = randomBytes(16).toString('base64url');
  const hash = pbkdf2Sync(String(password), salt, 210_000, 32, 'sha256').toString('base64url');
  return `pbkdf2_sha256$210000$${salt}$${hash}`;
}

function verifyPassword(password, storedHash) {
  const [scheme, iterations, salt, expectedHash] = String(storedHash || '').split('$');
  if (scheme !== 'pbkdf2_sha256' || !iterations || !salt || !expectedHash) {
    return false;
  }

  const actual = pbkdf2Sync(String(password), salt, Number(iterations), 32, 'sha256');
  const expected = Buffer.from(expectedHash, 'base64url');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function signJwt(payload) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64UrlJson(header);
  const encodedPayload = base64UrlJson(payload);
  const signature = createHmac('sha256', AUTH_JWT_SECRET)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64url');
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function verifyJwt(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid token.');
  }

  const [encodedHeader, encodedPayload, signature] = parts;
  const expectedSignature = createHmac('sha256', AUTH_JWT_SECRET)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64url');
  const actual = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error('Invalid token signature.');
  }

  const header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8'));
  if (header.alg !== 'HS256' || header.typ !== 'JWT') {
    throw new Error('Unsupported token.');
  }

  const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  if (!payload.exp || Date.now() >= payload.exp * 1000) {
    throw new Error('Token expired.');
  }
  return payload;
}

function hashToken(token) {
  return createHmac('sha256', AUTH_JWT_SECRET).update(token).digest('base64url');
}

function getBearerToken(request) {
  const header = request.headers.authorization || '';
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match?.[1] || null;
}

function authenticateRequest(request) {
  if (isMcpRoute(request)) {
    return authenticateMcpRequest(request);
  }

  const token = getBearerToken(request);
  if (!token) {
    return { ok: false, error: 'Authentication required.' };
  }

  let payload;
  try {
    payload = verifyJwt(token);
  } catch {
    return { ok: false, error: 'Invalid or expired token.' };
  }

  const tokenHash = hashToken(token);
  const row = authDb.prepare(`
    SELECT
      sessions.id AS session_id,
      sessions.expires_at,
      sessions.revoked_at,
      users.id AS user_id,
      users.username
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.id = ? AND sessions.token_hash = ?
  `).get(payload.sid, tokenHash);

  if (!row || row.revoked_at || Date.parse(row.expires_at) <= Date.now()) {
    return { ok: false, error: 'Session expired.' };
  }

  return {
    ok: true,
    user: { id: row.user_id, username: row.username },
    session: { id: row.session_id, expiresAt: row.expires_at },
  };
}

function authenticateMcpRequest(request) {
  const token = getBearerToken(request);
  if (!token) {
    return { ok: false, error: 'MCP authentication required.' };
  }

  const actual = Buffer.from(token);
  const expected = Buffer.from(MCP_AUTH_TOKEN);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return { ok: false, error: 'Invalid MCP token.' };
  }

  return {
    ok: true,
    user: { id: 'mcp', username: 'mcp' },
    session: { id: 'mcp-shared-token', expiresAt: null },
  };
}

function createSession(user) {
  const now = Math.floor(Date.now() / 1000);
  const expiresAtSeconds = now + AUTH_SESSION_TTL_SECONDS;
  const sessionId = randomUUID();
  const token = signJwt({
    sub: user.id,
    username: user.username,
    sid: sessionId,
    iat: now,
    exp: expiresAtSeconds,
  });

  const createdAt = new Date(now * 1000).toISOString();
  const expiresAt = new Date(expiresAtSeconds * 1000).toISOString();
  authDb.prepare(`
    INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(sessionId, user.id, hashToken(token), createdAt, expiresAt);

  return { token, expiresAt, user: { id: user.id, username: user.username } };
}

/**
 * Run a command, resolving with { code, stdout, stderr }.
 */
function runCommand(cmd, args, opts = {}) {
  const { signal, ...spawnOpts } = opts;

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createJobCanceledError());
      return;
    }

    let settled = false;
    let aborted = false;
    let killTimer = null;
    const child = spawn(cmd, args, {
      ...spawnOpts,
      detached: !!signal || spawnOpts.detached,
    });
    let stdout = '';
    let stderr = '';

    const cleanup = () => {
      if (killTimer) clearTimeout(killTimer);
      signal?.removeEventListener('abort', abortHandler);
    };
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn(value);
    };
    const killChild = (signalName) => {
      try {
        if (child.pid && (signal || spawnOpts.detached)) {
          process.kill(-child.pid, signalName);
        } else {
          child.kill(signalName);
        }
      } catch {
        try { child.kill(signalName); } catch { /* ignore */ }
      }
    };
    const abortHandler = () => {
      aborted = true;
      killChild('SIGTERM');
      killTimer = setTimeout(() => killChild('SIGKILL'), 5000);
    };

    child.stdout?.on('data', (d) => { stdout += d.toString(); });
    child.stderr?.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => finish(reject, aborted ? createJobCanceledError() : err));
    child.on('close', (code) => {
      if (aborted) {
        finish(reject, createJobCanceledError());
      } else {
        finish(resolve, { code, stdout, stderr });
      }
    });
    signal?.addEventListener('abort', abortHandler, { once: true });
  });
}

function createJobCanceledError() {
  const err = new Error('Generation job was cancelled.');
  err.code = 'GENERATION_CANCELLED';
  return err;
}

function isJobCanceledError(err) {
  return err?.code === 'GENERATION_CANCELLED';
}

/**
 * Convert input audio (webm/ogg/m4a/etc.) to mono 16 kHz PCM WAV.
 */
async function convertToWav(inputPath, outputPath, signal) {
  const args = [
    '-y',
    '-i', inputPath,
    '-ac', '1',
    '-ar', '16000',
    '-sample_fmt', 's16',
    outputPath,
  ];
  const result = await runCommand(FFMPEG_BIN, args, { signal });
  if (result.code !== 0) {
    throw new Error(`ffmpeg (to wav) failed: ${result.stderr}`);
  }
}

/**
 * Convert a WAV file to WebM/Opus.
 */
async function convertToWebmOpus(inputPath, outputPath, signal) {
  const args = [
    '-y',
    '-i', inputPath,
    '-c:a', 'libopus',
    '-b:a', '64k',
    '-vbr', 'on',
    '-application', 'audio',
    outputPath,
  ];
  const result = await runCommand(FFMPEG_BIN, args, { signal });
  if (result.code !== 0) {
    throw new Error(`ffmpeg (to webm/opus) failed: ${result.stderr}`);
  }
}

/**
 * Convert a WAV file to MP3.
 */
async function convertToMp3(inputPath, outputPath, signal) {
  const args = [
    '-y',
    '-i', inputPath,
    '-codec:a', 'libmp3lame',
    '-b:a', '192k',
    outputPath,
  ];
  const result = await runCommand(FFMPEG_BIN, args, { signal });
  if (result.code !== 0) {
    throw new Error(`ffmpeg (to mp3) failed: ${result.stderr}`);
  }
}

/**
 * Invoke omnivoice-infer inside the configured conda env.
 * Uses `conda run` so no shell activation is required.
 */
async function runOmnivoiceInfer({ text, refWav, outWav, signal }) {
  const condaBin = path.join(CONDA_BASE, 'bin', 'conda');
  const args = [
    'run',
    '-n', CONDA_ENV,
    '--no-capture-output',
    'omnivoice-infer',
    '--model', OMNIVOICE_MODEL,
    '--text', text,
    '--ref_audio', refWav,
    '--output', outWav,
  ];
  fastify.log.info({ cmd: condaBin, args }, 'Running omnivoice-infer');
  const result = await runCommand(condaBin, args, { signal });
  if (result.code !== 0) {
    throw new Error(`omnivoice-infer failed (code ${result.code}): ${result.stderr || result.stdout}`);
  }
  return result;
}

/**
 * Invoke mlx-audio's Qwen3-TTS generator inside the configured conda env.
 * Uses --join_audio so the expected output is exactly `${jobId}.wav`.
 */
async function runMlxQwenInfer({ text, language, refWav, outWav, jobId, signal }) {
  const condaBin = path.join(CONDA_BASE, 'bin', 'conda');
  const args = [
    'run',
    '-n', MLX_CONDA_ENV,
    '--no-capture-output',
    'python',
    '-m', 'mlx_audio.tts.generate',
    '--model', MLX_QWEN_MODEL,
    '--text', text,
    '--ref_audio', refWav,
    '--stt_model', MLX_QWEN_STT_MODEL,
    '--output_path', OUTPUTS_DIR,
    '--file_prefix', jobId,
    '--audio_format', 'wav',
    '--join_audio',
  ];

  const langCode = normalizeLanguageCode(language);
  if (langCode) {
    args.push('--lang_code', langCode);
  }

  fastify.log.info({ cmd: condaBin, args }, 'Running MLX/Qwen TTS');
  const result = await runCommand(condaBin, args, { signal });
  let outputStats = null;
  try {
    outputStats = await fs.stat(outWav);
  } catch {
    // handled below
  }

  if (result.code !== 0 || !outputStats || outputStats.size === 0) {
    throw new Error(`MLX/Qwen TTS failed (code ${result.code}): ${result.stderr || result.stdout || 'output WAV was not created'}`);
  }

  return result;
}

function normalizeGenerationEngine(engine) {
  const normalized = String(engine || 'omnivoice').trim().toLowerCase();
  if (['omnivoice', 'omni-voice', 'omni_voice'].includes(normalized)) {
    return VOICE_CLONING_ENGINES.omnivoice.id;
  }
  if (['mlx-qwen', 'mlx/qwen', 'mlx_qwen', 'qwen', 'mlx'].includes(normalized)) {
    return VOICE_CLONING_ENGINES['mlx-qwen'].id;
  }
  throw new Error(`Unsupported voice cloning engine: ${engine}`);
}

function normalizeLanguageCode(language) {
  const value = String(language || '').trim().toLowerCase();
  if (/^[a-z]{2,3}(-[a-z0-9]{2,8})?$/i.test(value)) {
    return value;
  }
  return null;
}

function isValidJobId(jobId) {
  return typeof jobId === 'string' && /^[a-f0-9-]{8,}$/i.test(jobId);
}

function validateGenerationText(text) {
  if (!text || typeof text !== 'string' || !text.trim()) {
    throw new Error('text is required.');
  }
  if (text.length > MAX_TEXT_LENGTH) {
    throw new Error(`text is too long (max ${MAX_TEXT_LENGTH} chars).`);
  }
}

function getAudioExtension({ mimeType, filename, fallback = 'audio' }) {
  const mimeExtension = AUDIO_EXT_BY_MIME[String(mimeType || '').toLowerCase()];
  if (mimeExtension) {
    return mimeExtension;
  }

  const filenameExtension = filename?.split('.').pop()?.toLowerCase();
  if (filenameExtension && /^[a-z0-9]{1,8}$/.test(filenameExtension)) {
    return filenameExtension;
  }

  return fallback;
}

function decodeBase64Audio(audioBase64, fallbackMimeType) {
  if (!audioBase64 || typeof audioBase64 !== 'string') {
    throw new Error('voiceSampleBase64 is required.');
  }

  let rawBase64 = audioBase64.trim();
  let mimeType = fallbackMimeType || 'application/octet-stream';
  const dataUriMatch = rawBase64.match(/^data:([^;,]+);base64,(.*)$/s);
  if (dataUriMatch) {
    mimeType = dataUriMatch[1];
    rawBase64 = dataUriMatch[2];
  }

  const normalizedBase64 = rawBase64.replace(/\s/g, '');
  if (!normalizedBase64 || normalizedBase64.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalizedBase64)) {
    throw new Error('voiceSampleBase64 must be valid base64 audio data.');
  }

  const buffer = Buffer.from(normalizedBase64, 'base64');
  if (!buffer.length) {
    throw new Error('voiceSampleBase64 decoded to an empty audio sample.');
  }
  if (buffer.length > MAX_AUDIO_SAMPLE_BYTES) {
    throw new Error(`voice sample is too large (max ${MAX_AUDIO_SAMPLE_BYTES} bytes).`);
  }

  return { buffer, mimeType };
}

async function storeReferenceAudioFromBuffer({ buffer, mimeType, filename }) {
  const id = randomUUID();
  const originalExt = getAudioExtension({ mimeType, filename });
  const uploadedPath = path.join(UPLOADS_DIR, `${id}.${originalExt}`);
  const wavPath = path.join(UPLOADS_DIR, `${id}.wav`);

  await fs.writeFile(uploadedPath, buffer);
  await convertToWav(uploadedPath, wavPath);

  return { voiceId: id, uploadedPath, wavPath };
}

async function generateClonedAudio({ text, refWav, format, engine = 'omnivoice', language, jobId = randomUUID(), signal }) {
  validateGenerationText(text);

  const selectedEngine = normalizeGenerationEngine(engine);
  const outWav = path.join(OUTPUTS_DIR, `${jobId}.wav`);
  const outPath = path.join(OUTPUTS_DIR, `${jobId}.${format}`);

  if (selectedEngine === VOICE_CLONING_ENGINES['mlx-qwen'].id) {
    await runMlxQwenInfer({ text, language, refWav, outWav, jobId, signal });
  } else {
    await runOmnivoiceInfer({ text, refWav, outWav, signal });
  }

  if (format === 'mp3') {
    await convertToMp3(outWav, outPath, signal);
  } else if (format === 'webm') {
    await convertToWebmOpus(outWav, outPath, signal);
  } else {
    throw new Error(`Unsupported output format: ${format}`);
  }

  const data = await fs.readFile(outPath);
  fs.unlink(outWav).catch(() => {});

  return { jobId, data, outputPath: outPath, engine: selectedEngine };
}

class GenerationJobQueue {
  activeJob = null;
  queuedJobs = [];
  jobs = new Map();

  submit({ id, userId, run }) {
    if (this.jobs.has(id)) {
      throw new Error(`Generation job already exists: ${id}`);
    }

    const controller = new AbortController();
    const job = {
      id,
      userId,
      run,
      controller,
      status: 'queued',
      promise: null,
      resolve: null,
      reject: null,
    };
    job.promise = new Promise((resolve, reject) => {
      job.resolve = resolve;
      job.reject = reject;
    });

    this.jobs.set(id, job);
    this.queuedJobs.push(job);
    this.drain();
    return {
      promise: job.promise,
      queuePosition: this.queuedJobs.findIndex((queuedJob) => queuedJob.id === id) + 1,
    };
  }

  cancel(id, userId) {
    const job = this.jobs.get(id);
    if (!job) {
      return { ok: false, status: 'not_found' };
    }
    if (job.userId !== userId) {
      return { ok: false, status: 'forbidden' };
    }

    if (job.status === 'queued') {
      this.queuedJobs = this.queuedJobs.filter((queuedJob) => queuedJob.id !== id);
      this.jobs.delete(id);
      job.status = 'cancelled';
      job.reject(createJobCanceledError());
      return { ok: true, status: 'cancelled_queued' };
    }

    if (job.status === 'active') {
      job.controller.abort();
      return { ok: true, status: 'cancelling_active' };
    }

    return { ok: false, status: job.status };
  }

  drain() {
    if (this.activeJob || this.queuedJobs.length === 0) {
      return;
    }

    const job = this.queuedJobs.shift();
    this.activeJob = job;
    job.status = 'active';

    Promise.resolve()
      .then(() => job.run(job.controller.signal))
      .then((result) => {
        job.status = 'completed';
        job.resolve(result);
      })
      .catch((err) => {
        job.status = isJobCanceledError(err) ? 'cancelled' : 'failed';
        job.reject(err);
      })
      .finally(() => {
        this.jobs.delete(job.id);
        this.activeJob = null;
        this.drain();
      });
  }
}

const generationQueue = new GenerationJobQueue();

function createVoiceCloningMcpServer() {
  const server = new McpServer({
    name: 'voice-cloning-backend',
    version: '1.0.0',
  });

  server.registerTool('clone_voice_to_mp3', {
    title: 'Clone voice to MP3',
    description: 'Generate speech as an MP3 from a reference voice sample and target text. The voice sample can be any ffmpeg-supported audio format encoded as base64.',
    inputSchema: {
      voiceSampleBase64: z.string().describe('Base64-encoded reference voice audio. A data URI is also accepted.'),
      text: z.string().min(1).max(MAX_TEXT_LENGTH).describe('Text to synthesize using the reference voice.'),
      voiceSampleMimeType: z.string().optional().describe('MIME type of the voice sample, for example audio/webm, audio/wav, audio/mpeg, audio/flac.'),
      voiceSampleFilename: z.string().optional().describe('Original filename, used only as a fallback to infer the audio extension.'),
      language: z.string().optional().describe('Optional language hint retained for client metadata.'),
      engine: z.enum(['omnivoice', 'mlx-qwen']).optional().describe('Voice cloning engine to use. Defaults to omnivoice.'),
    },
    annotations: {
      title: 'Clone voice to MP3',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
  }, async ({ voiceSampleBase64, text, voiceSampleMimeType, voiceSampleFilename, language, engine }) => {
    const { buffer, mimeType } = decodeBase64Audio(voiceSampleBase64, voiceSampleMimeType);
    const { voiceId, wavPath } = await storeReferenceAudioFromBuffer({
      buffer,
      mimeType,
      filename: voiceSampleFilename,
    });
    const mcpJobId = randomUUID();
    const { promise } = generationQueue.submit({
      id: mcpJobId,
      userId: 'mcp',
      run: (signal) => generateClonedAudio({
        text,
        refWav: wavPath,
        format: 'mp3',
        engine,
        language,
        jobId: mcpJobId,
        signal,
      }),
    });
    const { jobId, data, engine: selectedEngine } = await promise;

    return {
      content: [
        {
          type: 'audio',
          data: data.toString('base64'),
          mimeType: 'audio/mpeg',
        },
        {
          type: 'text',
          text: JSON.stringify({
            filename: `${jobId}.mp3`,
            mimeType: 'audio/mpeg',
            voiceId,
            jobId,
            engine: selectedEngine,
            language: language || null,
          }),
        },
      ],
    };
  });

  return server;
}

// ---------- Routes ----------

fastify.post('/api/auth/login', async (request, reply) => {
  const { username, password } = request.body || {};
  if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
    return reply.code(400).send({ error: 'username and password are required.' });
  }

  const user = authDb.prepare('SELECT id, username, password_hash FROM users WHERE username = ?').get(username);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return reply.code(401).send({ error: 'Invalid username or password.' });
  }

  authDb.prepare('DELETE FROM sessions WHERE expires_at <= ? OR revoked_at IS NOT NULL').run(new Date().toISOString());
  return createSession(user);
});

fastify.get('/api/auth/me', async (request) => ({
  user: request.user,
  session: request.session,
}));

fastify.post('/api/auth/logout', async (request) => {
  authDb.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ?').run(
    new Date().toISOString(),
    request.session.id,
  );
  return { ok: true };
});

fastify.get('/api/health', async () => ({
  status: 'ok',
  engines: Object.values(VOICE_CLONING_ENGINES),
}));

/**
 * Streamable HTTP MCP endpoint.
 * Exposes the clone_voice_to_mp3 tool for AI agents.
 */
fastify.all('/mcp', async (request, reply) => {
  setMcpCorsHeaders(reply);

  if (request.method === 'OPTIONS') {
    return reply.code(204).send();
  }

  if (request.method !== 'POST') {
    return reply
      .code(405)
      .header('Allow', 'POST')
      .send({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Method not allowed.',
        },
        id: null,
      });
  }

  const server = createVoiceCloningMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  reply.hijack();

  try {
    await server.connect(transport);
    await transport.handleRequest(request.raw, reply.raw, request.body);
  } catch (err) {
    fastify.log.error(err, 'Error handling MCP request');
    if (!reply.raw.headersSent) {
      reply.raw.writeHead(500, { 'Content-Type': 'application/json' });
      reply.raw.end(JSON.stringify({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal server error',
        },
        id: null,
      }));
    }
  } finally {
    await transport.close().catch(() => {});
    await server.close().catch(() => {});
  }
});

/**
 * POST /api/upload-voice
 * Multipart upload with a single 'audio' file field and optional 'language'.
 * Returns { voiceId } referring to the stored WAV reference.
 */
fastify.post('/api/upload-voice', async (request, reply) => {
  const parts = request.parts();
  let uploadedPath = null;
  let originalExt = 'webm';
  let language = 'en';

  for await (const part of parts) {
    if (part.type === 'file' && part.fieldname === 'audio') {
      const extFromMime = {
        'audio/webm': 'webm',
        'audio/ogg': 'ogg',
        'audio/mp4': 'm4a',
        'audio/mpeg': 'mp3',
        'audio/wav': 'wav',
        'audio/x-wav': 'wav',
      }[part.mimetype] || (part.filename?.split('.').pop() || 'webm');
      originalExt = extFromMime;
      const id = randomUUID();
      uploadedPath = path.join(UPLOADS_DIR, `${id}.${originalExt}`);
      await pipeline(part.file, createWriteStream(uploadedPath));
    } else if (part.type === 'field' && part.fieldname === 'language') {
      language = String(part.value || 'en');
    }
  }

  if (!uploadedPath) {
    return reply.code(400).send({ error: 'No audio file received (expected field "audio").' });
  }

  const voiceId = path.basename(uploadedPath, path.extname(uploadedPath));
  const wavPath = path.join(UPLOADS_DIR, `${voiceId}.wav`);

  try {
    await convertToWav(uploadedPath, wavPath);
  } catch (err) {
    fastify.log.error(err);
    return reply.code(500).send({ error: 'Failed to convert uploaded audio to WAV.', detail: err.message });
  }

  fastify.log.info({ voiceId, language, wavPath }, 'Voice reference stored');
  return { voiceId, language };
});

fastify.post('/api/generate/:jobId/cancel', async (request, reply) => {
  const { jobId } = request.params || {};
  if (!isValidJobId(jobId)) {
    return reply.code(400).send({ error: 'Invalid generation jobId.' });
  }

  const result = generationQueue.cancel(jobId, request.user.id);
  if (result.status === 'forbidden') {
    return reply.code(403).send({ error: 'Cannot cancel another user’s generation job.' });
  }
  if (result.status === 'not_found') {
    return reply.code(404).send({ error: 'Generation job not found.' });
  }

  return { ok: result.ok, status: result.status, jobId };
});

/**
 * POST /api/generate
 * JSON body: { jobId, voiceId, text, language, engine }
 * Runs the selected voice cloning engine, converts the result to WebM/Opus,
 * and streams it back.
 */
fastify.post('/api/generate', async (request, reply) => {
  const { jobId, voiceId, text, language, engine } = request.body || {};

  const generationJobId = jobId || randomUUID();
  if (!isValidJobId(generationJobId)) {
    return reply.code(400).send({ error: 'Invalid generation jobId.' });
  }
  if (!voiceId || typeof voiceId !== 'string') {
    return reply.code(400).send({ error: 'voiceId is required.' });
  }
  if (!text || typeof text !== 'string' || !text.trim()) {
    return reply.code(400).send({ error: 'text is required.' });
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return reply.code(400).send({ error: `text is too long (max ${MAX_TEXT_LENGTH} chars).` });
  }
  // Basic voiceId sanity to avoid path traversal
  if (!/^[a-f0-9-]{8,}$/i.test(voiceId)) {
    return reply.code(400).send({ error: 'Invalid voiceId.' });
  }

  const refWav = path.join(UPLOADS_DIR, `${voiceId}.wav`);
  try {
    await fs.access(refWav);
  } catch {
    return reply.code(404).send({ error: 'Reference voice not found; upload it first.' });
  }

  let result;
  let generationStartedAt = null;
  try {
    const { promise } = generationQueue.submit({
      id: generationJobId,
      userId: request.user.id,
      run: (signal) => {
        generationStartedAt = process.hrtime.bigint();
        return generateClonedAudio({
          text,
          refWav,
          format: 'webm',
          engine,
          language,
          jobId: generationJobId,
          signal,
        });
      },
    });
    result = await promise;
  } catch (err) {
    if (isJobCanceledError(err)) {
      return reply.code(409).send({ error: 'Generation job was cancelled.', jobId: generationJobId });
    }
    fastify.log.error(err);
    return reply.code(500).send({ error: 'Failed to generate cloned audio.', detail: err.message });
  }
  const generationDurationSeconds = generationStartedAt
    ? Number(process.hrtime.bigint() - generationStartedAt) / 1_000_000_000
    : 0;

  reply
    .header('Content-Type', 'audio/webm')
    .header('Content-Disposition', `inline; filename="${result.jobId}.webm"`)
    .header('Content-Length', result.data.length)
    .header('X-Generation-Job-Id', result.jobId)
    .header('X-Language', language || '')
    .header('X-Voice-Cloning-Engine', result.engine)
    .header('X-Generation-Duration-Seconds', generationDurationSeconds.toFixed(2))
    .send(result.data);
});

try {
  await fastify.listen({ port: PORT, host: HOST });
  fastify.log.info(`Backend listening on http://${HOST}:${PORT}`);
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
