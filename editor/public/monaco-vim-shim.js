/**
 * monaco-vim-shim.js — DEV ONLY. Minimal stand-in for the `monaco` global that
 * monaco-vim 0.4.4 expects, because swagger-editor v5.8.4 never exposes the real
 * Monaco API on the main thread:
 *
 *   - The app's editorSetup hook assigns BOTH `globalThis.editor` AND
 *     `globalThis.monaco` to the LIVE editor instance (not the API namespace).
 *   - The real `monaco` API (alias `@codingame/monaco-vscode-editor-api@36.0.0`,
 *     built on a VSCode 1.128.1 core) is only reachable inside workers.
 *
 * monaco-vim's UMD factory captures `global.monaco` AT LOAD TIME, so this script
 * MUST run before /monaco-vim.umd.js (patch-index.js guarantees the order).
 * It implements exactly the surface monaco-vim 0.4.4 consumes (verified against
 * the bundle): KeyCode, Position, Range, Selection, SelectionDirection and
 * editor.setTheme / EditorOption / TrackedRangeStickiness. Everything else
 * monaco-vim needs is self-bundled.
 *
 * Enum values follow the stable monaco-editor public API (0.33 → VSCode 1.128):
 * KeyCode, TrackedRangeStickiness (0..3) and SelectionDirection (LTR=0/RTL=1)
 * have never changed. The editor instance itself is patched separately by
 * save-bar.js (getConfiguration / getRawConfiguration / _getCursors) once the
 * editor is mounted.
 */
(function (global) {
  'use strict';

  // If a future build already exposes a real Monaco API on the main thread, keep
  // it — the shim is only for builds where window.monaco is absent or an editor
  // instance. Guarding prevents clobbering a genuine API.
  if (global.monaco && typeof global.monaco === 'object' && global.monaco.editor && global.monaco.KeyCode) {
    return;
  }

  var KEYCODES = {
    Backspace: 1, Tab: 2, Enter: 3, Shift: 4, Ctrl: 5, Alt: 6,
    PauseBreak: 7, CapsLock: 8, Escape: 9, Space: 10,
    PageUp: 11, PageDown: 12, End: 13, Home: 14,
    LeftArrow: 15, UpArrow: 16, RightArrow: 17, DownArrow: 18,
    Insert: 19, Delete: 20,
    KEY_0: 21, KEY_1: 22, KEY_2: 23, KEY_3: 24, KEY_4: 25,
    KEY_5: 26, KEY_6: 27, KEY_7: 28, KEY_8: 29, KEY_9: 30,
    KEY_A: 31, KEY_B: 32, KEY_C: 33, KEY_D: 34, KEY_E: 35,
    KEY_F: 36, KEY_G: 37, KEY_H: 38, KEY_I: 39, KEY_J: 40,
    KEY_K: 41, KEY_L: 42, KEY_M: 43, KEY_N: 44, KEY_O: 45,
    KEY_P: 46, KEY_Q: 47, KEY_R: 48, KEY_S: 49, KEY_T: 50,
    KEY_U: 51, KEY_V: 52, KEY_W: 53, KEY_X: 54, KEY_Y: 55,
    KEY_Z: 56, Meta: 57,
    F1: 58, F2: 59, F3: 60, F4: 61, F5: 62, F6: 63, F7: 64,
    F8: 65, F9: 66, F10: 67, F11: 68, F12: 69,
    Numpad0: 78, Numpad1: 79, Numpad2: 80, Numpad3: 81, Numpad4: 82,
    Numpad5: 83, Numpad6: 84, Numpad7: 85, Numpad8: 86, Numpad9: 87
  };

  // Forward AND reverse mapping, mirroring monaco's KeyCode enum object.
  var KeyCode = {};
  Object.keys(KEYCODES).forEach(function (name) {
    var value = KEYCODES[name];
    KeyCode[name] = value;
    KeyCode[value] = name;
  });

  function Position(lineNumber, column) {
    this.lineNumber = lineNumber;
    this.column = column;
  }
  Position.prototype.isBefore = function (other) {
    return this.lineNumber < other.lineNumber ||
      (this.lineNumber === other.lineNumber && this.column < other.column);
  };
  Position.prototype.isBeforeOrEqual = function (other) {
    return this.lineNumber < other.lineNumber ||
      (this.lineNumber === other.lineNumber && this.column <= other.column);
  };
  Position.prototype.isAfter = function (other) {
    return !this.isBeforeOrEqual(other);
  };
  Position.prototype.isAfterOrEqual = function (other) {
    return !this.isBefore(other);
  };
  Position.prototype.equals = function (other) {
    return !!other && this.lineNumber === other.lineNumber && this.column === other.column;
  };
  Position.prototype.compareTo = function (other) {
    if (this.lineNumber < other.lineNumber) return -1;
    if (this.lineNumber > other.lineNumber) return 1;
    if (this.column < other.column) return -1;
    if (this.column > other.column) return 1;
    return 0;
  };
  Position.prototype.delta = function (deltaLineNumber, deltaColumn) {
    return new Position(this.lineNumber + deltaLineNumber, this.column + deltaColumn);
  };
  Position.prototype.toString = function () {
    return '(' + this.lineNumber + ',' + this.column + ')';
  };

  function Range(startLineNumber, startColumn, endLineNumber, endColumn) {
    this.startLineNumber = startLineNumber;
    this.startColumn = startColumn;
    this.endLineNumber = endLineNumber;
    this.endColumn = endColumn;
  }
  Range.prototype.getStartPosition = function () {
    return new Position(this.startLineNumber, this.startColumn);
  };
  Range.prototype.getEndPosition = function () {
    return new Position(this.endLineNumber, this.endColumn);
  };
  Range.prototype.isEmpty = function () {
    return this.startLineNumber === this.endLineNumber && this.startColumn === this.endColumn;
  };
  Range.prototype.containsPosition = function (position) {
    if (position.lineNumber < this.startLineNumber || position.lineNumber > this.endLineNumber) return false;
    if (position.lineNumber === this.startLineNumber && position.column < this.startColumn) return false;
    if (position.lineNumber === this.endLineNumber && position.column > this.endColumn) return false;
    return true;
  };
  Range.prototype.equalsRange = function (other) {
    return !!other &&
      this.startLineNumber === other.startLineNumber &&
      this.startColumn === other.startColumn &&
      this.endLineNumber === other.endLineNumber &&
      this.endColumn === other.endColumn;
  };
  Range.fromPositions = function (start, end) {
    return new Range(start.lineNumber, start.column, end.lineNumber, end.column);
  };

  function Selection(startLineNumber, startColumn, endLineNumber, endColumn) {
    Range.call(this, startLineNumber, startColumn, endLineNumber, endColumn);
    this.selectionStartLineNumber = startLineNumber;
    this.selectionStartColumn = startColumn;
    this.positionLineNumber = endLineNumber;
    this.positionColumn = endColumn;
  }
  Selection.prototype = Object.create(Range.prototype);
  Selection.prototype.constructor = Selection;
  Selection.prototype.getPosition = function () {
    return new Position(this.positionLineNumber, this.positionColumn);
  };
  Selection.prototype.getSelectionStart = function () {
    return new Position(this.selectionStartLineNumber, this.selectionStartColumn);
  };
  Selection.prototype.getDirection = function () {
    return 0; // SelectionDirection.LTR
  };
  Selection.fromPositions = function (start, end) {
    return new Selection(start.lineNumber, start.column, end.lineNumber, end.column);
  };

  global.monaco = {
    KeyCode: KeyCode,
    Position: Position,
    Range: Range,
    Selection: Selection,
    SelectionDirection: { LTR: 0, RTL: 1 },
    editor: {
      // monaco.editor.setTheme(value) — route to the live editor's theme service
      // (looked up lazily because the shim loads before the editor mounts).
      setTheme: function (themeName) {
        var editor = global.editor;
        var themeService = editor && editor._standaloneThemeService;
        if (themeService && typeof themeService.setTheme === 'function') {
          try { themeService.setTheme(themeName); } catch (err) { /* no-op */ }
        }
      },
      // Only consulted if monaco-vim cannot call editor.getConfiguration() —
      // save-bar.js patches that method, so these are never read in practice.
      EditorOption: { readOnly: 65, cursorWidth: 20, fontInfo: 32 },
      TrackedRangeStickiness: {
        AlwaysGrowsWhenTypingAtEdges: 0,
        NeverGrowsWhenTypingAtEdges: 1,
        GrowsOnlyWhenTypingBefore: 2,
        GrowsOnlyWhenTypingAfter: 3
      }
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
