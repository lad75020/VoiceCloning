import path from 'path';

export const VOICE_CLONING_ENGINE_IDS = [
  'omnivoice',
  'mlx-qwen',
  'chatterbox',
  'cosyvoice',
  'f5-tts',
  'openvoice',
];

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
        model: cleanOptionalString(env.MLX_QWEN_MODEL) || 'mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16',
        sttModel: cleanOptionalString(env.MLX_QWEN_STT_MODEL) || 'mlx-community/whisper-large-v3-turbo-asr-fp16',
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
        repoPath: cleanOptionalString(env.OPENVOICE_REPO_PATH),
        checkpointsPath,
        device: cleanOptionalString(env.OPENVOICE_DEVICE) || 'auto',
        converterConfigPath: cleanOptionalString(env.OPENVOICE_CONVERTER_CONFIG_PATH)
          || deriveOpenVoicePath(checkpointsPath, 'converter', 'config.json'),
        converterCheckpointPath: cleanOptionalString(env.OPENVOICE_CONVERTER_CHECKPOINT_PATH)
          || deriveOpenVoicePath(checkpointsPath, 'converter', 'checkpoint.pth'),
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

export function getEngineConfigurationIssues(engine, runtimeConfig, language = null) {
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
    if (!cleanOptionalString(engineConfig.checkpointsPath)) {
      issues.push('Set OPENVOICE_CHECKPOINTS_PATH to the OpenVoice V2 checkpoints directory.');
    }
    if (!cleanOptionalString(engineConfig.converterConfigPath)) {
      issues.push('Set OPENVOICE_CONVERTER_CONFIG_PATH or OPENVOICE_CHECKPOINTS_PATH.');
    }
    if (!cleanOptionalString(engineConfig.converterCheckpointPath)) {
      issues.push('Set OPENVOICE_CONVERTER_CHECKPOINT_PATH or OPENVOICE_CHECKPOINTS_PATH.');
    }

    const normalizedLanguage = normalizeLanguageCode(language);
    const languagesToCheck = normalizedLanguage ? [normalizedLanguage] : Array.from(SUPPORTED_LANGUAGE_CODES);
    for (const code of languagesToCheck) {
      const mapping = engineConfig.languageMappings[code];
      if (!cleanOptionalString(mapping?.meloLanguage)) {
        issues.push(`Set OPENVOICE_MELO_LANGUAGE_${code.toUpperCase()}.`);
      }
      if (!cleanOptionalString(mapping?.speakerId)) {
        issues.push(`Set OPENVOICE_MELO_SPEAKER_${code.toUpperCase()}.`);
      }
      if (!cleanOptionalString(mapping?.sourceSePath)) {
        issues.push(`Set OPENVOICE_SOURCE_SE_${code.toUpperCase()}_PATH or adjust the speaker mapping.`);
      }
    }
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
  runtimeConfig,
}) {
  const selectedEngine = normalizeGenerationEngine(engine);
  const engineConfig = runtimeConfig.engines[selectedEngine];
  const normalizedLanguage = normalizeLanguageCode(language)
    || (language == null || String(language).trim() === '' ? 'en' : null);
  const configurationIssues = getEngineConfigurationIssues(selectedEngine, runtimeConfig, normalizedLanguage);

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
    return {
      ...base,
      cmd: runtimeConfig.condaBin,
      args: [
        'run',
        '-n', engineConfig.condaEnv,
        '--no-capture-output',
        'omnivoice-infer',
        '--model', engineConfig.model,
        '--text', text,
        '--ref_audio', refWav,
        '--output', outWav,
      ],
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
      '--ref_audio', refWav,
      '--stt_model', engineConfig.sttModel,
      '--output_path', path.dirname(outWav),
      '--file_prefix', jobId,
      '--audio_format', 'wav',
      '--join_audio',
    ];
    if (normalizedLanguage) {
      args.push('--lang_code', normalizedLanguage);
    }
    return {
      ...base,
      cmd: runtimeConfig.condaBin,
      args,
      failureHint: 'Verify MLX_QWEN_CONDA_ENV, MLX_QWEN_MODEL, MLX_QWEN_STT_MODEL, and mlx_audio installation.',
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
