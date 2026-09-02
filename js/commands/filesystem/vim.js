import { BaseEditor, runEditor } from '../../utils/editor.js?v=f953213602';
import { audio } from '../../audio.js?v=928da0a483';

export const vim = {
  name: 'vim',
  description: 'Edit a text file using the vim terminal editor.',
  category: 'filesystem',
  lazy: true,
  args: [
    { name: 'filename', description: 'File to edit or create.', required: true }
  ],
  run: async (args, shell) => {
    return runEditor(VimEditor, args, 'vim', shell);
  }
};

class VimEditor extends BaseEditor {
  static yankBuffer = '';
  static isLineYank = false;

  constructor(shell, filename, initialContent, resolvedPath, onSave, onExit, isNewFile) {
    super(shell, filename, initialContent, resolvedPath, onSave, onExit, isNewFile);

    // Modes: 'NORMAL', 'INSERT', 'COMMAND_LINE', 'VISUAL'
    this.mode = 'NORMAL';
    this.previousMode = 'NORMAL';
    this.commandText = '';
    this.statusMessage = isNewFile ? `"${filename}" [New File]` : `"${filename}"`;
    this.statusTimeout = null;
    this.undoStack = [];
    this.redoStack = [];
    this.textBeforeInsert = null;
    this.lastKeyPressed = '';
    this.isWaitingForReplaceChar = false;
    this.searchQuery = '';
    this.searchDirection = 1; // 1 = forward (/), -1 = backward (?)
    this.visualAnchor = null;
    this.visualCursor = null;
    this.lineJumpCount = '';
  }

  start() {
    this.initDOM('vim-editor');
    super.start('.vim-content', '.vim-line', '<span class="vim-lnum">  1</span><span>&nbsp;</span>');
  }

  cleanup() {
    super.cleanup();
    if (this.statusTimeout) clearTimeout(this.statusTimeout);
  }

  showStatus(msg) {
    this.statusMessage = msg;
    this.draw();
    if (this.statusTimeout) clearTimeout(this.statusTimeout);
    this.statusTimeout = setTimeout(() => {
      this.statusMessage = '';
      this.draw();
    }, 4000);
  }

  moveCursor(dir, allowLineEnd = false) {
    const { rawLines, curLine, curCol } = this.getLinesAndCursor();
    const lineLen = rawLines[curLine] ? rawLines[curLine].length : 0;
    let newCol = curCol + dir;

    const maxCol = allowLineEnd ? lineLen : Math.max(0, lineLen - 1);
    newCol = Math.max(0, Math.min(maxCol, newCol));

    let newIdx = 0;
    for (let i = 0; i < curLine; i++) {
      newIdx += rawLines[i].length + 1;
    }
    newIdx += newCol;

    this.textarea.selectionStart = newIdx;
    this.textarea.selectionEnd = newIdx;
  }

  moveLine(dir) {
    const { rawLines, curLine, curCol } = this.getLinesAndCursor();
    const targetLine = curLine + dir;

    if (targetLine >= 0 && targetLine < rawLines.length) {
      const lineLen = rawLines[targetLine].length;
      const maxCol = Math.max(0, lineLen - 1);
      const targetCol = Math.min(curCol, maxCol);
      let newIdx = 0;
      for (let i = 0; i < targetLine; i++) {
        newIdx += rawLines[i].length + 1;
      }
      newIdx += targetCol;
      this.textarea.selectionStart = newIdx;
      this.textarea.selectionEnd = newIdx;
    }
  }

  moveWord(dir) {
    const val = this.textarea.value;
    let idx = this.textarea.selectionStart;

    const isAlphanumeric = (c) => /[a-zA-Z0-9_]/.test(c);
    const isWhitespace = (c) => /\s/.test(c);

    if (dir === 1) { // w
      if (idx >= val.length) return;
      const startClass = isAlphanumeric(val[idx]) ? 1 : (isWhitespace(val[idx]) ? 0 : 2);

      if (startClass !== 0) {
        while (idx < val.length) {
          const curClass = isAlphanumeric(val[idx]) ? 1 : (isWhitespace(val[idx]) ? 0 : 2);
          if (curClass !== startClass) break;
          idx++;
        }
      }
      while (idx < val.length && isWhitespace(val[idx])) {
        idx++;
      }
    } else { // b
      if (idx <= 0) return;
      idx--;
      while (idx > 0 && isWhitespace(val[idx])) {
        idx--;
      }
      const targetClass = isAlphanumeric(val[idx]) ? 1 : (isWhitespace(val[idx]) ? 0 : 2);
      while (idx > 0) {
        const prevChar = val[idx - 1];
        const prevClass = isAlphanumeric(prevChar) ? 1 : (isWhitespace(prevChar) ? 0 : 2);
        if (prevClass !== targetClass) break;
        idx--;
      }
    }

    this.textarea.selectionStart = this.textarea.selectionEnd = idx;
  }

  async writeToClipboard(text, isLine) {
    VimEditor.yankBuffer = text;
    VimEditor.isLineYank = isLine;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      }
    } catch (err) {
      // Fall back to internal buffer quietly
    }
  }

  async handlePut(key) {
    let clipText = VimEditor.yankBuffer;
    let isLine = VimEditor.isLineYank;

    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const systemText = await navigator.clipboard.readText();
        if (systemText) {
          clipText = systemText;
          isLine = systemText.endsWith('\n');
        }
      }
    } catch (err) {
      // Fall back to internal buffer quietly
    }

    if (!clipText) return;

    this.pushUndoState();
    const val = this.textarea.value;
    const selStart = this.textarea.selectionStart;

    if (isLine) {
      const { rawLines, curLine } = this.getLinesAndCursor();
      const insertLine = key === 'p' ? curLine + 1 : curLine;
      let insertIdx = 0;
      for (let i = 0; i < insertLine && i < rawLines.length; i++) {
        insertIdx += rawLines[i].length + 1;
      }
      this.textarea.value = val.slice(0, insertIdx) + clipText + val.slice(insertIdx);
      this.textarea.selectionStart = this.textarea.selectionEnd = insertIdx;
    } else {
      const insertIdx = key === 'p' ? selStart + 1 : selStart;
      this.textarea.value = val.slice(0, insertIdx) + clipText + val.slice(insertIdx);
      this.textarea.selectionStart = this.textarea.selectionEnd = insertIdx + clipText.length;
    }
    this.draw();
  }

  pushUndoState() {
    this.undoStack.push({
      value: this.textarea.value,
      selStart: this.textarea.selectionStart,
      selEnd: this.textarea.selectionEnd
    });
    if (this.undoStack.length > 50) {
      this.undoStack.shift();
    }
    this.redoStack = [];
  }

  getLinesAndCursor() {
    const text = this.textarea.value;
    const activeIdx = this.mode === 'VISUAL' ? (this.visualCursor ?? this.textarea.selectionStart) : this.textarea.selectionStart;
    const selStart = this.textarea.selectionStart;
    const selEnd = this.textarea.selectionEnd;

    let rawLines = text.split('\n');
    if (rawLines.length > 1 && rawLines[rawLines.length - 1] === '' && activeIdx < text.length) {
      rawLines.pop();
    }
    let curLine = 0;
    let curCol = 0;

    let currentIdx = 0;
    for (let i = 0; i < rawLines.length; i++) {
      const lineLen = rawLines[i].length;
      if (activeIdx >= currentIdx && activeIdx <= currentIdx + lineLen) {
        curLine = i;
        curCol = activeIdx - currentIdx;
        break;
      }
      currentIdx += lineLen + 1;
    }

    return {
      rawLines,
      curLine,
      curCol,
      selStart,
      selEnd,
      totalLines: rawLines.length,
      totalChars: text.length
    };
  }

  positionCursorOnFirstNonWhitespace(lineIndex) {
    const { rawLines } = this.getLinesAndCursor();
    const targetLine = Math.max(0, Math.min(rawLines.length - 1, lineIndex));
    const lineText = rawLines[targetLine] || '';
    
    let col = 0;
    while (col < lineText.length && /\s/.test(lineText[col])) {
      col++;
    }
    if (col >= lineText.length) {
      col = Math.max(0, lineText.length - 1);
    }
    
    let idx = 0;
    for (let i = 0; i < targetLine; i++) {
      idx += rawLines[i].length + 1;
    }
    idx += col;
    
    this.textarea.selectionStart = this.textarea.selectionEnd = idx;
  }

  setVisualSelection(anchor, cursor) {
    this.visualCursor = cursor;
    const start = Math.min(anchor, cursor);
    const end = Math.max(anchor, cursor) + 1;
    this.textarea.selectionStart = start;
    this.textarea.selectionEnd = Math.min(this.textarea.value.length, end);
  }

  performSearch(text, direction) {
    if (!text) return;
    const val = this.textarea.value;
    const lowerVal = val.toLowerCase();
    const query = text.toLowerCase();
    const activeIdx = this.mode === 'VISUAL' ? (this.visualCursor ?? this.textarea.selectionStart) : this.textarea.selectionStart;

    if (direction === 1) {
      let idx = lowerVal.indexOf(query, activeIdx + 1);
      if (idx !== -1) {
        this.textarea.selectionStart = this.textarea.selectionEnd = idx;
        if (this.mode === 'VISUAL') {
          this.setVisualSelection(this.visualAnchor, idx);
        }
        this.showStatus(`Search: /${text}`);
      } else {
        idx = lowerVal.indexOf(query);
        if (idx !== -1) {
          this.textarea.selectionStart = this.textarea.selectionEnd = idx;
          if (this.mode === 'VISUAL') {
            this.setVisualSelection(this.visualAnchor, idx);
          }
          this.showStatus('search hit BOTTOM, continuing at TOP');
        } else {
          this.showStatus(`Pattern not found: ${text}`);
        }
      }
    } else {
      let idx = lowerVal.lastIndexOf(query, activeIdx - 1);
      if (idx !== -1) {
        this.textarea.selectionStart = this.textarea.selectionEnd = idx;
        if (this.mode === 'VISUAL') {
          this.setVisualSelection(this.visualAnchor, idx);
        }
        this.showStatus(`Search: ?${text}`);
      } else {
        idx = lowerVal.lastIndexOf(query);
        if (idx !== -1) {
          this.textarea.selectionStart = this.textarea.selectionEnd = idx;
          if (this.mode === 'VISUAL') {
            this.setVisualSelection(this.visualAnchor, idx);
          }
          this.showStatus('search hit TOP, continuing at BOTTOM');
        } else {
          this.showStatus(`Pattern not found: ${text}`);
        }
      }
    }
    this.draw();
  }

  escapeLine(lineStr, lineStartIdx, selStart, selEnd) {
    if (this.mode !== 'VISUAL') {
      return super.escapeLine(lineStr, lineStartIdx, selStart, selEnd);
    }
    
    const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const lineEndIdx = lineStartIdx + lineStr.length;
    
    const s = Math.min(selStart, selEnd);
    const e = Math.max(selStart, selEnd);
    
    const cursorIdx = this.visualCursor;
    if (cursorIdx === lineStartIdx && lineStartIdx === lineEndIdx) {
      return `<span class="terminal-cursor"> </span>`;
    }
    
    const overlapStart = Math.max(s, lineStartIdx);
    const overlapEnd = Math.min(e, lineEndIdx);
    
    if (overlapStart >= overlapEnd) {
      return escape(lineStr);
    }
    
    const relStart = overlapStart - lineStartIdx;
    const relEnd = overlapEnd - lineStartIdx;
    
    const before = lineStr.slice(0, relStart);
    const selected = lineStr.slice(relStart, relEnd);
    const after = lineStr.slice(relEnd);
    
    if (cursorIdx === lineEndIdx) {
      if (e >= lineEndIdx) {
        return escape(before) + `<span class="terminal-selection">${escape(selected)}</span>` + `<span class="terminal-cursor"> </span>` + escape(after);
      }
    }
    
    if (cursorIdx >= lineStartIdx && cursorIdx < lineEndIdx) {
      const relCursor = cursorIdx - lineStartIdx;
      const cursorColInSelected = relCursor - relStart;
      const selBeforeCursor = selected.slice(0, cursorColInSelected);
      const charAtCursor = selected.slice(cursorColInSelected, cursorColInSelected + 1) || ' ';
      const selAfterCursor = selected.slice(cursorColInSelected + 1);
      
      return escape(before) +
        `<span class="terminal-selection">${escape(selBeforeCursor)}</span>` +
        `<span class="terminal-cursor">${escape(charAtCursor)}</span>` +
        `<span class="terminal-selection">${escape(selAfterCursor)}</span>` +
        escape(after);
    }
    
    return escape(before) + `<span class="terminal-selection">${escape(selected)}</span>` + escape(after);
  }

  handleKeydown(e) {
    const ignoredKeys = ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'];
    if (!ignoredKeys.includes(e.key) && !e.repeat) {
      audio.playKeyclick(e.key);
    }

    if (this.mode === 'NORMAL' || this.mode === 'VISUAL') {
      e.preventDefault();

      if (this.mode === 'NORMAL' && this.isWaitingForReplaceChar) {
        this.isWaitingForReplaceChar = false;
        if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
          this.pushUndoState();
          const val = this.textarea.value;
          const idx = this.textarea.selectionStart;
          if (idx < val.length && val[idx] !== '\n') {
            this.textarea.value = val.slice(0, idx) + e.key + val.slice(idx + 1);
            this.textarea.selectionStart = this.textarea.selectionEnd = idx;
            this.draw();
          }
        }
        return;
      }

      const key = e.key;
      const lowerKey = key.toLowerCase();

      // Control Key Combinations
      if (e.ctrlKey) {
        if (lowerKey === 'd') {
          const { curLine } = this.getLinesAndCursor();
          const linesToScroll = Math.floor((this.maxVisibleLines || 24) / 2);
          const targetLine = curLine + linesToScroll;
          this.positionCursorOnFirstNonWhitespace(targetLine);
          if (this.mode === 'VISUAL') {
            this.setVisualSelection(this.visualAnchor, this.textarea.selectionStart);
          }
          this.draw();
          return;
        }
        if (lowerKey === 'u') {
          const { curLine } = this.getLinesAndCursor();
          const linesToScroll = Math.floor((this.maxVisibleLines || 24) / 2);
          const targetLine = curLine - linesToScroll;
          this.positionCursorOnFirstNonWhitespace(targetLine);
          if (this.mode === 'VISUAL') {
            this.setVisualSelection(this.visualAnchor, this.textarea.selectionStart);
          }
          this.draw();
          return;
        }
        if (lowerKey === 'f') {
          const { curLine } = this.getLinesAndCursor();
          const linesToScroll = Math.max(1, (this.maxVisibleLines || 24) - 2);
          const targetLine = curLine + linesToScroll;
          this.positionCursorOnFirstNonWhitespace(targetLine);
          if (this.mode === 'VISUAL') {
            this.setVisualSelection(this.visualAnchor, this.textarea.selectionStart);
          }
          this.draw();
          return;
        }
        if (lowerKey === 'b') {
          const { curLine } = this.getLinesAndCursor();
          const linesToScroll = Math.max(1, (this.maxVisibleLines || 24) - 2);
          const targetLine = curLine - linesToScroll;
          this.positionCursorOnFirstNonWhitespace(targetLine);
          if (this.mode === 'VISUAL') {
            this.setVisualSelection(this.visualAnchor, this.textarea.selectionStart);
          }
          this.draw();
          return;
        }
        if (lowerKey === 'r') {
          if (this.mode === 'NORMAL') {
            if (this.redoStack.length > 0) {
              const state = this.redoStack.pop();
              this.undoStack.push({
                value: this.textarea.value,
                selStart: this.textarea.selectionStart,
                selEnd: this.textarea.selectionEnd
              });
              this.textarea.value = state.value;
              this.textarea.selectionStart = state.selStart;
              this.textarea.selectionEnd = state.selEnd;
              this.showStatus('1 change; after...');
            } else {
              this.showStatus('Already at newest change');
            }
            this.draw();
          }
          return;
        }
      }

      // Visual Mode Keys
      if (this.mode === 'VISUAL') {
        if (key === 'Escape' || key === 'v') {
          this.mode = 'NORMAL';
          this.textarea.selectionStart = this.textarea.selectionEnd = this.visualCursor;
          this.visualAnchor = null;
          this.visualCursor = null;
          this.draw();
          return;
        }
        if (key === 'y') {
          const start = Math.min(this.visualAnchor, this.visualCursor);
          const end = Math.max(this.visualAnchor, this.visualCursor) + 1;
          const yankedText = this.textarea.value.slice(start, end);
          this.writeToClipboard(yankedText, false);
          this.showStatus(`${yankedText.length} characters yanked`);
          this.mode = 'NORMAL';
          this.textarea.selectionStart = this.textarea.selectionEnd = this.visualCursor;
          this.visualAnchor = null;
          this.visualCursor = null;
          this.draw();
          return;
        }
        if (key === 'd' || key === 'x') {
          this.pushUndoState();
          const start = Math.min(this.visualAnchor, this.visualCursor);
          const end = Math.max(this.visualAnchor, this.visualCursor) + 1;
          const val = this.textarea.value;
          this.textarea.value = val.slice(0, start) + val.slice(end);
          const newIdx = Math.min(start, this.textarea.value.length);
          this.textarea.selectionStart = this.textarea.selectionEnd = newIdx;
          this.mode = 'NORMAL';
          this.visualAnchor = null;
          this.visualCursor = null;
          this.draw();
          return;
        }
      }

      // Handle Line Jump Counts
      if (/[1-9]/.test(key) || (key === '0' && this.lineJumpCount.length > 0)) {
        if (this.mode === 'NORMAL') {
          this.lineJumpCount += key;
          this.draw();
          return;
        }
      }

      // Normal mode commands that change state to INSERT, VISUAL or COMMAND_LINE
      if (this.mode === 'NORMAL') {
        if (key === 'v') {
          this.mode = 'VISUAL';
          this.visualAnchor = this.textarea.selectionStart;
          this.visualCursor = this.textarea.selectionStart;
          this.setVisualSelection(this.visualAnchor, this.visualCursor);
          this.draw();
          return;
        }
        if (key === 'i' || key === 'I') {
          this.textBeforeInsert = this.textarea.value;
          this.mode = 'INSERT';
          this.statusMessage = '';
          this.draw();
          return;
        }
        if (key === 'a') {
          this.textBeforeInsert = this.textarea.value;
          this.moveCursor(1, true);
          this.mode = 'INSERT';
          this.statusMessage = '';
          this.draw();
          return;
        }
        if (key === 'A') {
          this.textBeforeInsert = this.textarea.value;
          const { rawLines, curLine } = this.getLinesAndCursor();
          let idx = 0;
          for (let i = 0; i < curLine; i++) {
            idx += rawLines[i].length + 1;
          }
          idx += rawLines[curLine].length;
          this.textarea.selectionStart = this.textarea.selectionEnd = idx;
          this.mode = 'INSERT';
          this.statusMessage = '';
          this.draw();
          return;
        }
        if (key === ':') {
          this.previousMode = this.mode;
          this.mode = 'COMMAND_LINE';
          this.commandText = ':';
          this.draw();
          return;
        }
      }

      if (key === '/' || key === '?') {
        this.previousMode = this.mode;
        this.mode = 'COMMAND_LINE';
        this.commandText = key;
        this.draw();
        return;
      }

      // Reset lineJumpCount for keys other than 'g', 'G', or modifiers
      if (key !== 'g' && key !== 'G' && !['Control', 'Shift', 'Alt', 'Meta'].includes(key)) {
        this.lineJumpCount = '';
      }

      // Cursor movements (h, j, k, l, w, b, 0, $, g, G)
      if (key === 'ArrowLeft' || lowerKey === 'h') {
        this.moveCursor(-1);
      } else if (key === 'ArrowRight' || lowerKey === 'l') {
        this.moveCursor(1);
      } else if (key === 'ArrowDown' || lowerKey === 'j') {
        this.moveLine(1);
      } else if (key === 'ArrowUp' || lowerKey === 'k') {
        this.moveLine(-1);
      } else if (key === '0') {
        const { rawLines, curLine } = this.getLinesAndCursor();
        let idx = 0;
        for (let i = 0; i < curLine; i++) {
          idx += rawLines[i].length + 1;
        }
        this.textarea.selectionStart = this.textarea.selectionEnd = idx;
      } else if (key === '$') {
        const { rawLines, curLine } = this.getLinesAndCursor();
        let idx = 0;
        for (let i = 0; i < curLine; i++) {
          idx += rawLines[i].length + 1;
        }
        idx += Math.max(0, rawLines[curLine].length - 1);
        this.textarea.selectionStart = this.textarea.selectionEnd = idx;
      } else if (key === 'w') {
        this.moveWord(1);
      } else if (key === 'b') {
        this.moveWord(-1);
      } else if (key === 'g') {
        if (this.lastKeyPressed === 'g') {
          if (this.lineJumpCount) {
            this.positionCursorOnFirstNonWhitespace(parseInt(this.lineJumpCount, 10) - 1);
            this.lineJumpCount = '';
          } else {
            this.textarea.selectionStart = this.textarea.selectionEnd = 0;
          }
          this.lastKeyPressed = '';
        } else {
          this.lastKeyPressed = 'g';
          return;
        }
      } else if (key === 'G') {
        if (this.lineJumpCount) {
          this.positionCursorOnFirstNonWhitespace(parseInt(this.lineJumpCount, 10) - 1);
          this.lineJumpCount = '';
        } else {
          const { rawLines } = this.getLinesAndCursor();
          let idx = 0;
          for (let i = 0; i < rawLines.length - 1; i++) {
            idx += rawLines[i].length + 1;
          }
          this.textarea.selectionStart = this.textarea.selectionEnd = idx;
        }
      }

      // Normal mode editing commands (x, d, y, p, P, r, D, C, o, O, u)
      else if (this.mode === 'NORMAL' && key === 'x') {
        const val = this.textarea.value;
        const idx = this.textarea.selectionStart;
        if (val.length > 0 && idx < val.length && val[idx] !== '\n') {
          this.pushUndoState();
          this.textarea.value = val.slice(0, idx) + val.slice(idx + 1);

          const newVal = this.textarea.value;
          let newIdx = idx;
          if ((newVal[newIdx] === '\n' || newIdx === newVal.length) && newIdx > 0 && newVal[newIdx - 1] !== '\n') {
            newIdx--;
          }
          this.textarea.selectionStart = this.textarea.selectionEnd = newIdx;
        }
      } else if (this.mode === 'NORMAL' && key === 'd') {
        if (this.lastKeyPressed === 'd') {
          this.pushUndoState();
          const { rawLines, curLine } = this.getLinesAndCursor();
          rawLines.splice(curLine, 1);
          if (rawLines.length === 0) rawLines.push('');
          this.textarea.value = rawLines.join('\n');
          let idx = 0;
          const targetLine = Math.min(curLine, rawLines.length - 1);
          for (let i = 0; i < targetLine; i++) {
            idx += rawLines[i].length + 1;
          }
          this.textarea.selectionStart = this.textarea.selectionEnd = idx;
          this.lastKeyPressed = '';
        } else {
          this.lastKeyPressed = 'd';
          return;
        }
      } else if (this.mode === 'NORMAL' && key === 'y') {
        const selStart = this.textarea.selectionStart;
        const selEnd = this.textarea.selectionEnd;
        if (selStart !== selEnd) {
          const yankedText = this.textarea.value.slice(Math.min(selStart, selEnd), Math.max(selStart, selEnd));
          this.writeToClipboard(yankedText, false);
          this.showStatus(`${yankedText.length} characters yanked`);
          this.lastKeyPressed = '';
        } else if (this.lastKeyPressed === 'y') {
          const { rawLines, curLine } = this.getLinesAndCursor();
          const yankedText = rawLines[curLine] + '\n';
          this.writeToClipboard(yankedText, true);
          this.showStatus('1 line yanked');
          this.lastKeyPressed = '';
        } else {
          this.lastKeyPressed = 'y';
          return;
        }
      } else if (this.mode === 'NORMAL' && (key === 'p' || key === 'P')) {
        this.handlePut(key);
      } else if (this.mode === 'NORMAL' && key === 'r') {
        this.isWaitingForReplaceChar = true;
        return;
      } else if (this.mode === 'NORMAL' && (key === 'D' || key === 'C')) {
        this.pushUndoState();
        const val = this.textarea.value;
        const selStart = this.textarea.selectionStart;
        const { rawLines, curLine, curCol } = this.getLinesAndCursor();
        const lineLen = rawLines[curLine] ? rawLines[curLine].length : 0;
        const charsToDelete = lineLen - curCol;

        this.textarea.value = val.slice(0, selStart) + val.slice(selStart + charsToDelete);
        this.textarea.selectionStart = this.textarea.selectionEnd = selStart;

        if (key === 'C') {
          this.mode = 'INSERT';
          this.textBeforeInsert = this.textarea.value;
        } else {
          if (selStart > 0 && this.textarea.value[selStart] === '\n') {
            this.textarea.selectionStart = this.textarea.selectionEnd = selStart - 1;
          }
        }
      } else if (this.mode === 'NORMAL' && lowerKey === 'o') {
        this.pushUndoState();
        const { rawLines, curLine } = this.getLinesAndCursor();
        let idx = 0;
        if (key === 'o') {
          for (let i = 0; i <= curLine; i++) {
            idx += rawLines[i].length + 1;
          }
          rawLines.splice(curLine + 1, 0, '');
        } else {
          for (let i = 0; i < curLine; i++) {
            idx += rawLines[i].length + 1;
          }
          rawLines.splice(curLine, 0, '');
        }
        this.textarea.value = rawLines.join('\n');
        this.textarea.selectionStart = this.textarea.selectionEnd = idx;
        this.textBeforeInsert = this.textarea.value;
        this.mode = 'INSERT';
        this.statusMessage = '';
      } else if (this.mode === 'NORMAL' && key === 'u') {
        if (this.undoStack.length > 0) {
          const prevState = this.undoStack.pop();
          this.redoStack.push({
            value: this.textarea.value,
            selStart: this.textarea.selectionStart,
            selEnd: this.textarea.selectionEnd
          });
          this.textarea.value = prevState.value;
          this.textarea.selectionStart = prevState.selStart;
          this.textarea.selectionEnd = prevState.selEnd;
          this.showStatus('1 change; before...');
        } else {
          this.showStatus('Already at oldest change');
        }
      }

      // Repeat visual mode range selection updates
      if (this.mode === 'VISUAL') {
        this.setVisualSelection(this.visualAnchor, this.textarea.selectionStart);
      }

      if (key !== 'g' && key !== 'd' && key !== 'y') {
        this.lastKeyPressed = '';
      }

      this.draw();
      return;
    }

    if (this.mode === 'INSERT') {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (this.textarea.value !== this.textBeforeInsert) {
          this.undoStack.push({
            value: this.textBeforeInsert,
            selStart: this.textarea.selectionStart,
            selEnd: this.textarea.selectionStart
          });
          this.redoStack = [];
        }
        this.textBeforeInsert = null;
        this.mode = 'NORMAL';

        const { curCol } = this.getLinesAndCursor();
        if (curCol > 0) {
          this.moveCursor(-1);
        }

        this.draw();
      }
      return;
    }

    if (this.mode === 'COMMAND_LINE') {
      e.preventDefault();
      if (e.key === 'Escape') {
        this.mode = this.previousMode || 'NORMAL';
        this.commandText = '';
        this.draw();
        return;
      }

      if (e.key === 'Backspace') {
        this.commandText = this.commandText.slice(0, -1);
        if (this.commandText === '') {
          this.mode = this.previousMode || 'NORMAL';
        }
        this.draw();
        return;
      }

      if (e.key === 'Enter') {
        const type = this.commandText[0];
        const cmd = this.commandText.slice(1);
        if (type === ':') {
          this.executeVimCommand(cmd.trim());
        } else if (type === '/' || type === '?') {
          this.searchDirection = (type === '/') ? 1 : -1;
          this.executeVimSearch(cmd);
        }
        return;
      }

      if (e.key.length === 1) {
        this.commandText += e.key;
        this.draw();
      }
    }
  }

  executeVimCommand(cmd) {
    this.mode = 'NORMAL';
    this.commandText = '';

    if (/^\d+$/.test(cmd)) {
      const lineNum = parseInt(cmd, 10);
      this.positionCursorOnFirstNonWhitespace(lineNum - 1);
      this.draw();
      return;
    }

    if (cmd === 'w') {
      const result = this.onSave(this.textarea.value);
      if (result === true) {
        this.content = this.textarea.value;
        this.isModified = false;
        const linesArr = this.textarea.value.split('\n');
        this.showStatus(`"${this.filename}" ${linesArr.length}L, ${this.textarea.value.length}C written`);
      } else {
        this.showStatus(`Error: ${result}`);
      }
    } else if (cmd === 'q') {
      const currentVal = this.textarea.value;
      if (currentVal !== this.content) {
        this.showStatus('E37: No write since last change (add ! to override)');
      } else {
        this.cleanup();
        this.onExit();
      }
    } else if (cmd === 'wq' || cmd === 'x') {
      const result = this.onSave(this.textarea.value);
      if (result === true) {
        this.cleanup();
        this.onExit();
      } else {
        this.showStatus(`Error: ${result}`);
      }
    } else if (cmd === 'q!') {
      this.cleanup();
      this.onExit();
    } else {
      this.showStatus(`E492: Not an editor command: :${cmd}`);
    }
  }

  executeVimSearch(text) {
    this.mode = this.previousMode || 'NORMAL';
    this.commandText = '';
    this.searchQuery = text;
    if (text) {
      this.performSearch(text, this.searchDirection);
    } else {
      this.draw();
    }
  }

  draw() {
    const { rawLines, curLine, curCol, selStart, selEnd, totalLines } = this.getLinesAndCursor();
    const currentVal = this.textarea.value;
    this.isModified = currentVal !== this.content;

    this.adjustScroll(curLine);

    if (this.mode === 'INSERT') {
      this.container.classList.add('vim-insert-mode');
    } else {
      this.container.classList.remove('vim-insert-mode');
    }

    let contentEl = this.container.querySelector('.vim-content');
    let footerEl = this.container.querySelector('.vim-footer');

    if (!contentEl || !footerEl) {
      this.container.innerHTML = `
        <div class="vim-content"></div>
        <div class="vim-footer"></div>
      `;
      contentEl = this.container.querySelector('.vim-content');
      footerEl = this.container.querySelector('.vim-footer');
    }

    const maxVisibleLines = this.maxVisibleLines || 24;
    const startLine = this.scrollTopLine;
    const endLine = Math.min(totalLines, startLine + maxVisibleLines);

    let html = '';
    let currentIdx = 0;
    for (let i = 0; i < startLine; i++) {
      currentIdx += rawLines[i].length + 1; // +1 for \n
    }

    for (let i = startLine; i < endLine; i++) {
      const lineText = rawLines[i];
      const lineNum = String(i + 1).padStart(3, ' ');
      let escaped = this.escapeLine(lineText, currentIdx, selStart, selEnd);
      if (this.searchQuery) {
        escaped = highlightSearchMatches(escaped, this.searchQuery);
      }
      html += `<div class="vim-line"><span class="vim-lnum">${lineNum}</span>${escaped}</div>`;
      currentIdx += lineText.length + 1;
    }

    const visibleLineCount = endLine - startLine;
    for (let i = visibleLineCount; i < maxVisibleLines; i++) {
      html += `<div class="vim-line"><span class="blue">~</span></div>`;
    }
    contentEl.innerHTML = html;

    const changedText = this.isModified ? ' [+]' : '';
    const fileText = ` "${this.filename}"${changedText}`;

    let pctText = 'All';
    if (totalLines > maxVisibleLines) {
      if (startLine === 0) {
        pctText = 'Top';
      } else if (endLine === totalLines) {
        pctText = 'Bot';
      } else {
        pctText = `${Math.round((endLine / totalLines) * 100)}%`;
      }
    }

    let countDisplay = this.lineJumpCount || '';
    const cursorText = `${countDisplay}      ${curLine + 1},${curCol + 1}          ${pctText} `;

    let bottomText = '&nbsp;';
    if (this.mode === 'COMMAND_LINE') {
      bottomText = this.commandText;
    } else if (this.mode === 'INSERT') {
      bottomText = '<span class="color-accent">-- INSERT --</span>';
    } else if (this.mode === 'VISUAL') {
      bottomText = '<span class="color-accent">-- VISUAL --</span>';
    } else if (this.statusMessage) {
      bottomText = this.statusMessage;
    }

    let statusBarEl = footerEl.querySelector('.vim-status-bar');
    let commandLineEl = footerEl.querySelector('.vim-command-line');
    if (!statusBarEl || !commandLineEl) {
      footerEl.innerHTML = `
        <div class="vim-status-bar">
          <div class="vim-status-left"></div>
          <div class="vim-status-right"></div>
        </div>
        <div class="vim-command-line"></div>
      `;
      statusBarEl = footerEl.querySelector('.vim-status-bar');
      commandLineEl = footerEl.querySelector('.vim-command-line');
    }

    const statusLeftEl = statusBarEl.querySelector('.vim-status-left');
    const statusRightEl = statusBarEl.querySelector('.vim-status-right');

    if (statusLeftEl && statusLeftEl.innerHTML !== fileText) {
      statusLeftEl.innerHTML = fileText;
    }
    if (statusRightEl && statusRightEl.innerHTML !== cursorText) {
      statusRightEl.innerHTML = cursorText;
    }
    if (commandLineEl && commandLineEl.innerHTML !== bottomText) {
      commandLineEl.innerHTML = bottomText;
    }
  }
}

function highlightSearchMatches(htmlStr, query) {
  if (!query) return htmlStr;

  const htmlEscapedQuery = query
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const regexEscaped = htmlEscapedQuery.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
  const regex = new RegExp(regexEscaped, 'gi');

  const parts = htmlStr.split(/(<[^>]+>)/g);
  for (let i = 0; i < parts.length; i += 2) {
    if (parts[i]) {
      parts[i] = parts[i].replace(regex, (match) => `<span class="vim-search-match">${match}</span>`);
    }
  }
  return parts.join('');
}
