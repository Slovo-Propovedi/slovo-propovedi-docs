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
 *
 * Vim mode (dev only): monaco-vim 0.4.4 (monaco-vim.umd.js + the API shim
 * monaco-vim-shim.js) is injected by patch-index.js as classic scripts, with the
 * shim BEFORE the UMD (the UMD captures window.monaco at load time). The shim is
 * required because v5.8.4's window.monaco ends up being the live editor instance,
 * not the monaco API. This file starts vim mode once the editor is mounted,
 * wires the :w ex command to saveToDisk(), and adds a "Vim: on/off" toggle
 * (persisted in localStorage under 'sp-vim-enabled', default on).
 */
(function () {
  'use strict';

  const SPEC_STORAGE_KEY = 'swagger-editor-content';
  const VIM_PREF_KEY = 'sp-vim-enabled';

  let vimDisposable = null;
  let vimStatusEl = null;
  let vimToggleBtn = null;

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

  function getEditorInstance() {
    // The live editor instance: v5.8.4's editorSetup hook sets globalThis.editor
    // (and globalThis.monaco) when the 'monaco' editor mounts. Fall back to the
    // standalone API's getEditors() for robustness, like the other helpers.
    if (window.editor && typeof window.editor.getValue === 'function') return window.editor;
    const editorApi = window.monaco && window.monaco.editor;
    if (editorApi && typeof editorApi.getEditors === 'function') {
      const editors = editorApi.getEditors();
      if (editors && editors.length > 0) return editors[0];
    }
    return null;
  }

  function waitForMonaco(callback) {
    const POLL_MS = 200;
    const MAX_TRIES = 150;
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      // Wait ONLY for the live editor instance. Deliberately NOT the standalone
      // API's getEditors(): with globalAPI:true the real monaco API appears on
      // window.monaco BEFORE editorSetup assigns window.editor, and resolving on
      // apiReady there races vim init against an editor that is not mounted yet.
      const instanceReady =
        window.editor && typeof window.editor.getValue === 'function';
      if (instanceReady) {
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

  // ===== Vim mode (monaco-vim 0.4.4) =====
  //
  // The official v5.8.4 bundle never exposes a real monaco API on the main
  // thread: `window.monaco` is the LIVE editor instance (editorSetup hook), so
  // monaco-vim's shim (monaco-vim-shim.js, loaded before the UMD) supplies the
  // small API surface it needs. The editor instance itself lacks a few methods
  // monaco-vim calls — patchEditorForVim adds them.

  function patchEditorForVim(editor) {
    if (typeof editor.getConfiguration !== 'function') {
      editor.getConfiguration = function () {
        const model = editor.getModel();
        const opts = model ? model.getOptions() : {};
        return {
          readOnly: false,
          viewInfo: { cursorWidth: 2 },
          fontInfo: {
            typicalFullwidthCharacterWidth: 7,
            lineHeight: opts.lineHeight || 18,
          },
        };
      };
    }
    if (typeof editor.getRawConfiguration !== 'function') {
      editor.getRawConfiguration = function () {
        const model = editor.getModel();
        const opts = model ? model.getOptions() : {};
        return {
          tabSize: opts.tabSize || 2,
          indentSize: opts.indentSize || 2,
          insertSpaces: opts.insertSpaces !== false,
          indentWithTabs: opts.insertSpaces === false,
          keyMap: 'vim',
          mode: 'vim',
          pcre: false,
          theme: undefined,
          insertModeEscKeysTimeout: 200,
        };
      };
    }
    // Only used by `>>` / `<<` (indent commands).
    if (typeof editor._getCursors !== 'function') {
      editor._getCursors = function () {
        const model = editor.getModel();
        const opts = model ? model.getOptions() : {};
        return {
          context: {
            config: {
              tabSize: opts.tabSize || 2,
              indentSize: opts.indentSize || 2,
              insertSpaces: opts.insertSpaces !== false,
              useTabStops: false,
              autoIndent: false,
            },
          },
        };
      };
    }
  }

  function updateVimToggle() {
    if (!vimToggleBtn) return;
    const on = Boolean(vimDisposable);
    vimToggleBtn.textContent = 'Vim: ' + (on ? 'on' : 'off');
    vimToggleBtn.classList.toggle('sp-active', on);
  }

  function startVimMode() {
    if (vimDisposable) return;
    if (!window.MonacoVim || typeof window.MonacoVim.initVimMode !== 'function') {
      setStatus('Vim: monaco-vim not loaded (check /monaco-vim.umd.js)', true);
      updateVimToggle();
      return;
    }
    const editor = getEditorInstance();
    if (!editor) {
      setStatus('Vim init failed: editor instance not ready yet.', true);
      updateVimToggle();
      return;
    }
    try {
      patchEditorForVim(editor);
      // Wire the :w ex command to the existing save-to-disk flow.
      window.MonacoVim.VimMode.commands.save = function () {
        saveToDisk();
      };
      vimDisposable = window.MonacoVim.initVimMode(editor, vimStatusEl);
    } catch (err) {
      vimDisposable = null;
      setStatus('Vim init failed: ' + err.message, true);
      updateVimToggle();
      return;
    }
    updateVimToggle();
  }

  function stopVimMode() {
    if (vimDisposable) {
      vimDisposable.dispose();
      vimDisposable = null;
    }
    updateVimToggle();
  }

  function toggleVimMode() {
    const enable = !vimDisposable;
    if (enable) startVimMode();
    else stopVimMode();
    localStorage.setItem(VIM_PREF_KEY, enable ? '1' : '0');
  }

  function startVimModeIfPreferred() {
    if (localStorage.getItem(VIM_PREF_KEY) === '0') {
      updateVimToggle();
      return;
    }
    startVimMode();
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
      // Vim-armed state: a committed amber accent on the toggle button only.
      '#sp-control-bar button.sp-active {',
      '  background: #f0b429;',
      '  color: #1e222c;',
      '  font-weight: 600;',
      '}',
      '#sp-control-bar button.sp-active:hover { background: #f5c244; }',
      '#sp-status { max-width: 420px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
      '#sp-status.sp-error { color: #ff7b72; }',
      // Vim status/command bar (bottom-left). monaco-vim toggles display itself.
      '#sp-vim-status {',
      '  position: fixed;',
      '  bottom: 12px;',
      '  left: 12px;',
      '  z-index: 99999;',
      '  display: none;',
      '  font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;',
      '  font-size: 12px;',
      '  color: #f5f6f8;',
      '  background: rgba(30, 34, 44, 0.92);',
      '  border: 1px solid rgba(255, 255, 255, 0.15);',
      '  border-radius: 6px;',
      '  padding: 4px 10px;',
      '  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);',
      '  white-space: nowrap;',
      '}',
      '#sp-vim-status input {',
      '  background: #14171f;',
      '  color: #f5f6f8;',
      '  border: 1px solid rgba(255, 255, 255, 0.25);',
      '  border-radius: 3px;',
      '  font: inherit;',
      '  margin-left: 4px;',
      '  padding: 1px 4px;',
      '  outline: none;',
      '}',
      '#sp-vim-status .vim-notification { color: #ffb454; margin-left: 8px; }',
    ].join('\n');
    document.head.appendChild(style);

    const bar = document.createElement('div');
    bar.id = 'sp-control-bar';
    bar.innerHTML =
      '<button id="sp-load" type="button">Load from disk</button>' +
      '<button id="sp-save" type="button">Save to disk</button>' +
      '<button id="sp-vim-toggle" type="button" title="Toggle Vim keybindings">Vim: off</button>' +
      '<span id="sp-status"></span>';
    document.body.appendChild(bar);

    vimStatusEl = document.createElement('div');
    vimStatusEl.id = 'sp-vim-status';
    document.body.appendChild(vimStatusEl);
  }

  window.addEventListener('DOMContentLoaded', () => {
    createControlBar();
    vimToggleBtn = document.getElementById('sp-vim-toggle');
    document.getElementById('sp-load').addEventListener('click', loadFromDisk);
    document.getElementById('sp-save').addEventListener('click', saveToDisk);
    vimToggleBtn.addEventListener('click', toggleVimMode);
    waitForMonaco((err) => {
      if (err) {
        setStatus(err.message, true);
        return;
      }
      // Start vim only after the disk content is loaded, so the editor
      // instance is fully mounted and stable when initVimMode attaches.
      loadFromDisk().then(startVimModeIfPreferred, startVimModeIfPreferred);
    });
  });
})();
