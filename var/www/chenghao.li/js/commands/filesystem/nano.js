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

const NANO_HELP_TEXT = `

 The nano command is a lightweight terminal text editor emulating GNU nano
 inside the web browser. It allows you to create and edit text files on the
 virtual filesystem.

 There are four main sections of the editor:
 1. The top header shows the program version, the current filename, and
    whether or not the buffer has been modified.
 2. The main editor window displays the text buffer with line numbers.
 3. The status line (third line from the bottom) displays status messages,
    cursor coordinates, and interactive input prompts.
 4. The bottom two lines show the keyboard shortcuts.

 Keyboard Conventions:
  Control-key sequences are notated with a '^' (e.g. ^X). Hold Ctrl and press
  the indicated key.
  Meta-key sequences are notated with 'M-' (e.g. M-U). Hold Alt and press the
  indicated key.

 The following keystrokes are available in the main editor window:

 FILE OPERATIONS
  ^O                  Write Out: Save current buffer to the virtual filesystem
  ^R                  Read File: Insert contents of another file at cursor
  ^X                  Exit: Quit nano (prompts to save if buffer is modified)

 EDITING & CLIPBOARD
  ^K                  Cut: Cut selected text, or current line if no selection
  M-6     (Alt+6)     Copy: Copy selected text, or current line to cutbuffer
  ^U                  Paste: Paste (uncut) cutbuffer or clipboard at cursor
  M-A     (Alt+A)     Set Mark: Start or clear text selection
  M-U     (Alt+U)     Undo: Undo the last edit operation
  M-E     (Alt+E)     Redo: Redo the last undone operation
  ^J                  Justify: Format and justify current paragraph

 SEARCH & NAVIGATION
  ^W                  Where Is: Search forward for text string
  ^/                  Go To Line: Jump directly to a line number
  ^C                  Location: Show line, column, character count, and %
  Arrow Keys          Move cursor up, down, left, and right
  PageUp / PageDown   Scroll up or down by one screen
  Home / End          Jump to start or end of current line

 HELP VIEWER NAVIGATION
  ^X, ^G, Esc, or q   Close this help screen and return to file editing
  ^P, Up Arrow        Scroll up one line
  ^N, Down Arrow      Scroll down one line
  ^Y, Page Up         Scroll up one page
  ^V, Page Down       Scroll down one page
  M-\\, Home          Jump to beginning of help text
  M-/, End            Jump to end of help text
`;

const MAIN_SHORTCUTS = [
  ['^G', 'Help'], ['^O', 'Write Out'], ['^W', 'Where Is'], ['^K', 'Cut'],
  ['^T', 'Execute'], ['^C', 'Location'], ['M-U', 'Undo'], ['M-A', 'Set Mark'],
  ['^X', 'Exit'], ['^R', 'Read File'], ['^\\', 'Replace'], ['^U', 'Paste'],
  ['^J', 'Justify'], ['^/', 'Go To Line'], ['M-E', 'Redo'], ['M-6', 'Copy']
];

const HELP_SHORTCUTS = [
  ['^G', 'Close'], ['^P', 'Prev Line'], ['^Y', 'Prev Page'], ['M-\\', 'First Line'],
  ['Up', 'Prev Line'], ['PgUp', 'Prev Page'], ['Home', 'First Line'], ['q', 'Close'],
  ['^X', 'Close'], ['^N', 'Next Line'], ['^V', 'Next Page'], ['M-/', 'Last Line'],
  ['Down', 'Next Line'], ['PgDn', 'Next Page'], ['End', 'Last Line'], ['Esc', 'Close']
];

const renderShortcuts = (shortcuts) => `
  <div class="nano-shortcuts-grid">
    ${shortcuts.map(([key, desc]) => `<div class="nano-shortcut"><span class="nano-key">${key}</span><span class="nano-desc">${desc}</span></div>`).join('')}
  </div>
`;

class NanoEditor extends BaseEditor {
  constructor(shell, filename, initialContent, resolvedPath, onSave, onExit, isNewFile) {
    super(shell, filename, initialContent, resolvedPath, onSave, onExit, isNewFile);
    this.isPromptingSave = false;
    this.isHelpMode = false;
    this.helpScrollLine = 0;
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

  getHelpLines() {
    return NANO_HELP_TEXT.trim().split('\n');
  }

  scrollHelp(delta) {
    const maxScroll = Math.max(0, this.getHelpLines().length - (this.maxVisibleLines || 20));
    this.helpScrollLine = Math.max(0, Math.min(maxScroll, this.helpScrollLine + delta));
    this.draw();
  }

  start() {
    this.initDOM('nano-editor');
    super.start('.nano-content', '.nano-line', '<span class="color-dim">  1 │ </span><span>&nbsp;</span>');

    this.container.addEventListener('wheel', (e) => {
      if (this.isHelpMode) {
        e.preventDefault();
        this.scrollHelp(e.deltaY > 0 ? 3 : -3);
      }
    }, { passive: false });

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

    // In-Editor Help View Interception
    if (this.isHelpMode) {
      e.preventDefault();
      if ((e.ctrlKey && (key === 'x' || key === 'g')) || e.key === 'Escape' || key === 'q') {
        this.isHelpMode = false;
        this.draw();
        return;
      }

      const page = this.maxVisibleLines || 20;
      if (e.key === 'ArrowUp' || (e.ctrlKey && key === 'p')) this.scrollHelp(-1);
      else if (e.key === 'ArrowDown' || (e.ctrlKey && key === 'n')) this.scrollHelp(1);
      else if (e.key === 'PageUp' || (e.ctrlKey && key === 'y')) this.scrollHelp(-page);
      else if (e.key === 'PageDown' || (e.ctrlKey && key === 'v')) this.scrollHelp(page);
      else if (e.key === 'Home' || (e.altKey && e.key === '\\')) this.scrollHelp(-Infinity);
      else if (e.key === 'End' || (e.altKey && e.key === '/')) this.scrollHelp(Infinity);
      return;
    }

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
      this.isHelpMode = true;
      this.helpScrollLine = 0;
      this.draw();
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

    if (!this.isHelpMode) {
      this.adjustScroll(curLine);
    }

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

    // Header
    const headerTitle = this.isHelpMode ? 'Main nano help text' : this.filename;
    const headerRight = this.isHelpMode ? '' : (this.isModified ? 'Modified' : '');
    const expectedHeaderHtml = `
      <span>GNU nano 6.7</span>
      <span>${headerTitle}</span>
      <span>${headerRight}</span>
    `;
    if (headerEl.innerHTML !== expectedHeaderHtml) {
      headerEl.innerHTML = expectedHeaderHtml;
    }

    // Body lines
    const lines = this.isHelpMode ? this.getHelpLines() : rawLines;
    const maxVisibleLines = this.maxVisibleLines || 20;
    const startLine = this.isHelpMode ? this.helpScrollLine : this.scrollTopLine;
    const endLine = Math.min(lines.length, startLine + maxVisibleLines);

    let html = '';
    if (this.isHelpMode) {
      for (let i = startLine; i < endLine; i++) {
        html += `<div class="nano-line">${this.escapeLine(lines[i]) || '&nbsp;'}</div>`;
      }
    } else {
      let currentIdx = 0;
      for (let i = 0; i < startLine; i++) {
        currentIdx += rawLines[i].length + 1;
      }
      for (let i = startLine; i < endLine; i++) {
        const lineText = rawLines[i];
        const isCurrent = i === curLine;
        const lineNum = String(i + 1).padStart(3, ' ');
        const escaped = this.escapeLine(lineText, currentIdx, selStart);
        html += `<div class="nano-line ${isCurrent ? 'nano-line-active' : ''}"><span class="color-dim">${lineNum} │ </span>${escaped}</div>`;
        currentIdx += lineText.length + 1;
      }
    }
    contentEl.innerHTML = html;

    // Footer
    let expectedFooterHtml = '';
    if (this.isHelpMode) {
      expectedFooterHtml = renderShortcuts(HELP_SHORTCUTS);
    } else if (this.promptState) {
      let promptLabel = '';
      if (this.promptState === 'SEARCH') promptLabel = 'Search for: ';
      else if (this.promptState === 'GO_TO_LINE') promptLabel = 'Enter line number: ';
      else if (this.promptState === 'INSERT_FILE') promptLabel = 'Insert file: ';

      expectedFooterHtml = `
        <div class="nano-prompt color-accent">${promptLabel}${this.promptInputText}<span class="terminal-cursor">&nbsp;</span></div>
        ${renderShortcuts([['^C', 'Cancel'], ['^G', 'Help']])}
      `;
    } else if (this.isPromptingSave) {
      expectedFooterHtml = `
        <div class="nano-prompt color-accent">Save modified buffer? (Answering "No" will DISCARD changes.) [y/n/ctrl+c]</div>
        ${renderShortcuts([['Y', 'Yes'], ['N', 'No'], ['^C', 'Cancel']])}
      `;
    } else {
      const statusLineHtml = this.statusMessage
        ? `<div class="nano-status color-accent">${this.statusMessage}</div>`
        : '';
      expectedFooterHtml = statusLineHtml + renderShortcuts(MAIN_SHORTCUTS);
    }

    if (footerEl.innerHTML !== expectedFooterHtml) {
      footerEl.innerHTML = expectedFooterHtml;
    }
  }
}
