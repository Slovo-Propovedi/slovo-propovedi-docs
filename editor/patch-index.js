'use strict';

/**
 * patch-index.js — build-time patcher for the official Swagger Editor index.html.
 *
 * Two targeted edits, nothing else:
 *  1. Sets MonacoEnvironment.globalAPI = true. Without it the official v5.8.4
 *     bundle never assigns window.monaco (it only does so when globalAPI is set
 *     or an AMD loader exists), so save-bar.js could not read the editor text.
 *  2. Injects <script src="/save-bar.js"></script> right before </body>.
 *
 * Usage: node patch-index.js <path-to-index.html>
 */

const fs = require('node:fs');

const MONACO_ENV_PATTERN = /window\.MonacoEnvironment\s*=\s*\{/;
const SAVE_BAR_TAG = '<script src="/save-bar.js"></script>';

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

  if (html.includes(SAVE_BAR_TAG)) {
    console.log(`patch-index: ${indexPath} already patched, skipping.`);
    return;
  }

  if (MONACO_ENV_PATTERN.test(html)) {
    html = html.replace(MONACO_ENV_PATTERN, 'window.MonacoEnvironment = { globalAPI: true,');
    console.log('patch-index: added globalAPI: true to MonacoEnvironment.');
  } else {
    console.warn(
      'patch-index: WARNING MonacoEnvironment block not found; window.monaco may stay unavailable.'
    );
  }

  if (html.includes('</body>')) {
    html = html.replace('</body>', `${SAVE_BAR_TAG}\n</body>`);
  } else if (html.includes('</html>')) {
    html = html.replace('</html>', `${SAVE_BAR_TAG}\n</html>`);
  } else {
    html += SAVE_BAR_TAG;
  }

  fs.writeFileSync(indexPath, html, 'utf8');
  console.log(`patch-index: injected save-bar script into ${indexPath}.`);
}

main();
