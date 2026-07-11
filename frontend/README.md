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

- The engine selector keeps the same interaction model as before and now renders six cards with data-driven subtitles.
- The frontend still sends the same request contract to the backend: `jobId`, `voiceId`, `text`, `language`, and `engine`.
- The browser UI still offers `en`, `fr`, and `es`; backend normalization maps locale-style variants gracefully when requests come from other clients.
