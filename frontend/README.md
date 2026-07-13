# VoiceCloning Frontend

Angular 20 browser client for the VoiceCloning backend.

## Features

- Login/logout against the Fastify auth API.
- Browser microphone recording and preview.
- Local saved voice library in browser storage.
- Six selectable engines:
  - `omnivoice`
  - `mlx-qwen`
  - `chatterbox`
  - `cosyvoice`
  - `f5-tts`
  - `openvoice`
- Generation start/cancel flow backed by the existing backend queue.

## Commands

```bash
npm install
npm start
npm run build
npm test
```

`npm start` serves the app on Angular's dev server and proxies `/api` to `http://localhost:17992` through `proxy.conf.json`.

## UI notes

- Selecting Qwen3 TTS happens immediately and, like every engine, requires a recorded reference voice. Selecting OmniVoice opens a supported-attribute picker; selecting Fun-CosyVoice 3 opens a required multi-select tone-tag picker; selecting OpenVoice opens its style controls.
- Generation sends `jobId`, `voiceId`, `text`, `language`, and `engine`. Only OmniVoice and Fun-CosyVoice 3 send `voice_prompt`; Qwen3 TTS never sends it. OpenVoice may also send `styles`. Fun-CosyVoice 3 accepts only its displayed lowercase tone tags.
- The browser UI still offers `en`, `fr`, and `es`; backend normalization maps locale-style variants gracefully when requests come from other clients.
