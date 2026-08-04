/**
 * save-bar.js — DEV ONLY floating control bar for the Swagger Editor.
 *
 * Adds two buttons ("Load from disk" / "Save to disk") and a status line.
 * Loads the current openAPI.yaml from GET /spec and writes the editor content
 * back to disk via PUT /spec. Served by the save-proxy (server.js) and injected
 * into the editor's index.html at build time by patch-index.js.
 *
 * Reading the editor text is done via a fallback chain (verified against the
 * official v5.8.4 bundle):
 *   1. window.editor.getValue()              — live Monaco instance. v5.8.4 sets
 *      globalThis.editor on mount (editorSetup hook), so this is the primary
 *      path that actually works.
 *   2. window.monaco.editor.getEditors()[0]  — works only when window.monaco is
 *      the standalone editor API (patch-index.js sets MonacoEnvironment.globalAPI).
 *   3. window.monaco.editor.getModels()[0]   — first attached model.
 *   4. localStorage["swagger-editor-content"]— editor-content-persistence plugin.
 */
(function () {
  'use strict';

  const SPEC_STORAGE_KEY = 'swagger-editor-content';

  function nowLabel() {
    return new Date().toLocaleTimeString();
  }

  function setStatus(message, isError) {
    const statusEl = document.getElementById('sp-status');
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.classList.toggle('sp-error', Boolean(isError));
  }

  function getEditorText() {
    // 1. Live editor instance exposed by v5.8.4 (editorSetup sets globalThis.editor).
    if (window.editor && typeof window.editor.getValue === 'function') {
      const value = window.editor.getValue();
      if (typeof value === 'string' && value.length > 0) return value;
    }

    const editorApi = window.monaco && window.monaco.editor;

    // 2. Live editor instance (standalone API path).
    if (editorApi && editorApi.getEditors) {
      const editors = editorApi.getEditors();
      if (editors && editors.length > 0) {
        const value = editors[0].getValue();
        if (typeof value === 'string' && value.length > 0) return value;
      }
    }

    // 3. First attached model.
    if (editorApi && editorApi.getModels) {
      const models = editorApi.getModels();
      if (models && models.length > 0) {
        const value = models[0].getValue();
        if (typeof value === 'string' && value.length > 0) return value;
      }
    }

    // 4. Content persisted by the editor-content-persistence plugin.
    const stored = window.localStorage && window.localStorage.getItem(SPEC_STORAGE_KEY);
    if (typeof stored === 'string' && stored.length > 0) return stored;

    throw new Error(
      'Cannot read the editor content. Use the editor\'s "File → Save as YAML" download and replace openAPI.yaml manually.'
    );
  }

  function setEditorText(text) {
    if (window.editor && typeof window.editor.setValue === 'function') {
      window.editor.setValue(text);
      return;
    }
    const editorApi = window.monaco && window.monaco.editor;
    if (!editorApi || !editorApi.getEditors) {
      throw new Error('Monaco editor API is not available.');
    }
    const editors = editorApi.getEditors();
    if (!editors || editors.length === 0) {
      throw new Error('No Monaco editor instance found.');
    }
    editors[0].setValue(text);
  }

  function waitForMonaco(callback) {
    const POLL_MS = 200;
    const MAX_TRIES = 150;
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      const instanceReady =
        window.editor && typeof window.editor.getValue === 'function';
      const apiReady =
        window.monaco && window.monaco.editor && window.monaco.editor.getEditors
          ? window.monaco.editor.getEditors().length > 0
          : false;
      if (instanceReady || apiReady) {
        clearInterval(timer);
        callback(null);
        return;
      }
      if (tries >= MAX_TRIES) {
        clearInterval(timer);
        callback(new Error('Monaco editor did not initialize within 30 seconds.'));
      }
    }, POLL_MS);
  }

  function fetchSpec() {
    return fetch('/spec').then((res) => {
      if (!res.ok) throw new Error('GET /spec failed: HTTP ' + res.status);
      return res.text();
    });
  }

  function putSpec(yamlText) {
    return fetch('/spec', {
      method: 'PUT',
      headers: { 'Content-Type': 'text/plain' },
      body: yamlText,
    })
      .then((res) =>
        res
          .json()
          .catch(() => null)
          .then((data) => {
            if (!res.ok) {
              const detail = data && data.error ? ': ' + data.error : ' (HTTP ' + res.status + ')';
              throw new Error('PUT /spec failed' + detail);
            }
            return data;
          })
      );
  }

  function loadFromDisk() {
    setStatus('loading…');
    return fetchSpec()
      .then((yaml) => {
        setEditorText(yaml);
        setStatus('loaded openAPI.yaml @ ' + nowLabel());
      })
      .catch((err) => setStatus(err.message, true));
  }

  function saveToDisk() {
    setStatus('saving…');
    let yamlText;
    try {
      yamlText = getEditorText();
    } catch (err) {
      setStatus(err.message, true);
      return;
    }
    putSpec(yamlText)
      .then((result) =>
        setStatus('saved ' + result.bytes + ' bytes → openAPI.yaml @ ' + nowLabel())
      )
      .catch((err) => setStatus(err.message, true));
  }

  function createControlBar() {
    const style = document.createElement('style');
    style.textContent = [
      '#sp-control-bar {',
      '  position: fixed;',
      '  top: 12px;',
      '  right: 12px;',
      '  z-index: 99999;',
      '  display: flex;',
      '  align-items: center;',
      '  gap: 8px;',
      '  padding: 8px 12px;',
      '  background: rgba(30, 34, 44, 0.92);',
      '  border: 1px solid rgba(255, 255, 255, 0.15);',
      '  border-radius: 8px;',
      '  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);',
      '  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;',
      '  font-size: 13px;',
      '  color: #f5f6f8;',
      '}',
      '#sp-control-bar button {',
      '  font: inherit;',
      '  color: #1e222c;',
      '  background: #f5f6f8;',
      '  border: none;',
      '  border-radius: 5px;',
      '  padding: 5px 12px;',
      '  cursor: pointer;',
      '}',
      '#sp-control-bar button:hover { background: #ffffff; }',
      '#sp-status { max-width: 420px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
      '#sp-status.sp-error { color: #ff7b72; }',
    ].join('\n');
    document.head.appendChild(style);

    const bar = document.createElement('div');
    bar.id = 'sp-control-bar';
    bar.innerHTML =
      '<button id="sp-load" type="button">Load from disk</button>' +
      '<button id="sp-save" type="button">Save to disk</button>' +
      '<span id="sp-status"></span>';
    document.body.appendChild(bar);
  }

  window.addEventListener('DOMContentLoaded', () => {
    createControlBar();
    document.getElementById('sp-load').addEventListener('click', loadFromDisk);
    document.getElementById('sp-save').addEventListener('click', saveToDisk);
    waitForMonaco((err) => {
      if (err) {
        setStatus(err.message, true);
        return;
      }
      loadFromDisk();
    });
  });
})();
