# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Stage 1: build — download the swagger-ui-dist static assets
# ---------------------------------------------------------------------------
FROM node:24-alpine AS swagger-ui-build

ARG SWAGGER_UI_VERSION=5.32.15

WORKDIR /build

RUN npm install "swagger-ui-dist@${SWAGGER_UI_VERSION}" --no-save --no-package-lock \
  && mkdir -p /out \
  && cp -a node_modules/swagger-ui-dist/. /out/

# ---------------------------------------------------------------------------
# Stage 2: runtime — nginx serving static files only (no Node.js runtime)
# ---------------------------------------------------------------------------
FROM nginx:alpine

LABEL org.opencontainers.image.title="slovo-propovedi-docs" \
  org.opencontainers.image.description="Standalone Swagger UI + OpenAPI spec for the Slovo Propovedi API"

# Backend API hostname baked at build time; overridable via --build-arg.
# Feeds the nginx CSP connect-src allow-list only (openAPI.yaml's servers
# URL is intentionally left as a literal — see docker-compose.dev.yml,
# which mounts that file raw for local editing with no build step).
ARG BACKEND_API_HOSTNAME=api.slovo-propovedi.ru

COPY --from=swagger-ui-build /out/ /usr/share/nginx/html/
COPY index.html /usr/share/nginx/html/index.html
COPY openAPI.yaml /usr/share/nginx/html/openAPI.yaml
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Guard: bare hostname only — no protocol/scheme, no path, no trailing
# slash, no port (same check as slovo-propovedi-landing/Dockerfile).
RUN set -e; \
    if [ -z "$BACKEND_API_HOSTNAME" ] || ! printf '%s' "$BACKEND_API_HOSTNAME" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9.-]*[A-Za-z0-9]$|^[A-Za-z0-9]$'; then \
      echo "ERROR: BACKEND_API_HOSTNAME must be a bare hostname (no protocol/scheme, no path, no trailing slash, no port): '$BACKEND_API_HOSTNAME'" >&2; \
      exit 1; \
    fi

RUN sed -i "s|__BACKEND_API_HOSTNAME__|${BACKEND_API_HOSTNAME}|g" /etc/nginx/conf.d/default.conf && nginx -t

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
