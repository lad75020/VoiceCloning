import test from 'node:test';
import assert from 'node:assert/strict';

import {
  COSYVOICE_TONE_TAGS,
  OPENVOICE_STYLE_KEYS,
  OPENVOICE_V1_STYLE_SPEAKER_IDS,
  VOICE_CLONING_ENGINE_IDS,
  buildVoiceEngineCommand,
  createVoiceEngineRuntimeConfig,
  getEngineConfigurationIssues,
  hasActiveOpenVoiceStyles,
  listVoiceCloningEngines,
  normalizeGenerationEngine,
  normalizeLanguageCode,
  normalizeOpenVoiceStyles,
  normalizeVoicePrompt,
  validateOpenVoiceStyleRequest,
} from '../lib/voice-engines.js';

function createRuntimeConfig() {
  return createVoiceEngineRuntimeConfig({
    env: {
      CONDA_BASE: '/opt/miniconda3',
      CONDA_ENV: 'omnivoice-default',
      OMNIVOICE_CONDA_ENV: 'omnivoice-env',
      OMNIVOICE_MODEL: 'k2-fsa/OmniVoice',
      QWEN3_TTS_CONDA_ENV: 'qwen-env',
      QWEN3_TTS_MODEL: 'Qwen/Qwen3-TTS-12Hz-1.7B-Base',
      QWEN3_TTS_DEVICE_MAP: 'mps',
      QWEN3_TTS_DTYPE: 'float16',
      QWEN3_TTS_ATTN_IMPLEMENTATION: 'sdpa',
      QWEN3_TTS_WHISPER_MCP_URL: 'https://whisper.example/mcp',
      QWEN3_TTS_WHISPER_TIMEOUT_SECONDS: '90',
      QWEN3_TTS_MAX_NEW_TOKENS: '96',
      QWEN3_TTS_MAX_CHARS_PER_CHUNK: '100',
      QWEN3_TTS_MPS_HIGH_WATERMARK_RATIO: '0.65',
      QWEN3_TTS_MPS_LOW_WATERMARK_RATIO: '0.55',
      CHATTERBOX_CONDA_ENV: 'chatterbox-env',
      CHATTERBOX_REPO_PATH: '/repos/chatterbox',
      CHATTERBOX_MODEL: '/models/chatterbox',
      CHATTERBOX_DEVICE: 'auto',
      CHATTERBOX_T3_MODEL: 'v3',
      CHATTERBOX_MAX_NEW_TOKENS: '192',
      CHATTERBOX_MAX_CHARS_PER_CHUNK: '90',
      COSYVOICE_CONDA_ENV: 'cosyvoice-env',
      COSYVOICE_REPO_PATH: '/repos/cosyvoice',
      COSYVOICE_MODEL_PATH: '/models/cosyvoice',

      F5_TTS_CONDA_ENV: 'f5-env',
      F5_TTS_REPO_PATH: '/repos/f5-tts',
      F5_TTS_MODEL: 'F5TTS_v1_Base',
      OPENVOICE_CONDA_ENV: 'openvoice-env',
      OPENVOICE_REPO_PATH: '/repos/openvoice',
      OPENVOICE_CHECKPOINTS_PATH: '/models/openvoice',
      OPENVOICE_V1_CHECKPOINTS_PATH: '/models/openvoice-v1',
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

test('CosyVoice defaults to Fun-CosyVoice 3 without COSYVOICE_MODEL_PATH', () => {
  const runtimeConfig = createVoiceEngineRuntimeConfig({
    env: { CONDA_BASE: '/opt/miniconda3', COSYVOICE_CONDA_ENV: 'cosyvoice-env' },
    backendDir: '/workspace/backend',
    outputsDir: '/workspace/backend/outputs',
    uploadsDir: '/workspace/backend/uploads',
  });

  assert.equal(runtimeConfig.engines.cosyvoice.model, 'FunAudioLLM/Fun-CosyVoice3-0.5B-2512');
  assert.deepEqual(getEngineConfigurationIssues('cosyvoice', runtimeConfig), []);
  assert.ok(COSYVOICE_TONE_TAGS.includes('calm'));
  assert.ok(COSYVOICE_TONE_TAGS.includes('witch'));
});

test('configuration checks isolate OpenVoice V1 and V2 requirements', () => {
  const runtimeConfig = createVoiceEngineRuntimeConfig({
    env: {
      CONDA_BASE: '/opt/miniconda3',
      OPENVOICE_CONDA_ENV: 'openvoice-env',
    },
    backendDir: '/workspace/backend',
    outputsDir: '/workspace/backend/outputs',
    uploadsDir: '/workspace/backend/uploads',
  });

  const styledIssues = getEngineConfigurationIssues(
    'openvoice',
    runtimeConfig,
    'en',
    { friendly: 0.5 },
  );
  assert.equal(styledIssues.length, 5);
  assert.ok(styledIssues.every((issue) => issue.includes('OPENVOICE_V1_')));

  const neutralIssues = getEngineConfigurationIssues('openvoice', runtimeConfig, 'fr');
  assert.deepEqual(neutralIssues.slice(0, 3), [
    'Set OPENVOICE_CHECKPOINTS_PATH to the OpenVoice V2 checkpoints directory.',
    'Set OPENVOICE_CONVERTER_CONFIG_PATH or OPENVOICE_CHECKPOINTS_PATH.',
    'Set OPENVOICE_CONVERTER_CHECKPOINT_PATH or OPENVOICE_CHECKPOINTS_PATH.',
  ]);
  assert.equal(neutralIssues.length, 4);
  assert.ok(neutralIssues.some((issue) => issue.includes('OPENVOICE_SOURCE_SE_FR_PATH')));
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

test('command builder forwards OmniVoice voice descriptions through --instruct', () => {
  const runtimeConfig = createRuntimeConfig();
  const command = buildVoiceEngineCommand({
    engine: 'omnivoice',
    text: 'This is a test for text to speech.',
    language: 'en',
    refWav: '/tmp/ref.wav',
    outWav: '/tmp/out.wav',
    jobId: 'job-1-instruct',
    voicePrompt: '  male, British accent  ',
    runtimeConfig,
  });

  assert.equal(command.args[command.args.indexOf('--instruct') + 1], 'male, british accent');
});

test('command builder creates the Qwen3 Apple Metal/MPS adapter argv contract without voice_prompt', () => {
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
    '-n', 'qwen-env',
    '--no-capture-output',
    'python',
    '/workspace/backend/inference/qwen3_tts_adapter.py',
    '--text', 'Bonjour',
    '--language', 'fr',
    '--ref-audio', '/tmp/ref.wav',
    '--output', '/workspace/backend/outputs/job-2.wav',
    '--model', 'Qwen/Qwen3-TTS-12Hz-1.7B-Base',
    '--device-map', 'mps',
    '--dtype', 'float16',
    '--attn-implementation', 'sdpa',
    '--whisper-mcp-url', 'https://whisper.example/mcp',
    '--whisper-timeout-seconds', '90',
    '--max-new-tokens', '96',
    '--max-chars-per-chunk', '100',
  ]);
  assert.equal(command.env.PYTORCH_MPS_HIGH_WATERMARK_RATIO, '0.65');
  assert.equal(command.env.PYTORCH_MPS_LOW_WATERMARK_RATIO, '0.55');
  assert.equal(command.args.includes('--instruct'), false);
  assert.equal(command.args.includes('--voice_prompt'), false);
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
    '--max-new-tokens', '192',
    '--max-chars-per-chunk', '90',
    '--repo-path', '/repos/chatterbox',
  ]);
});

test('Chatterbox falls back to conservative bounded defaults for unsafe overrides', () => {
  const runtimeConfig = createVoiceEngineRuntimeConfig({
    env: {
      CHATTERBOX_MAX_NEW_TOKENS: '0',
      CHATTERBOX_MAX_CHARS_PER_CHUNK: '5000',
    },
    backendDir: '/workspace/backend',
    outputsDir: '/workspace/backend/outputs',
    uploadsDir: '/workspace/backend/uploads',
  });

  const chatterbox = runtimeConfig.engines.chatterbox;
  assert.equal(chatterbox.maxNewTokens, '256');
  assert.equal(chatterbox.maxCharsPerChunk, '120');
});

test('command builder rejects a Qwen voice_prompt rather than forwarding it', () => {
  const runtimeConfig = createRuntimeConfig();
  assert.throws(
    () => buildVoiceEngineCommand({
      engine: 'mlx-qwen',
      text: 'Evening news',
      language: 'en',
      refWav: '/tmp/ref.wav',
      outWav: '/workspace/backend/outputs/qwen-tone.wav',
      jobId: 'qwen-tone',
      voicePrompt: 'A composed announcer with a deep, steady voice.',
      runtimeConfig,
    }),
    /voice_prompt is supported only when engine is omnivoice or cosyvoice/,
  );
});

test('Qwen uses its dedicated environment by default and preserves Qwen-specific Conda overrides', () => {
  const runtimeConfig = createVoiceEngineRuntimeConfig({
    env: {
      CONDA_BASE: '/opt/miniconda3',
      CONDA_ENV: 'omnivoice',
      MLX_CONDA_ENV: 'unrelated-mlx-env',
      MLX_QWEN_MODEL: 'mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-bf16',
    },
    backendDir: '/workspace/backend',
    outputsDir: '/workspace/backend/outputs',
    uploadsDir: '/workspace/backend/uploads',
  });

  assert.equal(
    runtimeConfig.engines['mlx-qwen'].model,
    'Qwen/Qwen3-TTS-12Hz-1.7B-Base',
  );
  assert.equal(runtimeConfig.engines['mlx-qwen'].condaEnv, 'qwen3-tts');
  assert.equal(runtimeConfig.engines['mlx-qwen'].deviceMap, 'mps');
  assert.equal(runtimeConfig.engines['mlx-qwen'].dtype, 'float16');
  assert.equal(runtimeConfig.engines['mlx-qwen'].attnImplementation, 'sdpa');
  assert.equal(runtimeConfig.engines['mlx-qwen'].whisperMcpUrl, 'https://whisper.dubertrand.fr/mcp');
  assert.equal(runtimeConfig.engines['mlx-qwen'].maxNewTokens, '128');
  assert.equal(runtimeConfig.engines['mlx-qwen'].maxCharsPerChunk, '120');
  assert.equal(runtimeConfig.engines['mlx-qwen'].mpsHighWatermarkRatio, '0.70');
  assert.equal(runtimeConfig.engines['mlx-qwen'].mpsLowWatermarkRatio, '0.60');

  for (const [name, value] of [
    ['QWEN3_TTS_CONDA_ENV', 'qwen3-override'],
    ['MLX_QWEN_CONDA_ENV', 'mlx-qwen-override'],
    ['QWEN_CONDA_ENV', 'qwen-override'],
  ]) {
    const overrideConfig = createVoiceEngineRuntimeConfig({
      env: { CONDA_ENV: 'omnivoice', [name]: value },
      backendDir: '/workspace/backend',
      outputsDir: '/workspace/backend/outputs',
      uploadsDir: '/workspace/backend/uploads',
    });
    assert.equal(overrideConfig.engines['mlx-qwen'].condaEnv, value);
  }
});

test('Qwen rejects unsafe memory overrides by falling back to bounded defaults', () => {
  const runtimeConfig = createVoiceEngineRuntimeConfig({
    env: {
      QWEN3_TTS_MAX_NEW_TOKENS: '8192',
      QWEN3_TTS_MAX_CHARS_PER_CHUNK: '5000',
      QWEN3_TTS_MPS_HIGH_WATERMARK_RATIO: '0',
      QWEN3_TTS_MPS_LOW_WATERMARK_RATIO: '2',
    },
    backendDir: '/workspace/backend',
    outputsDir: '/workspace/backend/outputs',
    uploadsDir: '/workspace/backend/uploads',
  });

  const qwen = runtimeConfig.engines['mlx-qwen'];
  assert.equal(qwen.maxNewTokens, '128');
  assert.equal(qwen.maxCharsPerChunk, '120');
  assert.equal(qwen.mpsHighWatermarkRatio, '0.70');
  assert.equal(qwen.mpsLowWatermarkRatio, '0.60');
});

test('voice_prompt validation supports only OmniVoice and strict CosyVoice tone tags', () => {
  assert.equal(normalizeVoicePrompt('  Male, British Accent  ', 'omnivoice'), 'male, british accent');
  assert.equal(normalizeVoicePrompt(undefined, 'mlx-qwen'), null);
  assert.equal(normalizeVoicePrompt(undefined, 'omnivoice'), null);
  assert.equal(normalizeVoicePrompt(' Calm, BRAVE, calm ', 'cosyvoice'), 'calm, brave');
  assert.throws(
    () => normalizeVoicePrompt('enthousiaste et calme. assez rapide', 'omnivoice'),
    /unsupported OmniVoice instruct item.*enthousiaste et calme\. assez rapide/i,
  );
  assert.throws(
    () => normalizeVoicePrompt('Warm, reassuring, and measured.', 'mlx-qwen'),
    /voice_prompt is supported only when engine is omnivoice or cosyvoice/,
  );
  assert.throws(
    () => normalizeVoicePrompt(undefined, 'cosyvoice'),
    /voice_prompt is required when engine is cosyvoice/,
  );
  assert.throws(
    () => normalizeVoicePrompt('calm, arbitrary prose', 'cosyvoice'),
    /Unsupported CosyVoice tone tag\(s\): arbitrary prose/,
  );
  assert.throws(
    () => normalizeVoicePrompt('Warm', 'openvoice'),
    /voice_prompt is supported only when engine is omnivoice or cosyvoice/,
  );
  assert.throws(
    () => normalizeVoicePrompt(42, 'mlx-qwen'),
    /voice_prompt must be a string/,
  );
  assert.throws(
    () => normalizeVoicePrompt('x'.repeat(1001), 'mlx-qwen'),
    /voice_prompt is supported only when engine is omnivoice or cosyvoice/,
  );
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
    voicePrompt: ' CALM, Heroic ',
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
    '--model', '/models/cosyvoice',
    '--tone-tags', 'calm, heroic',
    '--repo-path', '/repos/cosyvoice',
  ]);
});

test('command builder forwards the default Fun-CosyVoice model and canonical tone tags', () => {
  const runtimeConfig = createVoiceEngineRuntimeConfig({
    env: { CONDA_BASE: '/opt/miniconda3', COSYVOICE_CONDA_ENV: 'cosyvoice-env' },
    backendDir: '/workspace/backend',
    outputsDir: '/workspace/backend/outputs',
    uploadsDir: '/workspace/backend/uploads',
  });
  const command = buildVoiceEngineCommand({
    engine: 'cosyvoice',
    text: 'A precise test.',
    language: 'en',
    refWav: '/tmp/ref.wav',
    outWav: '/tmp/cosyvoice.wav',
    jobId: 'job-4-default',
    voicePrompt: ' Wise, SOFT ',
    runtimeConfig,
  });

  assert.equal(command.args[command.args.indexOf('--model') + 1], 'FunAudioLLM/Fun-CosyVoice3-0.5B-2512');
  assert.equal(command.args[command.args.indexOf('--tone-tags') + 1], 'wise, soft');
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

test('OpenVoice style controls have canonical names and V1 speaker mappings', () => {
  assert.deepEqual(OPENVOICE_STYLE_KEYS, ['happy', 'sad', 'terrified', 'cheerful', 'friendly']);
  assert.deepEqual(OPENVOICE_V1_STYLE_SPEAKER_IDS, {
    happy: 4,
    sad: 8,
    terrified: 6,
    cheerful: 5,
    friendly: 9,
  });
});

test('OpenVoice style validation expands omitted keys and rejects unsafe values', () => {
  assert.deepEqual(normalizeOpenVoiceStyles({ happy: 0.4, friendly: 1 }), {
    happy: 0.4,
    sad: 0,
    terrified: 0,
    cheerful: 0,
    friendly: 1,
  });
  assert.equal(hasActiveOpenVoiceStyles(normalizeOpenVoiceStyles({ happy: 0 })), false);
  assert.throws(() => normalizeOpenVoiceStyles({ excited: 1 }), /unsupported key/);
  assert.throws(() => normalizeOpenVoiceStyles({ happy: Infinity }), /finite number/);
  assert.throws(() => normalizeOpenVoiceStyles(Object.create({ happy: 1 })), /plain object/);
});

test('style request rules reject non-OpenVoice and non-English blends while allowing neutral V2', () => {
  assert.equal(
    validateOpenVoiceStyleRequest({ styles: null, engine: 'omnivoice', language: 'en' }),
    null,
  );
  assert.throws(
    () => validateOpenVoiceStyleRequest({ styles: { happy: 0 }, engine: 'omnivoice', language: 'en' }),
    /only when engine is openvoice/,
  );
  assert.throws(
    () => validateOpenVoiceStyleRequest({ styles: { happy: 0.2 }, engine: 'openvoice', language: 'fr' }),
    /only for English output/,
  );
  assert.deepEqual(
    validateOpenVoiceStyleRequest({ styles: { happy: 0 }, engine: 'openvoice', language: 'fr' }),
    { happy: 0, sad: 0, terrified: 0, cheerful: 0, friendly: 0 },
  );
});

test('OpenVoice style command uses V1 assets and preserves continuous amounts', () => {
  const runtimeConfig = createRuntimeConfig();
  const command = buildVoiceEngineCommand({
    engine: 'openvoice',
    text: 'This is a cheerful greeting.',
    language: 'en',
    refWav: '/tmp/ref.wav',
    outWav: '/tmp/styled-openvoice.wav',
    jobId: 'style-job',
    styles: { happy: 0.375, cheerful: 0.8 },
    runtimeConfig,
  });

  assert.deepEqual(command.args, [
    'run',
    '-n', 'openvoice-env',
    '--no-capture-output',
    'python',
    '/workspace/backend/inference/openvoice_adapter.py',
    '--text', 'This is a cheerful greeting.',
    '--language', 'en',
    '--ref-audio', '/tmp/ref.wav',
    '--output', '/tmp/styled-openvoice.wav',
    '--device', 'auto',
    '--styles', '{"happy":0.375,"sad":0,"terrified":0,"cheerful":0.8,"friendly":0}',
    '--v1-base-config', '/models/openvoice-v1/base_speakers/EN/config.json',
    '--v1-base-checkpoint', '/models/openvoice-v1/base_speakers/EN/checkpoint.pth',
    '--v1-style-se-path', '/models/openvoice-v1/base_speakers/EN/en_style_se.pth',
    '--v1-converter-config', '/models/openvoice-v1/converter/config.json',
    '--v1-converter-checkpoint', '/models/openvoice-v1/converter/checkpoint.pth',
    '--repo-path', '/repos/openvoice',
  ]);
  assert.equal(command.args.includes('--melo-language'), false);
});

test('omitted or all-zero OpenVoice styles keep the existing V2 command path', () => {
  const runtimeConfig = createRuntimeConfig();
  const baseRequest = {
    engine: 'openvoice',
    text: 'Neutral output',
    language: 'en',
    refWav: '/tmp/ref.wav',
    outWav: '/tmp/openvoice.wav',
    jobId: 'neutral-job',
    runtimeConfig,
  };
  const omitted = buildVoiceEngineCommand(baseRequest);
  const zero = buildVoiceEngineCommand({ ...baseRequest, styles: { happy: 0, sad: 0, terrified: 0, cheerful: 0, friendly: 0 } });
  assert.deepEqual(zero.args, omitted.args);
  assert.equal(omitted.args.includes('--styles'), false);
  assert.equal(omitted.args.includes('--melo-language'), true);
});

test('styled OpenVoice requires only V1 assets, not the neutral V2 checkpoint root', () => {
  const runtimeConfig = createVoiceEngineRuntimeConfig({
    env: {
      CONDA_BASE: '/opt/miniconda3',
      OPENVOICE_CONDA_ENV: 'openvoice-env',
      OPENVOICE_V1_CHECKPOINTS_PATH: '/models/openvoice-v1',
    },
    backendDir: '/workspace/backend',
    outputsDir: '/workspace/backend/outputs',
    uploadsDir: '/workspace/backend/uploads',
  });
  const command = buildVoiceEngineCommand({
    engine: 'openvoice',
    text: 'Styled',
    language: 'en',
    refWav: '/tmp/ref.wav',
    outWav: '/tmp/openvoice.wav',
    jobId: 'v1-only-job',
    styles: { friendly: 0.5 },
    runtimeConfig,
  });
  assert.equal(command.args.includes('--v1-base-config'), true);
});
