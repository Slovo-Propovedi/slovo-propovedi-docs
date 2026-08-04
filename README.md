# slovo-propovedi-docs

Standalone Swagger UI + OpenAPI spec service for the **Admin API — Слово.Проповеди**.

The service is a fully static nginx container: it serves the Swagger UI documentation UI and the
`openAPI.yaml` specification file. It is **independent** of the admin backend — no Postgres, MinIO,
or backend containers are required to run it.

## Makefile shortcuts

Команды из этого README обёрнуты в `Makefile` — см. `make help` для полного списка
целей (dev-редактор, прод-сборка, запуск, остановка).

## What it serves

| Endpoint        | Description                                |
| --------------- | ------------------------------------------ |
| `/`             | Swagger UI (interactive API documentation) |
| `/openAPI.yaml` | The OpenAPI 3.0.3 specification (raw YAML) |

## Build the Docker image

```bash
docker build -t slovo-propovedi-docs .
```

The build downloads `swagger-ui-dist` (default `5.32.12`, overridable via the
`SWAGGER_UI_VERSION` build arg) and bundles it with the custom `index.html`, `openAPI.yaml`,
and `nginx.conf` into a minimal `nginx:alpine` image. There is no Node.js runtime in the final image.

```bash
# With a specific Swagger UI version
docker build --build-arg SWAGGER_UI_VERSION=5.32.12 -t slovo-propovedi-docs .
```

## Run it locally

```bash
docker run --rm -p 8080:8080 slovo-propovedi-docs
```

Then open <http://localhost:8080/> to browse the API documentation.

Quick sanity check:

```bash
curl -s http://localhost:8080/openAPI.yaml | head
```

## How to update the spec

1. Edit `openAPI.yaml` (OpenAPI 3.0.3, servers: `http://localhost:3000` and
   `https://api.slovo-propovedi.ru`).
2. Rebuild the image:

   ```bash
   docker build -t slovo-propovedi-docs .
   ```

3. Restart the container with the new image.

## Локальный редактор OpenAPI (только для разработки)

Для удобного редактирования `openAPI.yaml` (вместо правки файла вручную) есть отдельный
dev-контейнер: официальный Swagger Editor v5 + кнопки **Load from disk** и **Save to disk**.
Он **не** входит в прод-образ (см. `Dockerfile`) и существует только локально.

Самый простой способ запустить редактор — `make`:

```bash
make dev-up
```

Команда собирает и запускает dev-контейнер, **ждёт, пока редактор станет готовым**, и
**автоматически открывает его в браузере** по адресу <http://localhost:8081/> (в
headless-окружениях без браузера она просто печатает сообщение о готовности).
Редактор автоматически загрузит текущий `openAPI.yaml`.
Кнопка **Save to disk** записывает содержимое редактора обратно в `openAPI.yaml` на диске
(файл примонтирован как том). После сохранения проверьте diff и закоммитьте:

```bash
git diff openAPI.yaml
git add openAPI.yaml && git commit
```

Если браузер не открылся сам (или вы его закрыли) — откройте вручную:

```bash
make dev-open
```

Остановить dev-редактор:

```bash
make dev-down
```

Если предпочитаете сырые команды: под капотом `make dev-up` — это просто
`docker compose -f docker-compose.dev.yml up --build`.

Продакшен-контейнер (Swagger UI на `:8080`) этим не затрагивается.

Изменения `openAPI.yaml` вне редактора (`git pull`, переключение веток и т.п.) идут через атомарную
замену файла: работающий контейнер держит старый inode и отдаёт старую версию до перезапуска.
Перезапустите dev-контейнер: `make dev-restart` (или `make dev-down && make dev-up`).
Кнопка **Save to disk** не затронута — она пишет в тот же примонтированный файл.

## Repository layout

```
Dockerfile     # Multi-stage build: swagger-ui-dist + nginx
index.html     # Custom Swagger UI entry page
nginx.conf     # Server config: port 8080, YAML content type, CORS, security headers
openAPI.yaml   # The OpenAPI specification
```
