'use strict';

/**
 * patch-index.js — build-time patcher for the official Swagger Editor index.html.
 *
 * Three targeted edits, nothing else:
 *  1. Sets MonacoEnvironment.globalAPI = true. Without it the official v5.8.4
 *     bundle never assigns window.monaco (it only does so when globalAPI is set
 *     or an AMD loader exists), so save-bar.js could not read the editor text.
 *  2. Injects <script src="/monaco-vim-shim.js"> + <script src="/monaco-vim.umd.js">
 *     right before </body>. ORDER MATTERS: the monaco-vim UMD captures
 *     `global.monaco` at load time, and swagger-editor v5.8.4 never exposes the
 *     real monaco API on the main thread — so the shim must define `window.monaco`
 *     first. save-bar.js then inits vim mode once the editor is mounted.
 *  3. Injects <script src="/save-bar.js"></script> right before </body>.
 *
 * Usage: node patch-index.js <path-to-index.html>
 */

const fs = require('node:fs');

const MONACO_ENV_PATTERN = /window\.MonacoEnvironment\s*=\s*\{/;
const SAVE_BAR_TAG = '<script src="/save-bar.js"></script>';
const VIM_SHIM_TAG = '<script src="/monaco-vim-shim.js"></script>';
const VIM_UMD_TAG = '<script src="/monaco-vim.umd.js"></script>';

function main() {
  const indexPath = process.argv[2];

  if (!indexPath) {
    console.error('Usage: node patch-index.js <path-to-index.html>');
    process.exit(1);
  }

  let html;
  try {
    html = fs.readFileSync(indexPath, 'utf8');
  } catch (err) {
    console.error(`patch-index: failed to read ${indexPath}: ${err.message}`);
    process.exit(1);
  }

  // --- Edit 1: expose the monaco API via MonacoEnvironment.globalAPI ---
  if (html.includes(SAVE_BAR_TAG) && html.includes(VIM_SHIM_TAG) && html.includes(VIM_UMD_TAG)) {
    console.log(`patch-index: ${indexPath} already patched, skipping.`);
    return;
  }

  if (MONACO_ENV_PATTERN.test(html)) {
    html = html.replace(MONACO_ENV_PATTERN, 'window.MonacoEnvironment = { globalAPI: true,');
    console.log('patch-index: added globalAPI: true to MonacoEnvironment.');
  } else if (!html.includes('globalAPI')) {
    console.warn(
      'patch-index: WARNING MonacoEnvironment block not found; window.monaco may stay unavailable.'
    );
  }

  // --- Edits 2 & 3: inject the vim scripts + save-bar before </body> ---
  const closingTags = [];
  if (!html.includes(SAVE_BAR_TAG)) closingTags.push(SAVE_BAR_TAG);
  if (!(html.includes(VIM_SHIM_TAG) && html.includes(VIM_UMD_TAG))) {
    if (html.includes(VIM_SHIM_TAG) !== html.includes(VIM_UMD_TAG)) {
      console.warn(
        'patch-index: WARNING only one vim script tag present; re-injecting both.'
      );
    }
    closingTags.push(VIM_SHIM_TAG, VIM_UMD_TAG);
  }

  if (closingTags.length > 0) {
    const block = closingTags.join('\n');
    if (html.includes('</body>')) {
      html = html.replace('</body>', `${block}\n</body>`);
    } else if (html.includes('</html>')) {
      html = html.replace('</html>', `${block}\n</html>`);
    } else {
      html += block;
    }
  }

  fs.writeFileSync(indexPath, html, 'utf8');
  console.log(`patch-index: injected scripts into ${indexPath}.`);
}

main();
