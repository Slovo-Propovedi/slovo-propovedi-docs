# DEV ONLY — do not use in production. See docker-compose.dev.yml.
# This image runs the official Swagger Editor v5 SPA behind a small Node
# save-proxy so edits can be written back to the bind-mounted openAPI.yaml.
# The production image (repo root Dockerfile) is unaffected by this file.

# ---------------------------------------------------------------------------
# Stage 1: official working v5 editor assets (guaranteed-good build)
# ---------------------------------------------------------------------------
FROM swaggerapi/swagger-editor:v5.8.4 AS editor-assets

# ---------------------------------------------------------------------------
# Stage 2: save-proxy + patched editor SPA
# ---------------------------------------------------------------------------
FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Copy the full working v5 SPA from the official image
COPY --from=editor-assets /usr/share/nginx/html ./public/editor

# Our save-bar script
COPY public/save-bar.js ./public/editor/save-bar.js

# Patch the editor index.html (expose window.monaco + load our save-bar)
COPY patch-index.js ./
RUN node patch-index.js ./public/editor/index.html

COPY server.js ./

EXPOSE 8081

CMD ["node", "server.js"]
