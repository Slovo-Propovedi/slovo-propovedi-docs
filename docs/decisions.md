# Стек и решения (decisions)

Этот документ фиксирует **утверждённый стек** и принятые решения. Изменения вносятся только через обсуждение и редактирование этого файла. Агенты НЕ добавляют зависимости вне секции Approved stack без объяснения «почему» в этом же документе.

## Approved stack

| Area | Package/Tool | Why |
|------|--------------|-----|
| Рантайм | `nginx:alpine` | Раздача статики Swagger UI + `openAPI.yaml` на порту 8080; минимальная поверхность атаки, нет рантайм-приложения (см. [`architecture.md`](./architecture.md)) |
| Swagger UI | `swagger-ui-dist` `5.32.12` | Статические ассеты Swagger UI; только на этапе сборки, переопределяется через build arg `SWAGGER_UI_VERSION` |
| Build stage | `node:20-alpine` | Загрузка `swagger-ui-dist` (npm-пакет) в Stage 1 multi-stage build |
| Сборка | Docker multi-stage | Прод-образ не содержит Node.js runtime — только nginx (см. [`architecture.md`](./architecture.md)) |
| TLS/прокси | Traefik `v3.4` | Реверс-прокси, автосертификаты Let's Encrypt (ACME httpChallenge), HTTP→HTTPS redirect |
| Супервизор | systemd | Процессный супервизор для одного контейнера: `Restart=always`, авто-старт, журнал |
| Сборка образов | Docker buildx (билдер `slovo-constrained`) | Ресурсные лимиты (1g, cpu-quota 80000), чтобы сборка не «съедала» VPS |
| Валидация YAML | `js-yaml` `^4.1.0` | `npm run validate:openapi` — парсинг `openAPI.yaml` как YAML (exit 1 при ошибке) |
| Pre-commit | `husky` `^9.1.7` | Запуск `validate:openapi` на каждый коммит |
| Dev-редактор | Swagger Editor v5 (`swaggerapi/swagger-editor:v5.8.4`) | Локальное редактирование `openAPI.yaml` с живой валидацией; только для разработки (`editor/`) |
| CI/CD | Forgejo Actions | CI (валидация) + Release (деплой, Forgejo Release); живёт в репозитории (см. [`ci-cd.md`](./ci-cd.md)) |
| Пакетный менеджер | npm | Установка зависимостей, скрипты (`npm ci`, `npm run ...`) |

## Rejected (and why)

| Proposal | Verdict | Why |
|----------|---------|-----|
| Ansible playbook (прежний `roles/custom/slovo-docs/`) | Отклонено | Заменён Forgejo Actions + `scripts/vps-deploy.sh`. Проще, живёт в репозитории, не требует внешнего инструментария и отдельного контроля версий |
| docker compose для продакшена | Отклонено | systemd даёт лучший процессный супервизор + журнал для одного контейнера; compose не предоставляет `Restart=always` на уровне процесса и авто-старт при загрузке так же естественно |
| Kubernetes | Отклонено | Избыточен для одного статического контейнера на одном VPS |
| Node.js runtime в продакшене | Отклонено | Swagger UI — статический JS, сервер не нужен; nginx достаточно, а образ без Node меньше и безопаснее |

## Other fixed decisions

- **OpenAPI-версия спецификации:** `openAPI.yaml` объявляет `openapi: 3.0.3`.
- **Порт контейнера:** 8080 (nginx, HEALTHCHECK wget на `/`).
- **CORS:** `Access-Control-Allow-Origin "*"` — разрешить фронтенду/мобильному кодогенератору (Orval) забирать спецификацию; методы ограничены `GET, OPTIONS`.
- **CSP `connect-src`:** whitelist `'self' http://localhost:3000 https://api.slovo-propovedi.ru`.
- **Скрытые файлы:** `deny all` в nginx.
- **Коммиты:** conventional commits + DCO signoff (`git commit -s`); заголовок ≤ 100 символов.
- **Пакетный менеджер:** npm (не yarn).
- **Согласованность версии:** тег `v*` = `package.json` version = `openAPI.yaml` `info.version` (проверяется Release-workflow; `bump-version.mjs` обновляет всё сразу).
- **CI tag guard:** `if: github.ref_type != 'tag'` (некоторые версии Forgejo запускают workflow на теги несмотря на branches-фильтр).
- **`HUSKY: 0` в CI** при `npm ci` — хуки только локально.
- **wait-for-CI через polling** (40×15с), совпадение по префиксу `startswith("CI / validate")` — Forgejo не поддерживает `workflow_run`.
- **Деплой через tar+ssh** (не git clone) — раннер уже имеет checkout по тегу.
- **`Wants` (не `Requires`) на `slovo-traefik.service`** — перезапуск Traefik не должен останавливать docs-сервис (баг-фикс 0.1.1).
- **buildx resource limits** (memory 1g, cpu-quota 80000).
- **Security hardening контейнера:** `--cap-drop=ALL`, `--read-only`, tmpfs для /tmp /var/cache/nginx /run, `--memory=64m`, `--user=slovo:slovo` (non-root).
- **Dev-редактор отделён от прод-образа** (`docker-compose.dev.yml`, порт 127.0.0.1:8081, монтирует `openAPI.yaml` read-write).

## Superseded (отменённые решения)

Секция для устаревших решений. Отменённое решение помечается зачёркиванием с объяснением, **не удаляется**:

~~**Ansible playbook** — ранее использовался для деплоя (`roles/custom/slovo-docs/`). Заменён на Forgejo Actions + `scripts/vps-deploy.sh` (см. выше).~~

Сейчас других отменённых решений нет.

## Связанные документы

- [`architecture.md`](./architecture.md) — обоснование ключевых решений.
- [`ci-cd.md`](./ci-cd.md) — как решения применяются в CI/CD.
- [`conventions.md`](./conventions.md) — правила добавления зависимостей и DoD.
