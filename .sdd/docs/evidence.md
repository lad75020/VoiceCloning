# Evidence

## Implemented files

- `backend/server.js`
- `backend/package.json`
- `backend/lib/voice-engines.js`
- `backend/inference/common.py`
- `backend/inference/chatterbox_adapter.py`
- `backend/inference/cosyvoice_adapter.py`
- `backend/inference/openvoice_adapter.py`
- `backend/test/voice-engines.test.js`
- `frontend/src/app/app.component.ts`
- `frontend/src/app/app.component.html`
- `frontend/src/app/app.component.scss`
- `README.md`
- `frontend/README.md`
- `.sdd/docs/architecture.md`
- `.sdd/docs/configuration-guide.md`
- `.sdd/docs/deployment-guide.md`
- `.sdd/docs/developer-guide.md`
- `.sdd/docs/functional-requirements.md`
- `.sdd/docs/user-guide.md`

## Verification commands and outputs

### Backend tests

Command:

```bash
cd backend
npm test
```

Observed result:

```text
> voice-cloning-backend@1.0.0 test
> node --test

✔ canonical engine ids are exposed for health and MCP schemas
✔ engine aliases normalize to canonical ids
✔ unsupported engines are rejected clearly
✔ language normalization maps browser and locale aliases to supported codes
✔ health metadata lists all six engines and configuration state
✔ command builder preserves omnivoice argv contract
✔ command builder preserves mlx/qwen argv contract and language mapping
✔ command builder uses python adapter argv for chatterbox
✔ command builder uses python adapter argv for cosyvoice
✔ command builder uses supported F5 CLI with explicit output stem
✔ command builder uses python adapter argv for openvoice with language mapping
ℹ pass 11
ℹ fail 0
```

### Backend syntax checks

Command:

```bash
cd backend
npm run check:syntax
```

Observed result:

```text
> voice-cloning-backend@1.0.0 check:syntax
> node --check server.js && node --check lib/voice-engines.js && python3 -m py_compile inference/*.py
```

The command exited successfully with no syntax errors reported.

### Frontend production build

Initial command:

```bash
cd frontend
npm run build
```

Observed result:

```text
> voice-cloning-frontend@0.0.0 build
> ng build

sh: ng: command not found
```

Follow-up inspection:

```text
frontend/node_modules: missing
frontend/dist: missing
```

Install attempt:

```bash
cd frontend
npm install
```

Observed result:

```text
npm error code ENOTFOUND
npm error syscall getaddrinfo
npm error network request to https://registry.npmjs.org/ws/-/ws-8.18.3.tgz failed
```

Conclusion:

- frontend build verification is blocked in this session because `frontend/node_modules` is absent and outbound npm registry access is unavailable

## Git status after changes

Command:

```bash
git status --short
```

Observed result:

```text
 M .sdd/docs/architecture.md
 M .sdd/docs/configuration-guide.md
 M .sdd/docs/deployment-guide.md
 M .sdd/docs/developer-guide.md
 M .sdd/docs/functional-requirements.md
 M .sdd/docs/user-guide.md
 M README.md
 M backend/package.json
 M backend/server.js
 M frontend/README.md
 M frontend/src/app/app.component.html
 M frontend/src/app/app.component.scss
 M frontend/src/app/app.component.ts
?? backend/inference/
?? backend/lib/
?? backend/test/
```

## Generated artifacts

- `frontend/dist` was not generated because the build could not start without local Angular dependencies.
- No model files or checkpoints were downloaded by these changes.
