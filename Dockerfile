# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Stage 1: build — download the swagger-ui-dist static assets
# ---------------------------------------------------------------------------
FROM node:20-alpine AS swagger-ui-build

ARG SWAGGER_UI_VERSION=5.32.12

WORKDIR /build

RUN npm install "swagger-ui-dist@${SWAGGER_UI_VERSION}" --no-save --no-package-lock \
    && mkdir -p /out \
    && cp -a node_modules/swagger-ui-dist/. /out/

# ---------------------------------------------------------------------------
# Stage 2: runtime — nginx serving static files only (no Node.js runtime)
# ---------------------------------------------------------------------------
FROM nginx:alpine

LABEL org.opencontainers.image.title="slovo-propovedi-swagger" \
      org.opencontainers.image.description="Standalone Swagger UI + OpenAPI spec for the Slovo Propovedi Admin API"

COPY --from=swagger-ui-build /out/ /usr/share/nginx/html/
COPY index.html /usr/share/nginx/html/index.html
COPY openAPI.yaml /usr/share/nginx/html/openAPI.yaml
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -q -O /dev/null http://localhost:8080/ || exit 1
