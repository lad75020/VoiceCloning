import path from 'path';

export const VOICE_CLONING_ENGINE_IDS = [
  'omnivoice',
  'mlx-qwen',
  'chatterbox',
  'cosyvoice',
  'f5-tts',
  'openvoice',
];

/**
 * Public style controls accepted by the HTTP and MCP APIs. These names are
 * deliberately independent of the OpenVoice V1 checkpoint speaker names.
 */
export const OPENVOICE_STYLE_KEYS = Object.freeze([
  'happy',
  'sad',
  'terrified',
  'cheerful',
  'friendly',
]);

export const OPENVOICE_V1_STYLE_SPEAKER_IDS = Object.freeze({
  happy: 4, // OpenVoice V1 calls this speaker "excited".
  sad: 8,
  terrified: 6,
  cheerful: 5,
  friendly: 9,
});

export const OMNIVOICE_ENGLISH_INSTRUCT_ITEMS = Object.freeze([
  'american accent',
  'australian accent',
  'british accent',
  'canadian accent',
  'child',
  'chinese accent',
  'elderly',
  'female',
  'high pitch',
  'indian accent',
  'japanese accent',
  'korean accent',
  'low pitch',
  'male',
  'middle-aged',
  'moderate pitch',
  'portuguese accent',
  'russian accent',
  'teenager',
  'very high pitch',
  'very low pitch',
  'whisper',
  'young adult',
]);

const OMNIVOICE_CHINESE_INSTRUCT_ITEMS = Object.freeze([
  '东北话', '中年', '中音调', '云南话', '低音调', '儿童', '四川话', '女', '宁夏话',
  '少年', '极低音调', '极高音调', '桂林话', '河南话', '济南话', '甘肃话', '男',
  '石家庄话', '老年', '耳语', '贵州话', '陕西话', '青岛话', '青年', '高音调',
]);

const OMNIVOICE_ENGLISH_INSTRUCT_SET = new Set(OMNIVOICE_ENGLISH_INSTRUCT_ITEMS);
const OMNIVOICE_CHINESE_INSTRUCT_SET = new Set(OMNIVOICE_CHINESE_INSTRUCT_ITEMS);

export const VOICE_CLONING_ENGINES = Object.freeze({
  omnivoice: {
    id: 'omnivoice',
    label: 'OmniVoice',
    subtitle: 'k2-fsa · multilingual',
  },
  'mlx-qwen': {
    id: 'mlx-qwen',
    label: 'MLX/Qwen',
    subtitle: 'Apple Silicon · MLX',
  },
  chatterbox: {
    id: 'chatterbox',
    label: 'Chatterbox',
    subtitle: 'Multilingual prompt cloning',
  },
  cosyvoice: {
    id: 'cosyvoice',
    label: 'CosyVoice',
    subtitle: 'Cross-lingual zero-shot',
  },
  'f5-tts': {
    id: 'f5-tts',
    label: 'F5-TTS',
    subtitle: 'CLI with built-in ASR',
  },
  openvoice: {
    id: 'openvoice',
    label: 'OpenVoice V2',
    subtitle: 'MeloTTS + tone conversion',
  },
});

const ENGINE_ALIASES = new Map([
  ['omnivoice', 'omnivoice'],
  ['omni-voice', 'omnivoice'],
  ['omni_voice', 'omnivoice'],
  ['mlx-qwen', 'mlx-qwen'],
  ['mlx/qwen', 'mlx-qwen'],
  ['mlx_qwen', 'mlx-qwen'],
  ['mlxqwen', 'mlx-qwen'],
  ['qwen', 'mlx-qwen'],
  ['mlx', 'mlx-qwen'],
  ['chatterbox', 'chatterbox'],
  ['chatter-box', 'chatterbox'],
  ['chatter_box', 'chatterbox'],
  ['cosyvoice', 'cosyvoice'],
  ['cosy-voice', 'cosyvoice'],
  ['cosy_voice', 'cosyvoice'],
  ['cosy', 'cosyvoice'],
  ['f5-tts', 'f5-tts'],
  ['f5_tts', 'f5-tts'],
  ['f5tts', 'f5-tts'],
  ['f5', 'f5-tts'],
  ['openvoice', 'openvoice'],
  ['open-voice', 'openvoice'],
  ['open_voice', 'openvoice'],
  ['openvoice-v2', 'openvoice'],
  ['openvoice_v2', 'openvoice'],
]);

const SUPPORTED_LANGUAGE_CODES = new Set(['en', 'fr', 'es']);

const LANGUAGE_ALIASES = new Map([
  ['en', 'en'],
  ['en-us', 'en'],
  ['en-gb', 'en'],
  ['en-ca', 'en'],
  ['english', 'en'],
  ['fr', 'fr'],
  ['fr-fr', 'fr'],
  ['fr-ca', 'fr'],
  ['french', 'fr'],
  ['francais', 'fr'],
  ['français', 'fr'],
  ['es', 'es'],
  ['es-es', 'es'],
  ['es-mx', 'es'],
  ['es-419', 'es'],
  ['spanish', 'es'],
  ['espanol', 'es'],
  ['español', 'es'],
]);

function cleanOptionalString(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function withPythonPath(baseEnv, repoPath) {
  if (!repoPath) {
    return { ...baseEnv };
  }

  const env = { ...baseEnv };
  const existing = cleanOptionalString(env.PYTHONPATH);
  env.PYTHONPATH = [repoPath, existing].filter(Boolean).join(path.delimiter);
  return env;
}

function appendOptionalArg(args, flag, value) {
  if (cleanOptionalString(value)) {
    args.push(flag, value);
  }
}

function deriveOpenVoicePath(checkpointsPath, ...segments) {
  if (!checkpointsPath) {
    return null;
  }

  return path.join(checkpointsPath, ...segments);
}

function deriveOpenVoiceSourceSePath(checkpointsPath, speakerKey) {
  if (!checkpointsPath || !speakerKey) {
    return null;
  }

  const normalizedSpeakerKey = speakerKey.toLowerCase().replace(/_/g, '-');
  return deriveOpenVoicePath(checkpointsPath, 'base_speakers', 'ses', `${normalizedSpeakerKey}.pth`);
}

function deriveOpenVoiceV1CheckpointsPath(repoPath, v2CheckpointsPath) {
  if (repoPath) {
    return path.join(repoPath, 'checkpoints');
  }
  if (v2CheckpointsPath) {
    return path.join(path.dirname(v2CheckpointsPath), 'checkpoints');
  }
  return null;
}

function deriveOpenVoiceV1Path(checkpointsPath, ...segments) {
  return checkpointsPath ? path.join(checkpointsPath, ...segments) : null;
}

function getOpenVoiceLanguageConfig(engineConfig, language) {
  const mapping = engineConfig.languageMappings[language];
  if (!mapping) {
    throw new Error(
      `OpenVoice only supports mapped languages ${Array.from(SUPPORTED_LANGUAGE_CODES).join(', ')}. Received: ${language || 'unknown'}.`,
    );
  }

  return mapping;
}

export function normalizeGenerationEngine(engine) {
  const normalized = String(engine || 'omnivoice').trim().toLowerCase();
  const canonical = ENGINE_ALIASES.get(normalized);
  if (canonical) {
    return canonical;
  }

  throw new Error(`Unsupported voice cloning engine: ${engine}`);
}

function normalizeOmniVoiceInstruct(prompt) {
  const usesChinese = /[\u3400-\u9fff]/u.test(prompt);
  const delimiter = usesChinese ? '，' : ',';
  const allowedItems = usesChinese
    ? OMNIVOICE_CHINESE_INSTRUCT_SET
    : OMNIVOICE_ENGLISH_INSTRUCT_SET;
  const items = prompt
    .split(delimiter)
    .map((item) => (usesChinese ? item.trim() : item.trim().toLowerCase()))
    .filter(Boolean);
  const unsupported = items.filter((item) => !allowedItems.has(item));

  if (unsupported.length > 0) {
    const validItems = usesChinese
      ? OMNIVOICE_CHINESE_INSTRUCT_ITEMS.join('，')
      : OMNIVOICE_ENGLISH_INSTRUCT_ITEMS.join(', ');
    throw new Error(
      `Unsupported OmniVoice instruct item(s): ${unsupported.join(delimiter)}. Use only: ${validItems}.`,
    );
  }

  return items.join(delimiter === ',' ? ', ' : delimiter);
}

export function normalizeVoicePrompt(voicePrompt, engine) {
  const selectedEngine = normalizeGenerationEngine(engine);
  if (voicePrompt === undefined || voicePrompt === null) {
    if (selectedEngine === 'mlx-qwen') {
      throw new Error('voice_prompt is required when engine is mlx-qwen.');
    }
    return null;
  }
  if (typeof voicePrompt !== 'string') {
    throw new Error('voice_prompt must be a string.');
  }

  const normalized = voicePrompt.trim();
  if (!normalized) {
    if (selectedEngine === 'mlx-qwen') {
      throw new Error('voice_prompt is required when engine is mlx-qwen.');
    }
    return null;
  }
  if (normalized.length > 1000) {
    throw new Error('voice_prompt is too long (max 1000 chars).');
  }
  if (selectedEngine !== 'omnivoice' && selectedEngine !== 'mlx-qwen') {
    throw new Error('voice_prompt is supported only when engine is omnivoice or mlx-qwen.');
  }
  return selectedEngine === 'omnivoice'
    ? normalizeOmniVoiceInstruct(normalized)
    : normalized;
}

export function normalizeLanguageCode(language) {
  const raw = cleanOptionalString(language);
  if (!raw) {
    return null;
  }

  const lowered = raw.toLowerCase().replace(/_/g, '-');
  const aliased = LANGUAGE_ALIASES.get(lowered);
  if (aliased) {
    return aliased;
  }

  if (/^[a-z]{2,3}(-[a-z0-9]{2,8})?$/i.test(lowered)) {
    const base = lowered.split('-')[0];
    return SUPPORTED_LANGUAGE_CODES.has(base) ? base : null;
  }

  return null;
}

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && Object.getPrototypeOf(value) === Object.prototype;
}

/**
 * Validate and expand an optional OpenVoice style object to its canonical
 * five-key representation. A supplied value must be a normal JSON object:
 * accepting inherited keys or custom prototypes here would make validation
 * differ from the values eventually passed to the subprocess.
 */
export function normalizeOpenVoiceStyles(styles) {
  // JSON clients can represent an omitted optional field as null. Treat both
  // forms as absent, while retaining strict validation for supplied values.
  if (styles === undefined || styles === null) {
    return null;
  }
  if (!isPlainObject(styles)) {
    throw new Error('styles must be a plain object with only happy, sad, terrified, cheerful, and friendly keys.');
  }

  for (const key of Object.keys(styles)) {
    if (!OPENVOICE_STYLE_KEYS.includes(key)) {
      throw new Error(`styles contains unsupported key: ${key}.`);
    }
  }

  const normalized = {};
  for (const key of OPENVOICE_STYLE_KEYS) {
    const amount = styles[key] === undefined ? 0 : styles[key];
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || amount > 1) {
      throw new Error(`styles.${key} must be a finite number from 0 to 1.`);
    }
    normalized[key] = amount;
  }
  return Object.freeze(normalized);
}

export function hasActiveOpenVoiceStyles(styles) {
  return !!styles && OPENVOICE_STYLE_KEYS.some((key) => styles[key] > 0);
}

/**
 * Apply request-level style rules shared by HTTP, MCP, and command building.
 * Explicit all-zero styles are permitted for OpenVoice and retain V2 neutral
 * synthesis. Only a nonzero blend selects the English-only V1 path.
 */
export function validateOpenVoiceStyleRequest({ styles, engine, language }) {
  const normalizedStyles = normalizeOpenVoiceStyles(styles);
  if (normalizedStyles === null) {
    return null;
  }

  const selectedEngine = normalizeGenerationEngine(engine);
  if (selectedEngine !== 'openvoice') {
    throw new Error('styles are supported only when engine is openvoice.');
  }

  if (hasActiveOpenVoiceStyles(normalizedStyles) && language !== 'en') {
    throw new Error('Nonzero OpenVoice styles are supported only for English output. Use English or reset all styles to zero.');
  }

  return normalizedStyles;
}

export function createVoiceEngineRuntimeConfig({
  env = process.env,
  backendDir,
  outputsDir,
  uploadsDir,
  inferenceDir = path.join(backendDir, 'inference'),
} = {}) {
  const condaBase = cleanOptionalString(env.CONDA_BASE) || '/Volumes/WDBlack4TB/opt/miniconda3';
  const condaBin = path.join(condaBase, 'bin', 'conda');
  const defaultCondaEnv = cleanOptionalString(env.CONDA_ENV) || 'omnivoice';
  const checkpointsPath = cleanOptionalString(env.OPENVOICE_CHECKPOINTS_PATH);
  const openVoiceRepoPath = cleanOptionalString(env.OPENVOICE_REPO_PATH);
  const v1CheckpointsPath = cleanOptionalString(env.OPENVOICE_V1_CHECKPOINTS_PATH)
    || deriveOpenVoiceV1CheckpointsPath(openVoiceRepoPath, checkpointsPath);

  return {
    backendDir,
    outputsDir,
    uploadsDir,
    inferenceDir,
    condaBase,
    condaBin,
    baseEnv: { ...env },
    engines: {
      omnivoice: {
        condaEnv: cleanOptionalString(env.OMNIVOICE_CONDA_ENV) || defaultCondaEnv,
        model: cleanOptionalString(env.OMNIVOICE_MODEL) || 'k2-fsa/OmniVoice',
      },
      'mlx-qwen': {
        condaEnv: cleanOptionalString(env.MLX_QWEN_CONDA_ENV)
          || cleanOptionalString(env.MLX_CONDA_ENV)
          || cleanOptionalString(env.QWEN_CONDA_ENV)
          || defaultCondaEnv,
        model: cleanOptionalString(env.MLX_QWEN_MODEL) || 'mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-bf16',
      },
      chatterbox: {
        condaEnv: cleanOptionalString(env.CHATTERBOX_CONDA_ENV) || 'chatterbox',
        repoPath: cleanOptionalString(env.CHATTERBOX_REPO_PATH),
        model: cleanOptionalString(env.CHATTERBOX_MODEL) || 'ResembleAI/chatterbox',
        device: cleanOptionalString(env.CHATTERBOX_DEVICE) || 'auto',
        t3Model: cleanOptionalString(env.CHATTERBOX_T3_MODEL) || 'v3',
      },
      cosyvoice: {
        condaEnv: cleanOptionalString(env.COSYVOICE_CONDA_ENV) || 'cosyvoice',
        repoPath: cleanOptionalString(env.COSYVOICE_REPO_PATH),
        modelPath: cleanOptionalString(env.COSYVOICE_MODEL_PATH),
      },
      'f5-tts': {
        condaEnv: cleanOptionalString(env.F5_TTS_CONDA_ENV) || 'f5-tts',
        repoPath: cleanOptionalString(env.F5_TTS_REPO_PATH),
        model: cleanOptionalString(env.F5_TTS_MODEL) || 'F5TTS_v1_Base',
      },
      openvoice: {
        condaEnv: cleanOptionalString(env.OPENVOICE_CONDA_ENV) || 'openvoice',
        repoPath: openVoiceRepoPath,
        checkpointsPath,
        v1CheckpointsPath,
        device: cleanOptionalString(env.OPENVOICE_DEVICE) || 'auto',
        converterConfigPath: cleanOptionalString(env.OPENVOICE_CONVERTER_CONFIG_PATH)
          || deriveOpenVoicePath(checkpointsPath, 'converter', 'config.json'),
        converterCheckpointPath: cleanOptionalString(env.OPENVOICE_CONVERTER_CHECKPOINT_PATH)
          || deriveOpenVoicePath(checkpointsPath, 'converter', 'checkpoint.pth'),
        v1BaseConfigPath: cleanOptionalString(env.OPENVOICE_V1_BASE_CONFIG_PATH)
          || deriveOpenVoiceV1Path(v1CheckpointsPath, 'base_speakers', 'EN', 'config.json'),
        v1BaseCheckpointPath: cleanOptionalString(env.OPENVOICE_V1_BASE_CHECKPOINT_PATH)
          || deriveOpenVoiceV1Path(v1CheckpointsPath, 'base_speakers', 'EN', 'checkpoint.pth'),
        v1StyleSePath: cleanOptionalString(env.OPENVOICE_V1_STYLE_SE_PATH)
          || deriveOpenVoiceV1Path(v1CheckpointsPath, 'base_speakers', 'EN', 'en_style_se.pth'),
        v1ConverterConfigPath: cleanOptionalString(env.OPENVOICE_V1_CONVERTER_CONFIG_PATH)
          || deriveOpenVoiceV1Path(v1CheckpointsPath, 'converter', 'config.json'),
        v1ConverterCheckpointPath: cleanOptionalString(env.OPENVOICE_V1_CONVERTER_CHECKPOINT_PATH)
          || deriveOpenVoiceV1Path(v1CheckpointsPath, 'converter', 'checkpoint.pth'),
        languageMappings: {
          en: {
            meloLanguage: cleanOptionalString(env.OPENVOICE_MELO_LANGUAGE_EN) || 'EN_NEWEST',
            speakerId: cleanOptionalString(env.OPENVOICE_MELO_SPEAKER_EN) || 'EN-Newest',
            sourceSePath: cleanOptionalString(env.OPENVOICE_SOURCE_SE_EN_PATH)
              || deriveOpenVoiceSourceSePath(checkpointsPath, cleanOptionalString(env.OPENVOICE_MELO_SPEAKER_EN) || 'en-newest'),
          },
          fr: {
            meloLanguage: cleanOptionalString(env.OPENVOICE_MELO_LANGUAGE_FR) || 'FR',
            speakerId: cleanOptionalString(env.OPENVOICE_MELO_SPEAKER_FR) || 'FR',
            sourceSePath: cleanOptionalString(env.OPENVOICE_SOURCE_SE_FR_PATH)
              || deriveOpenVoiceSourceSePath(checkpointsPath, cleanOptionalString(env.OPENVOICE_MELO_SPEAKER_FR) || 'FR'),
          },
          es: {
            meloLanguage: cleanOptionalString(env.OPENVOICE_MELO_LANGUAGE_ES) || 'ES',
            speakerId: cleanOptionalString(env.OPENVOICE_MELO_SPEAKER_ES) || 'ES',
            sourceSePath: cleanOptionalString(env.OPENVOICE_SOURCE_SE_ES_PATH)
              || deriveOpenVoiceSourceSePath(checkpointsPath, cleanOptionalString(env.OPENVOICE_MELO_SPEAKER_ES) || 'ES'),
          },
        },
      },
    },
  };
}

function collectOpenVoiceV1ConfigurationIssues(engineConfig) {
  const requiredPaths = [
    ['v1BaseConfigPath', 'Set OPENVOICE_V1_BASE_CONFIG_PATH or OPENVOICE_V1_CHECKPOINTS_PATH.'],
    ['v1BaseCheckpointPath', 'Set OPENVOICE_V1_BASE_CHECKPOINT_PATH or OPENVOICE_V1_CHECKPOINTS_PATH.'],
    ['v1StyleSePath', 'Set OPENVOICE_V1_STYLE_SE_PATH or OPENVOICE_V1_CHECKPOINTS_PATH to en_style_se.pth.'],
    ['v1ConverterConfigPath', 'Set OPENVOICE_V1_CONVERTER_CONFIG_PATH or OPENVOICE_V1_CHECKPOINTS_PATH.'],
    ['v1ConverterCheckpointPath', 'Set OPENVOICE_V1_CONVERTER_CHECKPOINT_PATH or OPENVOICE_V1_CHECKPOINTS_PATH.'],
  ];

  return requiredPaths
    .filter(([configKey]) => !cleanOptionalString(engineConfig[configKey]))
    .map(([, message]) => message);
}

function collectOpenVoiceV2ConfigurationIssues(engineConfig, language) {
  const issues = [];
  const requiredPaths = [
    ['checkpointsPath', 'Set OPENVOICE_CHECKPOINTS_PATH to the OpenVoice V2 checkpoints directory.'],
    ['converterConfigPath', 'Set OPENVOICE_CONVERTER_CONFIG_PATH or OPENVOICE_CHECKPOINTS_PATH.'],
    ['converterCheckpointPath', 'Set OPENVOICE_CONVERTER_CHECKPOINT_PATH or OPENVOICE_CHECKPOINTS_PATH.'],
  ];

  issues.push(
    ...requiredPaths
      .filter(([configKey]) => !cleanOptionalString(engineConfig[configKey]))
      .map(([, message]) => message),
  );

  const normalizedLanguage = normalizeLanguageCode(language);
  const languagesToCheck = normalizedLanguage ? [normalizedLanguage] : Array.from(SUPPORTED_LANGUAGE_CODES);
  for (const code of languagesToCheck) {
    const mapping = engineConfig.languageMappings[code];
    const uppercaseCode = code.toUpperCase();
    if (!cleanOptionalString(mapping?.meloLanguage)) {
      issues.push(`Set OPENVOICE_MELO_LANGUAGE_${uppercaseCode}.`);
    }
    if (!cleanOptionalString(mapping?.speakerId)) {
      issues.push(`Set OPENVOICE_MELO_SPEAKER_${uppercaseCode}.`);
    }
    if (!cleanOptionalString(mapping?.sourceSePath)) {
      issues.push(`Set OPENVOICE_SOURCE_SE_${uppercaseCode}_PATH or adjust the speaker mapping.`);
    }
  }

  return issues;
}

export function getEngineConfigurationIssues(engine, runtimeConfig, language = null, styles = null) {
  const selectedEngine = normalizeGenerationEngine(engine);
  const issues = [];
  const engineConfig = runtimeConfig.engines[selectedEngine];

  if (!cleanOptionalString(engineConfig.condaEnv)) {
    issues.push('Set the engine Conda environment name.');
  }

  if (selectedEngine === 'cosyvoice' && !cleanOptionalString(engineConfig.modelPath)) {
    issues.push('Set COSYVOICE_MODEL_PATH to the prepared CosyVoice model directory.');
  }

  if (selectedEngine === 'openvoice') {
    issues.push(
      ...(hasActiveOpenVoiceStyles(styles)
        ? collectOpenVoiceV1ConfigurationIssues(engineConfig)
        : collectOpenVoiceV2ConfigurationIssues(engineConfig, language)),
    );
  }

  return issues;
}

export function listVoiceCloningEngines(runtimeConfig) {
  return VOICE_CLONING_ENGINE_IDS.map((engineId) => ({
    ...VOICE_CLONING_ENGINES[engineId],
    configured: getEngineConfigurationIssues(engineId, runtimeConfig).length === 0,
  }));
}

export function buildVoiceEngineCommand({
  engine,
  text,
  language,
  refWav,
  outWav,
  jobId,
  styles,
  voicePrompt,
  runtimeConfig,
}) {
  const selectedEngine = normalizeGenerationEngine(engine);
  const normalizedVoicePrompt = normalizeVoicePrompt(voicePrompt, selectedEngine);
  const engineConfig = runtimeConfig.engines[selectedEngine];
  const normalizedLanguage = normalizeLanguageCode(language)
    || (language == null || String(language).trim() === '' ? 'en' : null);
  const normalizedStyles = validateOpenVoiceStyleRequest({
    styles,
    engine: selectedEngine,
    language: normalizedLanguage,
  });
  const configurationIssues = getEngineConfigurationIssues(
    selectedEngine,
    runtimeConfig,
    normalizedLanguage,
    normalizedStyles,
  );

  if (configurationIssues.length > 0) {
    throw new Error(`${VOICE_CLONING_ENGINES[selectedEngine].label} is not configured. ${configurationIssues.join(' ')}`);
  }

  const base = {
    engine: selectedEngine,
    expectedOutputPath: outWav,
    outputDir: path.dirname(outWav),
    env: { ...runtimeConfig.baseEnv },
    cwd: engineConfig.repoPath || runtimeConfig.backendDir,
  };

  if (selectedEngine === 'omnivoice') {
    const args = [
      'run',
      '-n', engineConfig.condaEnv,
      '--no-capture-output',
      'omnivoice-infer',
      '--model', engineConfig.model,
      '--text', text,
      '--ref_audio', refWav,
      '--output', outWav,
    ];
    if (normalizedVoicePrompt) {
      args.push('--instruct', normalizedVoicePrompt);
    }
    return {
      ...base,
      cmd: runtimeConfig.condaBin,
      args,
      failureHint: 'Verify OMNIVOICE_CONDA_ENV, OMNIVOICE_MODEL, and omnivoice-infer availability.',
    };
  }

  if (selectedEngine === 'mlx-qwen') {
    const args = [
      'run',
      '-n', engineConfig.condaEnv,
      '--no-capture-output',
      'python',
      '-m', 'mlx_audio.tts.generate',
      '--model', engineConfig.model,
      '--text', text,
    ];
    args.push(
      '--output_path', path.dirname(outWav),
      '--file_prefix', jobId,
      '--audio_format', 'wav',
      '--join_audio',
    );
    if (normalizedLanguage) {
      args.push('--lang_code', normalizedLanguage);
    }
    args.push('--instruct', normalizedVoicePrompt);
    return {
      ...base,
      cmd: runtimeConfig.condaBin,
      args,
      failureHint: 'Verify MLX_QWEN_CONDA_ENV, MLX_QWEN_MODEL, and mlx_audio installation.',
    };
  }

  if (selectedEngine === 'chatterbox') {
    const args = [
      'run',
      '-n', engineConfig.condaEnv,
      '--no-capture-output',
      'python',
      path.join(runtimeConfig.inferenceDir, 'chatterbox_adapter.py'),
      '--text', text,
      '--language', normalizedLanguage || 'en',
      '--ref-audio', refWav,
      '--output', outWav,
      '--model', engineConfig.model,
      '--device', engineConfig.device,
      '--t3-model', engineConfig.t3Model,
    ];
    appendOptionalArg(args, '--repo-path', engineConfig.repoPath);
    return {
      ...base,
      cmd: runtimeConfig.condaBin,
      args,
      env: withPythonPath(runtimeConfig.baseEnv, engineConfig.repoPath),
      failureHint: 'Verify CHATTERBOX_CONDA_ENV, CHATTERBOX_MODEL, and CHATTERBOX_REPO_PATH or package installation.',
    };
  }

  if (selectedEngine === 'cosyvoice') {
    const args = [
      'run',
      '-n', engineConfig.condaEnv,
      '--no-capture-output',
      'python',
      path.join(runtimeConfig.inferenceDir, 'cosyvoice_adapter.py'),
      '--text', text,
      '--ref-audio', refWav,
      '--output', outWav,
      '--model-path', engineConfig.modelPath,
    ];
    appendOptionalArg(args, '--repo-path', engineConfig.repoPath);
    return {
      ...base,
      cmd: runtimeConfig.condaBin,
      args,
      env: withPythonPath(runtimeConfig.baseEnv, engineConfig.repoPath),
      failureHint: 'Verify COSYVOICE_CONDA_ENV, COSYVOICE_MODEL_PATH, and COSYVOICE_REPO_PATH or package installation.',
    };
  }

  if (selectedEngine === 'f5-tts') {
    return {
      ...base,
      cmd: runtimeConfig.condaBin,
      args: [
        'run',
        '-n', engineConfig.condaEnv,
        '--no-capture-output',
        'f5-tts_infer-cli',
        '--model', engineConfig.model,
        '--ref_audio', refWav,
        '--ref_text', '',
        '--gen_text', text,
        '--output_dir', path.dirname(outWav),
        '--output_file', path.basename(outWav),
      ],
      env: withPythonPath(runtimeConfig.baseEnv, engineConfig.repoPath),
      failureHint: 'Verify F5_TTS_CONDA_ENV, F5_TTS_MODEL, and the f5-tts_infer-cli command in that environment.',
    };
  }

  const styledOpenVoice = hasActiveOpenVoiceStyles(normalizedStyles);
  if (styledOpenVoice) {
    const args = [
      'run',
      '-n', engineConfig.condaEnv,
      '--no-capture-output',
      'python',
      path.join(runtimeConfig.inferenceDir, 'openvoice_adapter.py'),
      '--text', text,
      '--language', normalizedLanguage,
      '--ref-audio', refWav,
      '--output', outWav,
      '--device', engineConfig.device,
      '--styles', JSON.stringify(normalizedStyles),
      '--v1-base-config', engineConfig.v1BaseConfigPath,
      '--v1-base-checkpoint', engineConfig.v1BaseCheckpointPath,
      '--v1-style-se-path', engineConfig.v1StyleSePath,
      '--v1-converter-config', engineConfig.v1ConverterConfigPath,
      '--v1-converter-checkpoint', engineConfig.v1ConverterCheckpointPath,
    ];
    appendOptionalArg(args, '--repo-path', engineConfig.repoPath);
    return {
      ...base,
      cmd: runtimeConfig.condaBin,
      args,
      env: withPythonPath(runtimeConfig.baseEnv, engineConfig.repoPath),
      failureHint: 'Verify OPENVOICE_V1_CHECKPOINTS_PATH contains the V1 English base speaker, en_style_se, and converter assets.',
    };
  }

  const openVoiceLanguageConfig = getOpenVoiceLanguageConfig(engineConfig, normalizedLanguage);
  const args = [
    'run',
    '-n', engineConfig.condaEnv,
    '--no-capture-output',
    'python',
    path.join(runtimeConfig.inferenceDir, 'openvoice_adapter.py'),
    '--text', text,
    '--language', normalizedLanguage,
    '--ref-audio', refWav,
    '--output', outWav,
    '--device', engineConfig.device,
    '--checkpoints-path', engineConfig.checkpointsPath,
    '--converter-config', engineConfig.converterConfigPath,
    '--converter-checkpoint', engineConfig.converterCheckpointPath,
    '--melo-language', openVoiceLanguageConfig.meloLanguage,
    '--speaker-id', openVoiceLanguageConfig.speakerId,
    '--source-se-path', openVoiceLanguageConfig.sourceSePath,
  ];
  appendOptionalArg(args, '--repo-path', engineConfig.repoPath);
  return {
    ...base,
    cmd: runtimeConfig.condaBin,
    args,
    env: withPythonPath(runtimeConfig.baseEnv, engineConfig.repoPath),
    failureHint: 'Verify OPENVOICE_CONDA_ENV, OPENVOICE_CHECKPOINTS_PATH, MeloTTS/OpenVoice installation, and language-specific speaker mappings.',
  };
}
