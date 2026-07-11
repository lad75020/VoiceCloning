import test from 'node:test';
import assert from 'node:assert/strict';

import {
  VOICE_CLONING_ENGINE_IDS,
  buildVoiceEngineCommand,
  createVoiceEngineRuntimeConfig,
  listVoiceCloningEngines,
  normalizeGenerationEngine,
  normalizeLanguageCode,
} from '../lib/voice-engines.js';

function createRuntimeConfig() {
  return createVoiceEngineRuntimeConfig({
    env: {
      CONDA_BASE: '/opt/miniconda3',
      CONDA_ENV: 'omnivoice-default',
      OMNIVOICE_CONDA_ENV: 'omnivoice-env',
      OMNIVOICE_MODEL: 'k2-fsa/OmniVoice',
      MLX_QWEN_CONDA_ENV: 'mlx-env',
      MLX_QWEN_MODEL: 'mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16',
      MLX_QWEN_STT_MODEL: 'mlx-community/whisper-large-v3-turbo-asr-fp16',
      CHATTERBOX_CONDA_ENV: 'chatterbox-env',
      CHATTERBOX_REPO_PATH: '/repos/chatterbox',
      CHATTERBOX_MODEL: '/models/chatterbox',
      CHATTERBOX_DEVICE: 'auto',
      CHATTERBOX_T3_MODEL: 'v3',
      COSYVOICE_CONDA_ENV: 'cosyvoice-env',
      COSYVOICE_REPO_PATH: '/repos/cosyvoice',
      COSYVOICE_MODEL_PATH: '/models/cosyvoice',

      F5_TTS_CONDA_ENV: 'f5-env',
      F5_TTS_REPO_PATH: '/repos/f5-tts',
      F5_TTS_MODEL: 'F5TTS_v1_Base',
      OPENVOICE_CONDA_ENV: 'openvoice-env',
      OPENVOICE_REPO_PATH: '/repos/openvoice',
      OPENVOICE_CHECKPOINTS_PATH: '/models/openvoice',
      OPENVOICE_DEVICE: 'auto',
      OPENVOICE_MELO_LANGUAGE_EN: 'EN_NEWEST',
      OPENVOICE_MELO_SPEAKER_EN: 'EN-Newest',
      OPENVOICE_MELO_LANGUAGE_FR: 'FR',
      OPENVOICE_MELO_SPEAKER_FR: 'FR',
      OPENVOICE_MELO_LANGUAGE_ES: 'ES',
      OPENVOICE_MELO_SPEAKER_ES: 'ES',
    },
    backendDir: '/workspace/backend',
    outputsDir: '/workspace/backend/outputs',
    uploadsDir: '/workspace/backend/uploads',
  });
}

test('canonical engine ids are exposed for health and MCP schemas', () => {
  assert.deepEqual(VOICE_CLONING_ENGINE_IDS, [
    'omnivoice',
    'mlx-qwen',
    'chatterbox',
    'cosyvoice',
    'f5-tts',
    'openvoice',
  ]);
});

test('engine aliases normalize to canonical ids', () => {
  assert.equal(normalizeGenerationEngine('omni_voice'), 'omnivoice');
  assert.equal(normalizeGenerationEngine('mlx/qwen'), 'mlx-qwen');
  assert.equal(normalizeGenerationEngine('qwen'), 'mlx-qwen');
  assert.equal(normalizeGenerationEngine('chatter-box'), 'chatterbox');
  assert.equal(normalizeGenerationEngine('cosy_voice'), 'cosyvoice');
  assert.equal(normalizeGenerationEngine('f5tts'), 'f5-tts');
  assert.equal(normalizeGenerationEngine('openvoice-v2'), 'openvoice');
});

test('unsupported engines are rejected clearly', () => {
  assert.throws(
    () => normalizeGenerationEngine('bark'),
    /Unsupported voice cloning engine: bark/,
  );
});

test('language normalization maps browser and locale aliases to supported codes', () => {
  assert.equal(normalizeLanguageCode('en-US'), 'en');
  assert.equal(normalizeLanguageCode('français'), 'fr');
  assert.equal(normalizeLanguageCode('es_419'), 'es');
  assert.equal(normalizeLanguageCode('de-DE'), null);
});

test('health metadata lists all six engines and configuration state', () => {
  const runtimeConfig = createRuntimeConfig();
  const engines = listVoiceCloningEngines(runtimeConfig);

  assert.equal(engines.length, 6);
  assert.deepEqual(
    engines.map((engine) => engine.id),
    VOICE_CLONING_ENGINE_IDS,
  );
  assert.ok(engines.every((engine) => engine.configured === true));
});

test('command builder preserves omnivoice argv contract', () => {
  const runtimeConfig = createRuntimeConfig();
  const command = buildVoiceEngineCommand({
    engine: 'omnivoice',
    text: 'Hello world',
    language: 'en',
    refWav: '/tmp/ref.wav',
    outWav: '/tmp/out.wav',
    jobId: 'job-1',
    runtimeConfig,
  });

  assert.equal(command.cmd, '/opt/miniconda3/bin/conda');
  assert.deepEqual(command.args, [
    'run',
    '-n', 'omnivoice-env',
    '--no-capture-output',
    'omnivoice-infer',
    '--model', 'k2-fsa/OmniVoice',
    '--text', 'Hello world',
    '--ref_audio', '/tmp/ref.wav',
    '--output', '/tmp/out.wav',
  ]);
});

test('command builder preserves mlx/qwen argv contract and language mapping', () => {
  const runtimeConfig = createRuntimeConfig();
  const command = buildVoiceEngineCommand({
    engine: 'mlx',
    text: 'Bonjour',
    language: 'fr-FR',
    refWav: '/tmp/ref.wav',
    outWav: '/workspace/backend/outputs/job-2.wav',
    jobId: 'job-2',
    runtimeConfig,
  });

  assert.equal(command.engine, 'mlx-qwen');
  assert.deepEqual(command.args, [
    'run',
    '-n', 'mlx-env',
    '--no-capture-output',
    'python',
    '-m', 'mlx_audio.tts.generate',
    '--model', 'mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16',
    '--text', 'Bonjour',
    '--ref_audio', '/tmp/ref.wav',
    '--stt_model', 'mlx-community/whisper-large-v3-turbo-asr-fp16',
    '--output_path', '/workspace/backend/outputs',
    '--file_prefix', 'job-2',
    '--audio_format', 'wav',
    '--join_audio',
    '--lang_code', 'fr',
  ]);
});

test('command builder uses python adapter argv for chatterbox', () => {
  const runtimeConfig = createRuntimeConfig();
  const command = buildVoiceEngineCommand({
    engine: 'chatterbox',
    text: 'Hola',
    language: 'es',
    refWav: '/tmp/ref.wav',
    outWav: '/tmp/chatterbox.wav',
    jobId: 'job-3',
    runtimeConfig,
  });

  assert.equal(command.cwd, '/repos/chatterbox');
  assert.equal(command.env.PYTHONPATH, '/repos/chatterbox');
  assert.deepEqual(command.args, [
    'run',
    '-n', 'chatterbox-env',
    '--no-capture-output',
    'python',
    '/workspace/backend/inference/chatterbox_adapter.py',
    '--text', 'Hola',
    '--language', 'es',
    '--ref-audio', '/tmp/ref.wav',
    '--output', '/tmp/chatterbox.wav',
    '--model', '/models/chatterbox',
    '--device', 'auto',
    '--t3-model', 'v3',
    '--repo-path', '/repos/chatterbox',
  ]);
});

test('command builder uses python adapter argv for cosyvoice', () => {
  const runtimeConfig = createRuntimeConfig();
  const command = buildVoiceEngineCommand({
    engine: 'cosy',
    text: 'Cross lingual',
    language: 'en',
    refWav: '/tmp/ref.wav',
    outWav: '/tmp/cosyvoice.wav',
    jobId: 'job-4',
    runtimeConfig,
  });

  assert.equal(command.cwd, '/repos/cosyvoice');
  assert.equal(command.env.PYTHONPATH, '/repos/cosyvoice');
  assert.deepEqual(command.args, [
    'run',
    '-n', 'cosyvoice-env',
    '--no-capture-output',
    'python',
    '/workspace/backend/inference/cosyvoice_adapter.py',
    '--text', 'Cross lingual',
    '--ref-audio', '/tmp/ref.wav',
    '--output', '/tmp/cosyvoice.wav',
    '--model-path', '/models/cosyvoice',
    '--repo-path', '/repos/cosyvoice',
  ]);
});

test('command builder uses supported F5 CLI with explicit output stem', () => {
  const runtimeConfig = createRuntimeConfig();
  const command = buildVoiceEngineCommand({
    engine: 'f5',
    text: 'Built in ASR',
    language: 'en',
    refWav: '/tmp/ref.wav',
    outWav: '/workspace/backend/outputs/f5-job.wav',
    jobId: 'job-5',
    runtimeConfig,
  });

  assert.equal(command.cwd, '/repos/f5-tts');
  assert.equal(command.env.PYTHONPATH, '/repos/f5-tts');
  assert.deepEqual(command.args, [
    'run',
    '-n', 'f5-env',
    '--no-capture-output',
    'f5-tts_infer-cli',
    '--model', 'F5TTS_v1_Base',
    '--ref_audio', '/tmp/ref.wav',
    '--ref_text', '',
    '--gen_text', 'Built in ASR',
    '--output_dir', '/workspace/backend/outputs',
    '--output_file', 'f5-job.wav',
  ]);
});

test('command builder uses python adapter argv for openvoice with language mapping', () => {
  const runtimeConfig = createRuntimeConfig();
  const command = buildVoiceEngineCommand({
    engine: 'openvoice-v2',
    text: 'Bonjour tout le monde',
    language: 'fr-FR',
    refWav: '/tmp/ref.wav',
    outWav: '/tmp/openvoice.wav',
    jobId: 'job-6',
    runtimeConfig,
  });

  assert.equal(command.cwd, '/repos/openvoice');
  assert.equal(command.env.PYTHONPATH, '/repos/openvoice');
  assert.deepEqual(command.args, [
    'run',
    '-n', 'openvoice-env',
    '--no-capture-output',
    'python',
    '/workspace/backend/inference/openvoice_adapter.py',
    '--text', 'Bonjour tout le monde',
    '--language', 'fr',
    '--ref-audio', '/tmp/ref.wav',
    '--output', '/tmp/openvoice.wav',
    '--device', 'auto',
    '--checkpoints-path', '/models/openvoice',
    '--converter-config', '/models/openvoice/converter/config.json',
    '--converter-checkpoint', '/models/openvoice/converter/checkpoint.pth',
    '--melo-language', 'FR',
    '--speaker-id', 'FR',
    '--source-se-path', '/models/openvoice/base_speakers/ses/fr.pth',
    '--repo-path', '/repos/openvoice',
  ]);
});

test('openvoice defaults an omitted language to English and rejects unsupported languages', () => {
  const runtimeConfig = createRuntimeConfig();
  const defaulted = buildVoiceEngineCommand({
    engine: 'openvoice',
    text: 'Hello',
    refWav: '/tmp/ref.wav',
    outWav: '/tmp/openvoice.wav',
    jobId: 'job-7',
    runtimeConfig,
  });

  assert.equal(defaulted.args[defaulted.args.indexOf('--language') + 1], 'en');
  assert.throws(
    () => buildVoiceEngineCommand({
      engine: 'openvoice',
      text: 'Hallo',
      language: 'de-DE',
      refWav: '/tmp/ref.wav',
      outWav: '/tmp/openvoice.wav',
      jobId: 'job-8',
      runtimeConfig,
    }),
    /only supports mapped languages en, fr, es/,
  );
});
