# Архитектура: почему так

Этот документ объясняет **мотивацию и историю** архитектурных решений. Машино-проверяемые правила (валидация `openAPI.yaml` через js-yaml в husky) уже настроены — здесь они не дублируются, а обосновываются. За деталями правил и команд обращайся к [`AGENTS.md`](../AGENTS.md). Инфраструктура и пайплайны — в [`ci-cd.md`](./ci-cd.md).

## Почему статический nginx-контейнер (без backend)

Сервис — это просто nginx, раздающий статические файлы Swagger UI и `openAPI.yaml`. Он **не зависит** от админ-бэкенда: для запуска не нужны Postgres, MinIO или контейнеры бэкенда. Swagger UI — чистый статический JS, ему не нужен сервер рантайма.

**Мотивация:**
- **Проще.** Нет приложения, нет состояния, нет БД — одна команда запускает и останавливает сервис.
- **Быстрее.** Статика отдаётся nginx почти без накладных расходов.
- **Нет зависимостей рантайма.** Нечего обновлять и чинить, кроме образа и спецификации.
- **Минимальная поверхность атаки.** Нет рантайм-приложения, которое можно было бы эксплуатировать; за безопасность отвечает только конфиг nginx (см. «Почему nginx security headers & CORS»).

## Почему multi-stage Docker build

`Dockerfile` построен в два этапа:

```
Stage 1 (node:24-alpine, build)  →  npm install swagger-ui-dist → копия статики в /out
Stage 2 (nginx:alpine, runtime)  →  COPY --from=swagger-ui-build /out/ → раздача статики
```

**Мотивация:**
- Swagger UI поставляется как npm-пакет `swagger-ui-dist` — чтобы его скачать, Stage 1 нужен Node/npm.
- Готовый образ **не содержит Node.js**: статика копируется в Stage 2, где есть только nginx. Это делает образ меньше и ещё сильнее сужает поверхность атаки.
- **Build arg `SWAGGER_UI_VERSION`** (по умолчанию `5.32.12`) позволяет закреплять и переопределять версию Swagger UI без правки Dockerfile: `make prod-build SWAGGER_UI_VERSION=5.40.0`.
- В образе объявлен `HEALTHCHECK` на порту 8080 (wget к `/`) — рантайм-проверка живости сервиса.

## Почему отдельный dev-редактор

Редактировать `openAPI.yaml` вручную легко ошибиться (отступы, спецсимволы, невалидный YAML). Для этого есть отдельный dev-контейнер — официальный Swagger Editor v5 с кнопками **Load from disk** / **Save to disk** (порт `127.0.0.1:8081`).

**Мотивация:**
- Живая валидация и превью спецификации прямо в редакторе.
- Это **отдельный compose-сервис** (`docker-compose.dev.yml`, контекст `editor/`) — **не входит в прод-образ** и никогда не деплоится.
- Он монтирует `openAPI.yaml` **read-write** — кнопка Save записывает изменения на диск; прод остаётся read-only статикой.
- **Почему внутри редактора node-прокси:** Swagger Editor — SPA; чтобы сохранить изменения в примонтированный файл, добавлен маленький Express save-proxy (`editor/server.js`) с `GET /spec` / `PUT /spec`. Он патчит `index.html` на этапе сборки (`editor/patch-index.js`) и заодно подключает vim-режим (monaco-vim).

## Почему Traefik + systemd (а не docker compose / k8s)

На VPS работает **один** статический контейнер — оркестрация тут избыточна. Выбраны systemd + Traefik:

- **systemd** даёт надёжный супервизор процесса: `Restart=always`, авто-запуск при загрузке, журнал `journalctl`. Это процессная гарантия, которой нет у голого `docker run` или `docker compose up -d`.
- **Traefik** отвечает за реверс-прокси и **TLS** (Let's Encrypt через ACME httpChallenge). Он поставляет сертификаты автоматически и маршрутизирует по hostname.
- **Важно про `Wants` vs `Requires`:** юнит `slovo-docs.service` объявляет `Wants=slovo-traefik.service` (а **не** `Requires`), чтобы перезапуск Traefik не каскадно останавливал docs-сервис. Это было исправление бага (CHANGELOG 0.1.1): раньше `Requires` тянул за собой остановку `slovo-docs` при каждом рестарте Traefik.
- k8s отклонён — избыточен для одного статического контейнера (см. [`decisions.md`](./decisions.md)).

## Почему buildx с resource limits

VPS общий/ограниченный по ресурсам. Скрипт создаёт buildx-билдер `slovo-constrained` с driver `docker-container`, лимитами памяти (`1g`) и CPU (`cpu-quota 80000`), чтобы сборка Docker-образа **не «съедала»** ресурсы других сервисов VPS. Сборка идёт через `docker buildx build --load` (загрузка образа в локальные docker images).

## Почему nginx security headers & CORS

`nginx.conf` настраивает и безопасность, и доступность спецификации:

- **CSP** (`Content-Security-Policy`) ограничивает источники: `connect-src 'self' http://localhost:3000 https://api.slovo-propovedi.ru` — Swagger UI может ходить только к самому себе и известным хостам API.
- **CORS `Access-Control-Allow-Origin "*"`** — чтобы фронтенд/мобильный кодогенератор (Orval в мобильном проекте) мог с `fetch` забирать спецификацию. Методы ограничены `GET, OPTIONS`; preflight короткозамыкается `return 204`.
- **Прочие security headers:** `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`.
- **Скрытые файлы** (`.env`, `.git` и т.п.) — `deny all`.
- **YAML content type:** у `location = /openAPI.yaml` — scoped `types`-маппинг (`text/yaml yaml yml`), `default_type text/yaml`, `charset utf-8` + `charset_types text/yaml`, чтобы спецификация отдавалась как `text/yaml; charset=utf-8` и кириллица оставалась читаемой.
- **Кэш** для `*.(js|css|png|svg|ico)` (`expires 1d`) и **SPA-fallback** `try_files $uri $uri/ /index.html`.

## Итоговая ASCII-диаграмма (деплой)

```
                 Forgejo Actions
   ┌────────────────────────────┐
   │  CI: validate openAPI.yaml  │
   │  Release: ждёт CI, заливает │
   │  исходники (tar+ssh)        │
   └─────────────┬──────────────┘
                 │ ssh (ed25519)
                 ▼
        ┌───────────────────────────── VPS ─────────────────────────────┐
        │  /slovo/docs/container-src   ← исходники (без .git)           │
        │        │                                                      │
        │        ▼                                                      │
        │  docker buildx build --load  (билдер slovo-constrained, 1g)   │
        │        │                                                      │
        │        ▼                                                      │
        │  systemd: slovo-docs.service (Wants=slovo-traefik)            │
        │        │   docker run: --cap-drop=ALL --read-only             │
        │        │   --memory=64m --user=slovo:slovo                    │
        │        ▼                                                      │
        │  контейнер slovo-docs (nginx:alpine, :8080)                   │
        │   сети: slovo-docs + traefik   ←── Traefik (slovo-traefik)    │
        │                                      :80 → :443, ACME TLS      │
        └───────────────────────────────────────────────────────────────┘
                         ▲
                         │ https://docs.<hostname>
                   Интернет
```

## Связанные документы

- [`README.md`](./README.md) — правила работы с документацией.
- [`ci-cd.md`](./ci-cd.md) — инфраструктура и пайплайны: CI, Release, VPS deploy.
- [`decisions.md`](./decisions.md) — утверждённый стек и отклонённые варианты.
- [`AGENTS.md`](../AGENTS.md) — конкретные правила стиля, команд и структуры.
