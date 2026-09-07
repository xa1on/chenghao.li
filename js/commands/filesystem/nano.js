import { BaseEditor, runEditor } from '../../utils/editor.js';
import { audio } from '../../audio.js';

export const nano = {
  name: 'nano',
  description: 'Edit a text file using the nano terminal editor.',
  category: 'filesystem',
  lazy: true,
  args: [
    { name: 'filename', description: 'File to edit or create.', required: true }
  ],
  run: async (args, shell) => {
    return runEditor(NanoEditor, args, 'nano', shell);
  }
};

class NanoEditor extends BaseEditor {
  constructor(shell, filename, initialContent, resolvedPath, onSave, onExit, isNewFile) {
    super(shell, filename, initialContent, resolvedPath, onSave, onExit, isNewFile);
    this.isPromptingSave = false;
    this.statusMessage = '';
    this.statusTimeout = null;
    this.cutBuffer = '';

    this.promptState = null; // null, 'SEARCH', 'GO_TO_LINE', 'INSERT_FILE'
    this.promptInputText = '';
    this.lastCommandWasCut = false;

    this.undoStack = [];
    this.redoStack = [];
    this.lastKeyPress = '';
  }

  start() {
    this.initDOM('nano-editor');
    super.start('.nano-content', '.nano-line', '<span class="color-dim">  1 │ </span><span>&nbsp;</span>');

    // Attach keydown listener to capture semantic checkpoints before key changes the text
    this.textarea.addEventListener('keydown', (e) => {
      const val = this.textarea.value;
      const key = e.key;

      if (key === ' ' || key === 'Enter' || (e.ctrlKey && (key === 'v' || key === 'u' || key === 'k'))) {
        this.pushUndoState(val);
      } else if (key === 'Backspace') {
        if (this.lastKeyPress !== 'Backspace') {
          this.pushUndoState(val);
        }
      } else if (key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
        if (this.lastKeyPress === 'Backspace' || this.lastKeyPress === 'paste') {
          this.pushUndoState(val);
        }
      }
      this.lastKeyPress = key;
    });
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
    }, 3000);
  }

  pushUndoState(val = this.textarea.value) {
    if (this.undoStack.length === 0 || this.undoStack[this.undoStack.length - 1].value !== val) {
      this.undoStack.push({
        value: val,
        selStart: this.textarea.selectionStart,
        selEnd: this.textarea.selectionEnd
      });
      if (this.undoStack.length > 50) {
        this.undoStack.shift();
      }
      this.redoStack = []; // Clear redo stack on new input
    }
  }

  undo() {
    if (this.undoStack.length > 0) {
      const currentVal = this.textarea.value;
      const state = this.undoStack.pop();

      this.redoStack.push({
        value: currentVal,
        selStart: this.textarea.selectionStart,
        selEnd: this.textarea.selectionEnd
      });

      this.textarea.value = state.value;
      this.textarea.selectionStart = state.selStart;
      this.textarea.selectionEnd = state.selEnd;
      this.draw();
      this.showStatus('Undid last action');
    } else {
      this.showStatus('Nothing to undo');
    }
  }

  redo() {
    if (this.redoStack.length > 0) {
      const currentVal = this.textarea.value;
      const state = this.redoStack.pop();

      this.undoStack.push({
        value: currentVal,
        selStart: this.textarea.selectionStart,
        selEnd: this.textarea.selectionEnd
      });

      this.textarea.value = state.value;
      this.textarea.selectionStart = state.selStart;
      this.textarea.selectionEnd = state.selEnd;
      this.draw();
      this.showStatus('Redid last action');
    } else {
      this.showStatus('Nothing to redo');
    }
  }

  async writeToClipboard(text) {
    this.cutBuffer = text;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      }
    } catch (err) {
      // Fall back quietly
    }
  }

  async handlePaste() {
    let pasteText = this.cutBuffer;
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const systemText = await navigator.clipboard.readText();
        if (systemText) {
          pasteText = systemText;
        }
      }
    } catch (err) { }

    if (!pasteText) return;

    this.pushUndoState();
    const val = this.textarea.value;
    const selStart = this.textarea.selectionStart;
    this.textarea.value = val.slice(0, selStart) + pasteText + val.slice(selStart);
    this.textarea.selectionStart = this.textarea.selectionEnd = selStart + pasteText.length;
    this.draw();
  }

  async handleKeydown(e) {
    const key = e.key.toLowerCase();

    // Keyclick audio & Cut Buffer Reset
    const ignoredKeys = ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Escape'];
    if (!ignoredKeys.includes(e.key)) {
      if (!e.repeat) {
        audio.playKeyclick(e.key);
      }
      const isCutKey = e.ctrlKey && key === 'k';
      if (!isCutKey) {
        this.lastCommandWasCut = false;
      }
    }

    // In-Editor Prompt Key Interception
    if (this.promptState) {
      e.preventDefault();
      if (e.key === 'Escape' || (e.ctrlKey && key === 'c')) {
        this.promptState = null;
        this.promptInputText = '';
        this.draw();
        return;
      }

      if (e.key === 'Enter') {
        const text = this.promptInputText;
        const state = this.promptState;
        this.promptState = null;
        this.promptInputText = '';
        this.executePromptCommand(state, text);
        return;
      }

      if (e.key === 'Backspace') {
        this.promptInputText = this.promptInputText.slice(0, -1);
        this.draw();
        return;
      }

      if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
        this.promptInputText += e.key;
        this.draw();
        return;
      }
      return;
    }

    if (this.isPromptingSave) {
      e.preventDefault();
      const val = key;
      if (val === 'y') {
        const result = this.onSave(this.textarea.value);
        if (result === true) {
          this.cleanup();
          this.onExit();
        } else {
          this.isPromptingSave = false;
          this.showStatus(result);
        }
      } else if (val === 'n') {
        this.cleanup();
        this.onExit();
      } else if (e.ctrlKey && val === 'c') {
        this.isPromptingSave = false;
        this.draw();
      }
      return;
    }

    // Ctrl+O Save
    if (e.ctrlKey && key === 'o') {
      e.preventDefault();
      const result = this.onSave(this.textarea.value);
      if (result === true) {
        this.content = this.textarea.value;
        this.isModified = false;
        this.showStatus('Wrote file to virtual filesystem.');
      } else {
        this.showStatus(result);
      }
      return;
    }

    // Ctrl+X Exit
    if (e.ctrlKey && key === 'x') {
      e.preventDefault();
      const currentVal = this.textarea.value;
      if (currentVal !== this.content) {
        this.isPromptingSave = true;
        this.draw();
      } else {
        this.cleanup();
        this.onExit();
      }
      return;
    }

    // Ctrl+K Cut Selection / Line
    if (e.ctrlKey && key === 'k') {
      e.preventDefault();
      const val = this.textarea.value;
      const selStart = this.textarea.selectionStart;
      const selEnd = this.textarea.selectionEnd;

      this.pushUndoState(val);

      if (selStart !== selEnd) {
        const s = Math.min(selStart, selEnd);
        const e = Math.max(selStart, selEnd);
        const cutText = val.slice(s, e);
        await this.writeToClipboard(cutText);

        this.textarea.value = val.slice(0, s) + val.slice(e);
        this.textarea.selectionStart = this.textarea.selectionEnd = s;
        this.lastCommandWasCut = false;
        this.draw();
        this.showStatus('Cut selection');
      } else {
        const lines = val.split('\n');
        let currentIdx = 0;
        let curLine = 0;

        for (let i = 0; i < lines.length; i++) {
          const lineEndIdx = currentIdx + lines[i].length;
          if (selStart >= currentIdx && selStart <= lineEndIdx + 1) {
            curLine = i;
            break;
          }
          currentIdx = lineEndIdx + 1;
        }

        const cutText = lines[curLine] + '\n';
        if (this.lastCommandWasCut) {
          this.cutBuffer += cutText;
          try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
              await navigator.clipboard.writeText(this.cutBuffer);
            }
          } catch (err) { }
        } else {
          await this.writeToClipboard(cutText);
        }
        this.lastCommandWasCut = true;

        lines.splice(curLine, 1);
        if (lines.length === 0) lines.push('');

        this.textarea.value = lines.join('\n');

        let newIdx = 0;
        for (let i = 0; i < curLine && i < lines.length; i++) {
          newIdx += lines[i].length + 1;
        }
        this.textarea.selectionStart = this.textarea.selectionEnd = newIdx;
        this.draw();
        this.showStatus('Cut line');
      }
      return;
    }

    // Alt+6 Copy Selection / Line
    if (e.altKey && key === '6') {
      e.preventDefault();
      const val = this.textarea.value;
      const selStart = this.textarea.selectionStart;
      const selEnd = this.textarea.selectionEnd;
      if (selStart !== selEnd) {
        const s = Math.min(selStart, selEnd);
        const e = Math.max(selStart, selEnd);
        const copiedText = val.slice(s, e);
        await this.writeToClipboard(copiedText);
        this.showStatus('Copied selection');
      } else {
        const { rawLines, curLine } = this.getLinesAndCursor();
        const copiedText = rawLines[curLine] + '\n';
        await this.writeToClipboard(copiedText);
        this.showStatus('Copied line');
      }
      this.lastCommandWasCut = false;
      return;
    }

    // Ctrl+U Paste
    if (e.ctrlKey && key === 'u') {
      e.preventDefault();
      this.handlePaste();
      return;
    }

    // Alt+U Undo
    if (e.altKey && key === 'u') {
      e.preventDefault();
      this.undo();
      return;
    }

    // Alt+E Redo
    if (e.altKey && key === 'e') {
      e.preventDefault();
      this.redo();
      return;
    }

    // Ctrl+G Help
    if (e.ctrlKey && key === 'g') {
      e.preventDefault();
      alert(`GNU Nano Shortcuts Help:
  Ctrl+G: Show Help
  Ctrl+O: Save File (Write Out)
  Ctrl+X: Exit Nano
  Ctrl+K: Cut Selection / Line
  Ctrl+U: Paste (Uncut)
  Ctrl+W: Search Text (Where Is)
  Ctrl+C: Show Location
  Ctrl+/: Go to Line
  Alt+6: Copy Selection / Line
  Alt+U: Undo last change
  Alt+E: Redo last change`);
      return;
    }

    // Ctrl+W Search Prompt
    if (e.ctrlKey && key === 'w') {
      e.preventDefault();
      this.promptState = 'SEARCH';
      this.promptInputText = '';
      this.draw();
      return;
    }

    // Ctrl+R Read File Prompt
    if (e.ctrlKey && key === 'r') {
      e.preventDefault();
      this.promptState = 'INSERT_FILE';
      this.promptInputText = '';
      this.draw();
      return;
    }

    // Ctrl+C Location Info
    if (e.ctrlKey && key === 'c') {
      e.preventDefault();
      const { curLine, curCol, totalLines, totalChars } = this.getLinesAndCursor();
      const val = this.textarea.value;
      const lines = val.split('\n');
      const lineLen = lines[curLine] ? lines[curLine].length : 0;
      const charIdx = this.textarea.selectionStart;

      const linePct = totalLines > 0 ? Math.round(((curLine + 1) / totalLines) * 100) : 0;
      const colPct = lineLen > 0 ? Math.round(((curCol + 1) / (lineLen + 1)) * 100) : 0;
      const charPct = totalChars > 0 ? Math.round((charIdx / totalChars) * 100) : 0;

      const msg = `line ${curLine + 1}/${totalLines} (${linePct}%), col ${curCol + 1}/${lineLen + 1} (${colPct}%), char ${charIdx}/${totalChars} (${charPct}%)`;
      this.showStatus(msg);
      return;
    }

    // Ctrl+/ Go To Line Prompt
    if (e.ctrlKey && key === '/') {
      e.preventDefault();
      this.promptState = 'GO_TO_LINE';
      this.promptInputText = '';
      this.draw();
      return;
    }
  }

  executePromptCommand(state, text) {
    if (state === 'SEARCH') {
      if (text) {
        const val = this.textarea.value;
        const start = val.toLowerCase().indexOf(text.toLowerCase(), this.textarea.selectionStart + 1);
        const idx = start !== -1 ? start : val.toLowerCase().indexOf(text.toLowerCase());
        if (idx !== -1) {
          this.textarea.selectionStart = idx;
          this.textarea.selectionEnd = idx + text.length;
          this.draw();
        } else {
          this.showStatus(`"${text}" not found`);
        }
      }
    } else if (state === 'GO_TO_LINE') {
      if (text) {
        const targetLine = parseInt(text, 10) - 1;
        const lines = this.textarea.value.split('\n');
        if (targetLine >= 0 && targetLine < lines.length) {
          let newIdx = 0;
          for (let i = 0; i < targetLine; i++) {
            newIdx += lines[i].length + 1;
          }
          this.textarea.selectionStart = this.textarea.selectionEnd = newIdx;
          this.draw();
        } else {
          this.showStatus("Invalid line number");
        }
      }
    } else if (state === 'INSERT_FILE') {
      if (text) {
        const resolved = this.shell.fileSystem.resolvePath(this.shell.currentPath, text);
        if (resolved) {
          this.shell.fileSystem.readFile(resolved).then(fileContent => {
            const val = this.textarea.value;
            const selStart = this.textarea.selectionStart;
            this.pushUndoState(val);
            this.textarea.value = val.slice(0, selStart) + fileContent + val.slice(selStart);
            this.textarea.selectionStart = this.textarea.selectionEnd = selStart + fileContent.length;
            this.draw();
            this.showStatus(`Inserted file ${text}`);
          }).catch(err => {
            this.showStatus(`Error: ${err.message}`);
          });
        } else {
          this.showStatus("File not found");
        }
      }
    }
  }

  draw() {
    const { rawLines, curLine, curCol, selStart, selEnd, totalLines } = this.getLinesAndCursor();
    const currentVal = this.textarea.value;
    this.isModified = currentVal !== this.content;

    this.adjustScroll(curLine);

    let headerEl = this.container.querySelector('.nano-header');
    let contentEl = this.container.querySelector('.nano-content');
    let footerEl = this.container.querySelector('.nano-footer');

    if (!headerEl || !contentEl || !footerEl) {
      this.container.innerHTML = `
        <div class="nano-header"></div>
        <div class="nano-content"></div>
        <div class="nano-footer"></div>
      `;
      headerEl = this.container.querySelector('.nano-header');
      contentEl = this.container.querySelector('.nano-content');
      footerEl = this.container.querySelector('.nano-footer');
    }

    const modifiedText = this.isModified ? 'Modified' : '';
    const expectedHeaderHtml = `
      <span>GNU nano 6.7</span>
      <span>${this.filename}</span>
      <span>${modifiedText}</span>
    `;
    if (headerEl.innerHTML !== expectedHeaderHtml) {
      headerEl.innerHTML = expectedHeaderHtml;
    }

    const maxVisibleLines = this.maxVisibleLines || 20;
    const startLine = this.scrollTopLine;
    const endLine = Math.min(totalLines, startLine + maxVisibleLines);

    let html = '';
    let currentIdx = 0;
    for (let i = 0; i < startLine; i++) {
      currentIdx += rawLines[i].length + 1;
    }

    for (let i = startLine; i < endLine; i++) {
      const lineText = rawLines[i];
      const isCurrent = i === curLine;
      const lineNum = String(i + 1).padStart(3, ' ');
      const escaped = this.escapeLine(lineText, currentIdx, selStart, selEnd);
      html += `<div class="nano-line ${isCurrent ? 'nano-line-active' : ''}"><span class="color-dim">${lineNum} │ </span>${escaped}</div>`;
      currentIdx += lineText.length + 1;
    }
    contentEl.innerHTML = html;

    let expectedFooterHtml = '';
    if (this.promptState) {
      let promptLabel = '';
      if (this.promptState === 'SEARCH') promptLabel = 'Search for: ';
      else if (this.promptState === 'GO_TO_LINE') promptLabel = 'Enter line number: ';
      else if (this.promptState === 'INSERT_FILE') promptLabel = 'Insert file: ';

      expectedFooterHtml = `
        <div class="nano-prompt color-accent">${promptLabel}${this.promptInputText}<span class="terminal-cursor">&nbsp;</span></div>
        <div class="nano-shortcuts-grid">
          <div class="nano-shortcut"><span class="nano-key">^C</span><span class="nano-desc">Cancel</span></div>
          <div class="nano-shortcut"><span class="nano-key">^G</span><span class="nano-desc">Help</span></div>
        </div>
      `;
    } else if (this.isPromptingSave) {
      expectedFooterHtml = `
        <div class="nano-prompt color-accent">Save modified buffer? (Answering "No" will DISCARD changes.) [y/n/ctrl+c]</div>
        <div class="nano-shortcuts-grid">
          <div class="nano-shortcut"><span class="nano-key">Y</span><span class="nano-desc">Yes</span></div>
          <div class="nano-shortcut"><span class="nano-key">N</span><span class="nano-desc">No</span></div>
          <div class="nano-shortcut"><span class="nano-key">^C</span><span class="nano-desc">Cancel</span></div>
        </div>
      `;
    } else {
      const statusLineHtml = this.statusMessage
        ? `<div class="nano-status color-accent">${this.statusMessage}</div>`
        : '';

      expectedFooterHtml = `
        ${statusLineHtml}
        <div class="nano-shortcuts-grid">
          <div class="nano-shortcut"><span class="nano-key">^G</span><span class="nano-desc">Help</span></div>
          <div class="nano-shortcut"><span class="nano-key">^O</span><span class="nano-desc">Write Out</span></div>
          <div class="nano-shortcut"><span class="nano-key">^W</span><span class="nano-desc">Where Is</span></div>
          <div class="nano-shortcut"><span class="nano-key">^K</span><span class="nano-desc">Cut</span></div>
          <div class="nano-shortcut"><span class="nano-key">^T</span><span class="nano-desc">Execute</span></div>
          <div class="nano-shortcut"><span class="nano-key">^C</span><span class="nano-desc">Location</span></div>
          <div class="nano-shortcut"><span class="nano-key">M-U</span><span class="nano-desc">Undo</span></div>
          <div class="nano-shortcut"><span class="nano-key">M-A</span><span class="nano-desc">Set Mark</span></div>
          <div class="nano-shortcut"><span class="nano-key">^X</span><span class="nano-desc">Exit</span></div>
          <div class="nano-shortcut"><span class="nano-key">^R</span><span class="nano-desc">Read File</span></div>
          <div class="nano-shortcut"><span class="nano-key">^\\</span><span class="nano-desc">Replace</span></div>
          <div class="nano-shortcut"><span class="nano-key">^U</span><span class="nano-desc">Paste</span></div>
          <div class="nano-shortcut"><span class="nano-key">^J</span><span class="nano-desc">Justify</span></div>
          <div class="nano-shortcut"><span class="nano-key">^/</span><span class="nano-desc">Go To Line</span></div>
          <div class="nano-shortcut"><span class="nano-key">M-E</span><span class="nano-desc">Redo</span></div>
          <div class="nano-shortcut"><span class="nano-key">M-6</span><span class="nano-desc">Copy</span></div>
        </div>
      `;
    }

    if (footerEl.innerHTML !== expectedFooterHtml) {
      footerEl.innerHTML = expectedFooterHtml;
    }
  }
}
