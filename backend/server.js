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
import { randomUUID } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const UPLOADS_DIR = path.join(__dirname, 'uploads');
const OUTPUTS_DIR = path.join(__dirname, 'outputs');

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

const fastify = Fastify({
  logger: { level: 'info' },
  bodyLimit: BODY_LIMIT,
});

await fastify.register(cors, {
  origin: true,
  exposedHeaders: ['X-Generation-Duration-Seconds', 'X-Voice-Cloning-Engine', 'X-Language'],
});
await fastify.register(multipart, {
  limits: { fileSize: MAX_AUDIO_SAMPLE_BYTES },
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

/**
 * Run a command, resolving with { code, stdout, stderr }.
 */
function runCommand(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { ...opts });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

/**
 * Convert input audio (webm/ogg/m4a/etc.) to mono 16 kHz PCM WAV.
 */
async function convertToWav(inputPath, outputPath) {
  const args = [
    '-y',
    '-i', inputPath,
    '-ac', '1',
    '-ar', '16000',
    '-sample_fmt', 's16',
    outputPath,
  ];
  const result = await runCommand(FFMPEG_BIN, args);
  if (result.code !== 0) {
    throw new Error(`ffmpeg (to wav) failed: ${result.stderr}`);
  }
}

/**
 * Convert a WAV file to WebM/Opus.
 */
async function convertToWebmOpus(inputPath, outputPath) {
  const args = [
    '-y',
    '-i', inputPath,
    '-c:a', 'libopus',
    '-b:a', '64k',
    '-vbr', 'on',
    '-application', 'audio',
    outputPath,
  ];
  const result = await runCommand(FFMPEG_BIN, args);
  if (result.code !== 0) {
    throw new Error(`ffmpeg (to webm/opus) failed: ${result.stderr}`);
  }
}

/**
 * Convert a WAV file to MP3.
 */
async function convertToMp3(inputPath, outputPath) {
  const args = [
    '-y',
    '-i', inputPath,
    '-codec:a', 'libmp3lame',
    '-b:a', '192k',
    outputPath,
  ];
  const result = await runCommand(FFMPEG_BIN, args);
  if (result.code !== 0) {
    throw new Error(`ffmpeg (to mp3) failed: ${result.stderr}`);
  }
}

/**
 * Invoke omnivoice-infer inside the configured conda env.
 * Uses `conda run` so no shell activation is required.
 */
async function runOmnivoiceInfer({ text, refWav, outWav }) {
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
  const result = await runCommand(condaBin, args);
  if (result.code !== 0) {
    throw new Error(`omnivoice-infer failed (code ${result.code}): ${result.stderr || result.stdout}`);
  }
  return result;
}

/**
 * Invoke mlx-audio's Qwen3-TTS generator inside the configured conda env.
 * Uses --join_audio so the expected output is exactly `${jobId}.wav`.
 */
async function runMlxQwenInfer({ text, language, refWav, outWav, jobId }) {
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
  const result = await runCommand(condaBin, args);
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

async function generateClonedAudio({ text, refWav, format, engine = 'omnivoice', language }) {
  validateGenerationText(text);

  const selectedEngine = normalizeGenerationEngine(engine);
  const jobId = randomUUID();
  const outWav = path.join(OUTPUTS_DIR, `${jobId}.wav`);
  const outPath = path.join(OUTPUTS_DIR, `${jobId}.${format}`);

  if (selectedEngine === VOICE_CLONING_ENGINES['mlx-qwen'].id) {
    await runMlxQwenInfer({ text, language, refWav, outWav, jobId });
  } else {
    await runOmnivoiceInfer({ text, refWav, outWav });
  }

  if (format === 'mp3') {
    await convertToMp3(outWav, outPath);
  } else if (format === 'webm') {
    await convertToWebmOpus(outWav, outPath);
  } else {
    throw new Error(`Unsupported output format: ${format}`);
  }

  const data = await fs.readFile(outPath);
  fs.unlink(outWav).catch(() => {});

  return { jobId, data, outputPath: outPath, engine: selectedEngine };
}

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
    const { jobId, data, engine: selectedEngine } = await generateClonedAudio({
      text,
      refWav: wavPath,
      format: 'mp3',
      engine,
      language,
    });

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

fastify.get('/api/health', async () => ({
  status: 'ok',
  engines: Object.values(VOICE_CLONING_ENGINES),
}));

/**
 * Streamable HTTP MCP endpoint.
 * Exposes the clone_voice_to_mp3 tool for AI agents.
 */
fastify.all('/mcp', async (request, reply) => {
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

/**
 * POST /api/generate
 * JSON body: { voiceId, text, language, engine }
 * Runs the selected voice cloning engine, converts the result to WebM/Opus,
 * and streams it back.
 */
fastify.post('/api/generate', async (request, reply) => {
  const { voiceId, text, language, engine } = request.body || {};

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
  const generationStartedAt = process.hrtime.bigint();
  try {
    result = await generateClonedAudio({ text, refWav, format: 'webm', engine, language });
  } catch (err) {
    fastify.log.error(err);
    return reply.code(500).send({ error: 'Failed to generate cloned audio.', detail: err.message });
  }
  const generationDurationSeconds = Number(process.hrtime.bigint() - generationStartedAt) / 1_000_000_000;

  reply
    .header('Content-Type', 'audio/webm')
    .header('Content-Disposition', `inline; filename="${result.jobId}.webm"`)
    .header('Content-Length', result.data.length)
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
