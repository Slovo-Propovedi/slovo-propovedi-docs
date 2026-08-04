'use strict';

const express = require('express');
const fs = require('node:fs/promises');
const path = require('node:path');

const PORT = Number(process.env.PORT ?? 8081);
const SPEC_PATH = process.env.SPEC_PATH ?? '/spec/openAPI.yaml';
const EDITOR_DIR = path.join(__dirname, 'public', 'editor');

// Fail fast on a misconfigured port before we start listening.
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error(`Invalid PORT env value: ${process.env.PORT}`);
}

const app = express();

// Accept the PUT body as plain text (the save-bar sends Content-Type: text/plain).
app.use(express.text({ type: '*/*', limit: '20mb' }));

// GET /spec — return the current spec from disk.
app.get('/spec', async (_req, res) => {
  try {
    const yaml = await fs.readFile(SPEC_PATH, 'utf8');
    res.type('yaml').send(yaml);
  } catch (err) {
    res.status(500).type('text/plain').send(`Failed to read ${SPEC_PATH}: ${err.message}`);
  }
});

// PUT /spec — write the request body back to the spec file on disk.
app.put('/spec', async (req, res) => {
  if (typeof req.body !== 'string' || req.body.trim().length === 0) {
    return res.status(400).json({ ok: false, error: 'empty body — refusing to overwrite openAPI.yaml' });
  }
  const yamlText = req.body;
  try {
    await fs.writeFile(SPEC_PATH, yamlText, 'utf8');
    res.json({ ok: true, bytes: Buffer.byteLength(yamlText, 'utf8') });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Serve the (build-time patched) Swagger Editor SPA at the root.
app.use(express.static(EDITOR_DIR));

// Warn loudly on a missing bind mount (don't crash — keep the editor up for debugging).
async function warnIfSpecUnreadable() {
  try {
    await fs.access(SPEC_PATH);
  } catch (err) {
    console.warn(`[openapi-editor] WARNING: cannot read ${SPEC_PATH} (${err.message})`);
    console.warn('[openapi-editor]   Start with: docker compose -f docker-compose.dev.yml up --build');
  }
}

warnIfSpecUnreadable().then(() => {
  app.listen(PORT, () => {
    console.log(`[openapi-editor] Swagger Editor (dev) listening on http://localhost:${PORT}`);
    console.log(`[openapi-editor] GET/PUT /spec -> ${SPEC_PATH}`);
  });
});
