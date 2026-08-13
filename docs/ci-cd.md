# CI/CD: почему такие настройки

Этот документ объясняет **мотивацию каждого решения** в Forgejo Actions пайплайнах и деплой-скрипте. «Что» уже написано в самих workflow-файлах — здесь разбирается «почему». Файлы: `.forgejo/workflows/ci.yml`, `.forgejo/workflows/release.yml`, `scripts/vps-deploy.sh`. Архитектура сервиса — в [`architecture.md`](./architecture.md).

## Обзор

Два workflow:

| Workflow | Триггер | Что делает |
|----------|---------|------------|
| `CI` (`ci.yml`) | push/PR в `main` | Валидирует `openAPI.yaml` |
| `Release` (`release.yml`) | push тега `v*` | Ждёт прохода CI, деплоит на VPS, создаёт Forgejo Release |

```
push main ──────────► CI: validate:openapi ◄── PR в main
                          │  (github.ref_type != 'tag' guard)
                          ▼
push tag v* ──► Release: проверка версии → ждёт CI (poll) → ssh → tar+ssh
                 → vps-deploy.sh (buildx + systemd + Traefik) → Forgejo Release
```

## CI workflow (`ci.yml`)

### Почему tag guard (`if: github.ref_type != 'tag'`)

Workflow объявлен на `push: branches: [main]` и `pull_request: branches: [main]`. Но **некоторые версии Forgejo запускают workflow и на push тегов**, несмотря на фильтр по веткам. Тег всегда указывает на коммит, который уже был проверен, когда его пушили в `main`, — повторная прогонка бессмысленна и расходует раннер. Поэтому стоит явный guard: на тегах шаг `validate` пропускается.

### Почему Node 24

CI использует `actions/setup-node@v4` с `node-version: 24` — **это совпадает со Stage 1 Dockerfile** (`node:24-alpine`). Node 20 достиг EOL в апреле 2026, поэтому проект перешёл на Node 24 (активный LTS до апреля 2028); та же версия используется в мобильном проекте. У проекта нет своих серверных зависимостей, Node нужен только чтобы запустить `validate:openapi` и `npm ci`.

### Почему `HUSKY: 0` при `npm ci`

Пакет `husky` в `prepare`-скрипте пытается установить git-хуки при установке зависимостей. В CI это не нужно и может падать (нет локального репозитория хуков в привычном виде). Хуки нужны только для локальной разработки; в CI валидация запускается явным шагом. Поэтому `npm ci` выполняется с `HUSKY: 0` — husky пропускает установку хуков.

### Почему `npm ci`, а не `npm install`

`npm ci` — чистая установка **из lockfile** (`package-lock.json`), воспроизводимая и детерминированная. Она удаляет `node_modules` перед установкой и не трогает версии, а `npm install` мог бы обновить зависимости. В CI важна воспроизводимость.

### Почему только `validate:openapi`

Это **единственный quality gate** проекта: `openAPI.yaml` должен парситься как валидный YAML (скрипт `scripts/validate-openapi-yaml.mjs` на js-yaml, exit 1 при ошибке). Нет lint/тестов/typecheck — это статический сервис спецификации, деплоить больше нечего проверять.

### Почему cleanup workspace (`if: always()`)

После шагов удаляется `node_modules` (`rm -rf node_modules`). Причина — экономия места на раннере. `if: always()` гарантирует очистку даже при падении предыдущего шага (иначе мусор останется на раннере).

## Release workflow (`release.yml`)

### Почему триггер по тегу (`push: tags: ['v*']`)

Релизы **явные**: деплой запускается только осознанным push версионного тега. Это не даёт случайному коммиту в `main` уехать в прод. Теги создаются скриптом `npm run bump-version` (см. [`conventions.md`](./conventions.md)).

### Почему проверка согласованности версии

Первый шаг сравнивает версию тега (без префикса `v`) с версией из `package.json`. Это ловит забытый запуск `bump-version` (когда тег поставили вручную). Ошибка прямо говорит: «Run `npm run bump-version <version>` to create a consistent release». Версия должна совпадать и с `openAPI.yaml` (`info.version`) — скрипт обновляет оба места.

### Почему wait-for-CI через polling (а не `workflow_run`)

Release должен деплоить только прошедший CI коммит. Forgejo Actions **не поддерживает** `workflow_run`-триггер (в отличие от GitHub), поэтому порядок CI→Release обеспечивается **опросом API статусов коммита**:

```
GET {server}/api/v1/repos/{repo}/commits/{sha}/status
40 попыток × 15 сек; статус failure/error → отказ от деплоя.
```

**Почему совпадение по префиксу** (`startswith("CI / validate")`), а не равенству: Forgejo добавляет к имени context имя запускающего события, например `CI / validate (push)`. Равенство строки сломало бы поиск — поэтому матч по префиксу.

**Почему можно «держать» слот раннера:** мощность раннеров = 2. Пока этот шаг опрашивает статус (ждёт CI), он занимает один слот, но не «голодает» CI-workflow: у CI всё ещё есть второй слот для запуска. Если бы раннер был один, такой опрос заблокировал бы сам CI.

### Почему SSH setup (ed25519 + ssh-keyscan)

Приватный ключ берётся из секрета `VPS_SSH_PRIVATE_KEY` (ed25519), кладётся в `~/.ssh/id_ed25519` с правами 600. `ssh-keyscan -H "$VPS_HOST"` заполняет `known_hosts` — без этого SSH спросил бы подтверждение хоста интерактивно и завис бы в неинтерактивном CI.

### Почему деплой через tar+ssh (НЕ git clone)

У раннера **уже есть checkout по тегу** (шаг `actions/checkout@v4`). Поэтому:
- исходники пакуются в `tar` (исключая `.git`) и передаются на VPS по ssh;
- на VPS **не нужен git** и не нужно ничего клонировать повторно.

Затем `scp` заливает `scripts/vps-deploy.sh` в `/tmp` и запускает его по ssh с env-переменными. Этот подход заменил прежний git clone на VPS (CHANGELOG 0.2.0: «Transfer source code via tar+ssh instead of git clone on VPS»).

### Почему именно такие env-переменные на VPS

- **`DEPLOY_TAG`** — git-тег (`github.ref_name`), чтобы скрипт знал, что деплоим.
- **`ACME_EMAIL`** — email Let's Encrypt. Нужен **только для первого деплоя на «свежий» VPS**, когда Traefik ещё не работает (см. ниже); если Traefik уже поднят — не требуется.
- **`DOCS_HOSTNAME`** — публичный hostname. Это Forgejo **variable** (`vars.DOCS_HOSTNAME`), а не secret: значение не чувствительное и должно быть видимым в логах/конфиге.

### Почему changelog через awk

Секция релиза извлекается из `CHANGELOG.md` awk-скриптом: ищем `## [<version>]`, копируем до следующего `## [` или ссылочной строки `[...]:`. Если секции нет (`! -s release-body.md`) — ошибка «No changelog section found», с подсказкой сначала запустить `bump-version`. Так релиз гарантированно сопровождается changelog.

### Почему создание Forgejo Release через REST API

Релиз создаётся POST-запросом к API: `jq` собирает JSON-тело (`tag_name`, `name`, `body`), `curl` постит его, затем проверяется HTTP-код (`>= 400` = ошибка, тело ответа выводится в лог). В отличие от мобильного проекта, **нет загрузки бинарного артефакта (APK)** — это разворачиваемый сервис, а не скачиваемый артефакт, поэтому загружать нечего.

### Почему cleanup

Финальный шаг (`if: always()`) удаляет временные файлы `release-body.md`, `release.json`, `release-response.json` — чтобы не засорять раннер даже при падении.

## VPS deploy script (`scripts/vps-deploy.sh`)

Скрипт выполняется **на VPS от root**, запускается по ssh Release-workflow. Он заменил прежнюю Ansible-роль (`roles/custom/slovo-docs/`). Скрипт **идемпотентен** — безопасно перезапускать, обрабатывает и первый деплой, и обновление.

### Почему auto-install Docker

Если `docker` не найден — ставится через `https://get.docker.com` и включается через `systemctl enable --now docker`. Это позволяет деплоить на «голый» VPS без ручной установки Docker.

### Почему создаётся `slovo` user/group

Контейнер должен работать от **не-root** аккаунта. Если `slovo` user/group не существует — создаются системные (`--system`, `--no-create-home`, shell `/sbin/nologin`). Скрипт читает `uid/gid` и использует их при запуске контейнера.

### Почему buildx builder `slovo-constrained`

Создаётся buildx-билдер с driver `docker-container` и **ресурсными лимитами**: memory `1g`, cpu-quota `80000`. Цель — чтобы сборка Docker-образа не выжирала ресурсы других сервисов VPS (см. [`architecture.md`](./architecture.md)). Если билдер уже есть — переиспользуется.

### Почему авто-провижининг Traefik

Если сервис `slovo-traefik.service` не активен — скрипт **поднимает Traefik сам**:
- пишет статический конфиг (`traefik.yml`): HTTP→HTTPS redirect (`web` → `web-secure`), ACME через Let's Encrypt `httpChallenge` на entryPoint `web`, docker provider (`exposedByDefault: false`, network `traefik`);
- создаёт ACME-хранилище `acme.json` с **chmod 600** (Traefik требует именно такие права);
- пишет systemd-юнит `slovo-traefik.service` (контейнер через `docker create`/`docker start --attach`, `Restart=always`);
- пулит образ `traefik:v3.4`.

**Почему `ACME_EMAIL` обязателен на свежем VPS:** без него Let's Encrypt не зарегистрирует сертификат. Если Traefik не работает, а `ACME_EMAIL` не задан — скрипт завершается с понятной ошибкой и подсказками (добавить секрет в Forgejo или указать `TRAEFIK_SERVICE`).

### Почему проверка исходников

Скрипт ждёт, что в `$SRC_PATH` лежит залитый workflow `Dockerfile`; если его нет — ошибка «No source code found» (workflow должен передать код **до** запуска скрипта). Пути создаются и `chown`-ятся на `slovo`.

### Почему Traefik labels в отдельном файле

Роутер/маршрутизация задаются **label-файлом** (`--label-file=$BASE_PATH/labels`), а не инлайн-флагами: проще читать, менять и передавать в `docker create`. В labels: `traefik.enable=true`, network, port 8080, router rule `Host(`<DOCS_HOSTNAME>`)`, entrypoint `web-secure`, `tls=true`, `certResolver=default`.

### Почему две Docker-сети

Контейнер docs подключается к **двум** сетям: `slovo-docs` (изоляция от остальных контейнеров) и `traefik` (чтобы Traefik мог маршрутизировать к нему). Обе создаются автоматически, если отсутствуют. Наличие общего `traefik`-сети — обязательное условие, чтобы Traefik «увидел» контейнер.

### Почему `docker buildx build --load`

Сборка на VPS через buildx-билдер, а `--load` загружает образ в локальные docker images (иначе после сборки образ не был бы виден `docker run`).

### Почему systemd unit `slovo-docs.service`

Юнит описывает запуск контейнера: `Requires=docker.service`, `Wants=slovo-traefik.service` (**не** `Requires` — см. ниже), `Restart=always`, `RestartSec=30`. Запуск через `docker create`/`docker start --attach` (такой же паттерн, что и у Traefik-юнита), `SyslogIdentifier=slovo-docs` для журнала.

**Почему `Wants`, а не `Requires` для Traefik:** это исправление бага из CHANGELOG 0.1.1 («Prevent Traefik restarts from stopping the docs service (Requires → Wants)»). `Requires` подразумевает жёсткую зависимость: перезапуск/остановка Traefik каскадно останавливала docs-сервис. `Wants` — «мягкая»: если Traefik остановлен, docs всё равно стартует. Тут важна лишь доступность Traefik для маршрутизации, а не его жизненный цикл.

**Почему security hardening:**
- `--cap-drop=ALL` — убирает все capabilities;
- `--read-only` — read-only rootfs (nginx пишет только в tmpfs-каталоги);
- `--tmpfs` для `/tmp`, `/var/cache/nginx`, `/run` (всё с ограничениями размера, noexec/nosuid где нужно);
- `--memory=64m` — жёсткий лимит памяти;
- `--user=$SLOVO_UID:$SLOVO_GID` — контейнер работает от `slovo`, а не от root.

### Почему верификация и cleanup

После `daemon-reload` и `restart` скрипт ждёт 2 сек и проверяет `systemctl is-active slovo-docs.service`; при неудаче выводит `systemctl status` и завершается с ошибкой. В конце удаляется `/tmp/vps-deploy.sh`.

## Required secrets and variables

Settings → Actions.

| Тип | Имя | Описание |
|-----|-----|----------|
| Secret | `VPS_SSH_PRIVATE_KEY` | SSH-ключ (ed25519) для доступа к VPS |
| Secret | `VPS_HOST` | Hostname или IP VPS |
| Secret | `VPS_SSH_USER` | SSH-пользователь на VPS (`root`) |
| Secret | `ACME_EMAIL` | Email Let's Encrypt (нужен только для первого деплоя на «свежий» VPS; если Traefik уже работает — не нужен) |
| Variable | `DOCS_HOSTNAME` | Публичный hostname сайта (например `docs.example.com`) — не чувствительное, поэтому variable, а не secret |

## VPS prerequisites

Скрипт рассчитан на VPS, уже подготовленный предыдущими деплоями, но **сам добирает недостающее**:
- `slovo` system user (создаст, если нет);
- buildx builder `slovo-constrained` (создаст, если нет);
- Traefik `slovo-traefik.service` (провижинит, если не активен — при наличии `ACME_EMAIL`).

## Связанные документы

- [`architecture.md`](./architecture.md) — зачем такие инфраструктурные решения.
- [`conventions.md`](./conventions.md) — процесс релизов, версионирование, DoD.
- [`decisions.md`](./decisions.md) — утверждённый стек (Traefik, systemd, Forgejo Actions, npm).
- [`AGENTS.md`](../AGENTS.md) — команды и gotchas.
