# slovo-propovedi-swagger

Standalone Swagger UI + OpenAPI spec service for the **Admin API — Слово.Проповеди**.

The service is a fully static nginx container: it serves the Swagger UI documentation UI and the
`openAPI.yaml` specification file. It is **independent** of the admin backend — no Postgres, MinIO,
or backend containers are required to run it.

## What it serves

| Endpoint        | Description                                    |
|-----------------|------------------------------------------------|
| `/`             | Swagger UI (interactive API documentation)     |
| `/openAPI.yaml` | The OpenAPI 3.0.3 specification (raw YAML)     |

## Build the Docker image

```bash
docker build -t slovo-propovedi-swagger .
```

The build downloads `swagger-ui-dist` (default `5.32.12`, overridable via the
`SWAGGER_UI_VERSION` build arg) and bundles it with the custom `index.html`, `openAPI.yaml`,
and `nginx.conf` into a minimal `nginx:alpine` image. There is no Node.js runtime in the final image.

```bash
# With a specific Swagger UI version
docker build --build-arg SWAGGER_UI_VERSION=5.32.12 -t slovo-propovedi-swagger .
```

## Run it locally

```bash
docker run --rm -p 8080:8080 slovo-propovedi-swagger
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
   docker build -t slovo-propovedi-swagger .
   ```

3. Restart the container with the new image.

## Repository layout

```
Dockerfile     # Multi-stage build: swagger-ui-dist + nginx
index.html     # Custom Swagger UI entry page
nginx.conf     # Server config: port 8080, YAML content type, CORS, security headers
openAPI.yaml   # The OpenAPI specification
```
