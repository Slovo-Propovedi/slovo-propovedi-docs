# AGENTS.md

Coding agent instructions for the slovo-propovedi-docs Swagger UI + OpenAPI service.

## Build, Lint, and Deploy Commands

```bash
# List all available targets
make help

# Dev OpenAPI editor (Swagger Editor v5, port 8081)
make dev-up          # Build + start + open in browser (waits until ready)
make dev-down        # Stop and remove the dev editor container
make dev-restart     # Restart (picks up openAPI.yaml changed outside the editor)
make dev-build       # (Re)build the dev editor image without starting
make dev-logs        # Tail dev editor logs
make dev-shell       # Shell inside the running editor container
make dev-open        # Open the editor in the default browser

# Production Swagger UI image (port 8080)
make prod-build      # Build the production image
make prod-up         # Run the production container (detached) → http://localhost:8080
make prod-down       # Stop (and auto-remove) the production container
make prod-logs       # Tail production logs
make clean           # Stop everything (dev + prod)

# OpenAPI validation (also runs via husky pre-commit on every commit)
npm run validate:openapi

# Version bump — updates package.json + openAPI.yaml + CHANGELOG.md,
# commits with signoff (-s) and tags v<version> automatically
npm run bump-version <version|patch|minor|major>

# Direct docker (no Makefile)
docker build -t slovo-propovedi-docs .
docker run --rm -p 8080:8080 slovo-propovedi-docs

# Override the Swagger UI version (default 5.32.12)
make prod-build SWAGGER_UI_VERSION=5.40.0
docker build --build-arg SWAGGER_UI_VERSION=5.40.0 -t slovo-propovedi-docs .
```

## Project Architecture

This is a **fully static service**: an nginx container that serves the Swagger UI documentation UI and the `openAPI.yaml` specification file. It is **independent** of the admin backend — no Postgres, MinIO, or backend containers are required to run it.

- **Multi-stage Docker build** (`Dockerfile`):
  - **Stage 1** (`node:20-alpine`) downloads `swagger-ui-dist` (default `5.32.12`, overridable via the `SWAGGER_UI_VERSION` build arg) and copies the static assets.
  - **Stage 2** (`nginx:alpine`) serves the static files. **There is no Node.js runtime in the production image** — Swagger UI is pure static JS.
- **Endpoints:** `/` = Swagger UI; `/openAPI.yaml` = raw OpenAPI spec.
- **Dev editor** is a separate compose service (`docker-compose.dev.yml`, port `127.0.0.1:8081`) running the official Swagger Editor v5 with a save-proxy. It is **NOT** part of the production image and must never be deployed. It mounts `openAPI.yaml` read-write.

### Repository layout

```
Dockerfile            # Multi-stage build: swagger-ui-dist + nginx
index.html            # Custom Swagger UI entry page
nginx.conf            # Server config: port 8080, YAML content type, CORS, security headers
openAPI.yaml          # The OpenAPI specification (the only "source of truth" content)
Makefile              # Shortcuts for dev editor + production image
docker-compose.dev.yml# DEV ONLY — dev Swagger Editor (port 8081)
editor/               # Dev editor internals (save-proxy server, patch, package.json)
scripts/              # validate-openapi-yaml.mjs, bump-version.mjs, vps-deploy.sh
.forgejo/workflows/   # CI + Release Forgejo Actions workflows
.husky/pre-commit     # Runs validate:openapi on commit
```

## Documentation (docs/)

В папке `docs/` лежит подробная документация сервиса на русском. Это **первоисточник знаний о проекте** для агентов (opencode, Claude Code, Cursor).

### Структура docs/

| Раздел | Назначение |
| --- | --- |
| `docs/README.md` | Карта документации и правила для агентов |
| `docs/architecture.md` | Архитектура «почему» (статический nginx, multi-stage build, dev-редактор) |
| `docs/ci-cd.md` | Forgejo Actions: CI + Release + VPS deploy, «почему такие настройки» |
| `docs/decisions.md` | Принятый стек и отклонённые варианты |
| `docs/conventions.md` | Процессные договорённости (git, AI, ведение docs, DoD) |
| `docs/debt.md` | Технический долг |

### Обязательные правила для агентов

1. **Перед реализацией фичи/фикса** прочитай соответствующие документы в `docs/`:
   - `docs/architecture.md` — при архитектурных решениях;
   - `docs/ci-cd.md` — при изменениях CI/CD, деплоя, workflow;
   - `docs/decisions.md` — перед добавлением новой зависимости;
   - `docs/conventions.md` — перед изменением процесса (git, коммиты, релизы).

2. **При изменении кода** обнови затронутые документы `docs/` **в том же PR/коммите**. Изменение кода без обновления `docs/` считается неполным.

3. **Каждый «срезанный угол»** (TODO, hack, отложенная задача, workaround) → запись в `docs/debt.md` в том же PR. Формат:
   ```
   - [ ] <что не доделано> — <где (пути файлов)> — <когда вернуться/контекст>
   ```
   Комментарий `// TODO(name):` в коде допустим **только** с зеркальной записью в `docs/debt.md`.

4. **Новые зависимости** — только через запись в `docs/decisions.md` (секция Approved stack) с объяснением «почему». Не добавляй пакеты «молча».

5. **Если в `docs/` нет нужной информации** — добавь её, исследовав код, чтобы следующий агент не делал это повторно. Это цель документации.

Полные правила ведения docs — в [`docs/README.md`](docs/README.md) и [`docs/conventions.md`](docs/conventions.md). AGENTS.md и docs/ должны оставаться консистентными.

## Code Style Guidelines

Проект — это в основном YAML, shell, nginx-конфиг и маленькие JS-скрипты. Правила стиля:

- **YAML (`openAPI.yaml`):** OpenAPI-спецификация; 2-пробельный отступ. Валидность проверяется `npm run validate:openapi` (js-yaml) на каждом коммите через husky.
- **Shell-скрипты (`scripts/`):** `set -euo pipefail`; комментарии объясняют **почему**, а не что.
- **`nginx.conf`:** инлайн-комментарии по секциям (CORS, security headers, YAML content type, кэш, deny hidden files, SPA fallback).
- **JS-скрипты (`.mjs`):** ESM (`import`); консистентный стиль. `scripts/validate-openapi-yaml.mjs` использует двойные кавычки, `scripts/bump-version.mjs` — одинарные без точек с запятой; сохраняй стиль существующего файла.
- **Все инлайн-комментарии должны объяснять WHY, а не WHAT.**

## Pre-commit Hooks

Husky запускает `npm run validate:openapi` на каждый коммит — блокирует коммит, если `openAPI.yaml` не валидный YAML:

```bash
# .husky/pre-commit
npm run validate:openapi
```

В CI переменная окружения `HUSKY: 0` отключает установку husky-хуков (хуки нужны только локально).

## Commit Convention

Conventional commits с типами:

- `feat` - New feature
- `fix` - Bug fix
- `refactor` - Code change without feature/fix
- `test` - Adding/modifying tests
- `docs` - Documentation only
- `style` - Formatting only
- `chore` - Maintenance tasks
- `build` - Build system changes
- `ci` - CI configuration changes
- `perf` - Performance improvements
- `revert` - Reverting changes

**Signoff (DCO) обязателен:** `git commit -s`. Максимальная длина заголовка — 100 символов.

## Key Dependencies

| Пакет/инструмент | Назначение | Когда |
|------------------|------------|-------|
| `swagger-ui-dist` (`5.32.12`) | Статические ассеты Swagger UI | Только на этапе сборки (build-time), переопределяется через build arg |
| `nginx:alpine` | Рантайм: раздача статики на порту 8080 | Рантайм (prod) |
| `js-yaml` (`^4.1.0`) | Валидация YAML в `validate:openapi` | Dev-инструмент |
| `husky` (`^9.1.7`) | Pre-commit хуки | Dev-инструмент |
| Swagger Editor v5 (`editor/`) | Dev-редактор для `openAPI.yaml` | Только для разработки (`docker-compose.dev.yml`) |

## Package Manager

**IMPORTANT:** проект использует **npm**. Не используй yarn:
- Установка зависимостей: `npm ci` / `npm install`
- Добавление пакетов: `npm install <package>` / `npm install -D <package>`
- Запуск скриптов: `npm run <script>`

## Gotchas

1. **В прод-образе НЕТ Node.js рантайма.** `swagger-ui-dist` — это статический JS, копируется в Stage 1 и раздаётся nginx в Stage 2. Не добавляй серверную логику — её негде запускать.
2. **Dev-редактор монтирует `openAPI.yaml` read-write, прод — read-only.** Изменения через редактор сохраняются на диск; в проде контейнер отдаёт только зашитый в образ файл.
3. **`bump-version.mjs` коммитит (`git commit -s`) И создаёт тег (`git tag -a`) автоматически.** Проверь diff (`git diff --cached`) перед тем как запускать; после — запуши вручную: `git push --tags origin main`. Скрипт также верифицирует, что тег реально создан (`git tag -a` иногда выходит с 0, но не создаёт ref).
4. **`openAPI.yaml` `info.version` должна совпадать с `package.json` version.** Release-workflow проверяет это (тег vs `package.json`). Скрипт `bump-version.mjs` обновляет оба места.
5. **Некоторые версии Forgejo запускают CI-workflow и на push тегов** несмотря на фильтр `branches: [main]` — поэтому в `ci.yml` стоит явный guard `if: github.ref_type != 'tag'`.
6. **Проект не использует commitlint** — соблюдение conventional commits и signoff — договорённость, а не машино-проверяемое правило (см. [`docs/conventions.md`](docs/conventions.md)).
