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

- Engine cards share the same selection pattern. Selecting OmniVoice opens a supported-attribute picker; selecting Fun-CosyVoice 3 opens a required multi-select tone-tag picker; selecting MLX/Qwen opens a free-form voice-description modal and needs no recorded reference. Selecting OpenVoice opens its style controls.
- Generation sends `jobId`, `text`, `language`, and `engine`; reference-based engines also send `voiceId`, OmniVoice, Fun-CosyVoice 3, and MLX/Qwen send `voice_prompt`, and OpenVoice may send `styles`. Fun-CosyVoice 3 accepts only its displayed lowercase tone tags.
- The browser UI still offers `en`, `fr`, and `es`; backend normalization maps locale-style variants gracefully when requests come from other clients.
