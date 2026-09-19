import { audio } from '../audio.js';
import { escapeHTML } from '../utils/markdown.js';
import { findCommentIndex, parseArgs } from './parser.js';

/**
 * GNU Readline Emacs-style interactive line editor.
 * Manages the interactive prompt input buffer, custom cursor rendering,
 * kill-ring, history traversal, and reverse incremental search (bck-i-search).
 */
export class LineEditor {
  constructor(options = {}) {
    this.shell = options.shell;
    this.input = options.input;
    this.inputDisplay = options.inputDisplay;
    this.promptPrefix = options.promptPrefix;
    this.placeholder = options.placeholder;
    this.onSubmit = options.onSubmit || (() => {});
    this.onTab = options.onTab || (() => {});

    this.killRing = '';
    this.searchMode = false;
    this.searchQuery = '';
    this.searchMatch = '';
    this.searchMatchIndex = -1;
    this.searchFailed = false;
    this.searchSavedInput = '';
    this.searchSavedCursor = 0;
    this.lastArgCycleIndex = -1;
    this.lastInsertedArgLen = 0;
    this.historyDraft = '';
    this.lastActionWasKill = false;
    this.cursorBlinkTimeout = null;
  }

  getValue() {
    return this.input ? this.input.value : '';
  }

  getCursorPos() {
    return this.input ? (this.input.selectionStart || 0) : 0;
  }

  setInputValue(newVal, newCursorPos = null) {
    if (!this.input) return;
    this.input.value = newVal;
    const pos = newCursorPos !== null ? Math.max(0, Math.min(newVal.length, newCursorPos)) : newVal.length;
    this.input.setSelectionRange(pos, pos);
    this.updateDisplay(newVal);
  }

  getPrevWordPos(text, pos) {
    if (pos <= 0) return 0;
    let i = pos;
    while (i > 0 && /\s/.test(text[i - 1])) i--;
    while (i > 0 && !/\s/.test(text[i - 1])) i--;
    return i;
  }

  getNextWordPos(text, pos) {
    if (pos >= text.length) return text.length;
    let i = pos;
    while (i < text.length && !/\s/.test(text[i])) i++;
    while (i < text.length && /\s/.test(text[i])) i++;
    return i;
  }

  findSearchMatch(query, startIdx) {
    const history = this.shell.commandHistory;
    if (!query) return startIdx >= 0 && startIdx < history.length ? startIdx : -1;
    const qLower = query.toLowerCase();
    for (let i = startIdx; i >= 0; i--) {
      if (history[i].toLowerCase().includes(qLower)) {
        return i;
      }
    }
    return -1;
  }

  updateSearchDisplay() {
    const failedText = this.searchFailed ? 'failed ' : '';
    this.promptPrefix.innerHTML = `<span class="color-accent">(${failedText}reverse-i-search)\`${escapeHTML(this.searchQuery)}\`: </span>`;

    const match = this.searchMatch || '';
    if (this.searchQuery && match) {
      const qLower = this.searchQuery.toLowerCase();
      const matchLower = match.toLowerCase();
      const idx = matchLower.indexOf(qLower);
      if (idx !== -1) {
        const before = escapeHTML(match.slice(0, idx));
        const matched = escapeHTML(match.slice(idx, idx + this.searchQuery.length));
        const after = escapeHTML(match.slice(idx + this.searchQuery.length));
        this.inputDisplay.innerHTML = `${before}<span class="color-dir" style="text-decoration: underline;">${matched}</span>${after}<span class="terminal-cursor" id="cursor">&nbsp;</span>`;
      } else {
        this.inputDisplay.innerHTML = `${escapeHTML(match)}<span class="terminal-cursor" id="cursor">&nbsp;</span>`;
      }
    } else {
      this.inputDisplay.innerHTML = `${escapeHTML(match)}<span class="terminal-cursor" id="cursor">&nbsp;</span>`;
    }
  }

  exitSearchMode(cancel = false) {
    this.searchMode = false;
    this.searchQuery = '';
    this.searchFailed = false;
    this.searchMatch = '';
    this.searchMatchIndex = -1;
    this.promptPrefix.innerHTML = this.shell.getPromptHtml();
    if (cancel) {
      this.setInputValue(this.searchSavedInput, this.searchSavedCursor);
    }
  }

  updateDisplay(text) {
    // 1. Toggle placeholder visibility (only when logged in and no sub-prompt)
    if (this.shell.loginState === 'LOGGED_IN' && !this.shell.activeInputResolver && text === '') {
      if (this.placeholder) this.placeholder.style.display = 'inline';
    } else {
      if (this.placeholder) this.placeholder.style.display = 'none';
    }

    const selStart = text === this.input.value ? (this.input.selectionStart || 0) : text.length;
    const formatSegment = (str) => escapeHTML(str).replace(/ /g, '\u00A0');

    const getCursorHTML = (char) => {
      const displayChar = (char === '' || char === ' ' || char === '\n') ? '\u00A0' : char;
      return `<span class="terminal-cursor" id="cursor">${escapeHTML(displayChar)}</span>`;
    };

    // 2. Render text with the cursor embedded at selStart
    if (text === '') {
      this.inputDisplay.innerHTML = getCursorHTML('');
    } else if (this.shell.activeInputResolver) {
      const left = text.slice(0, selStart);
      const charUnder = text.slice(selStart, selStart + 1);
      const right = text.slice(selStart + 1);
      this.inputDisplay.innerHTML = formatSegment(left) + getCursorHTML(charUnder) + formatSegment(right);
    } else {
      // Render standard text and dim comments, embedding cursor appropriately
      const commentIdx = findCommentIndex(text);
      if (commentIdx !== -1) {
        const commandPart = text.slice(0, commentIdx);
        const commentPart = text.slice(commentIdx);

        if (selStart <= commentIdx) {
          const left = commandPart.slice(0, selStart);
          const charUnder = commandPart.slice(selStart, selStart + 1);
          const right = commandPart.slice(selStart + 1);
          this.inputDisplay.innerHTML = formatSegment(left) + getCursorHTML(charUnder) + formatSegment(right) + `<span class="color-dim">${formatSegment(commentPart)}</span>`;
        } else {
          const localSel = selStart - commentIdx;
          const left = commentPart.slice(0, localSel);
          const charUnder = commentPart.slice(localSel, localSel + 1);
          const right = commentPart.slice(localSel + 1);
          this.inputDisplay.innerHTML = formatSegment(commandPart) + `<span class="color-dim">${formatSegment(left)}${getCursorHTML(charUnder)}${formatSegment(right)}</span>`;
        }
      } else {
        const left = text.slice(0, selStart);
        const charUnder = text.slice(selStart, selStart + 1);
        const right = text.slice(selStart + 1);
        this.inputDisplay.innerHTML = formatSegment(left) + getCursorHTML(charUnder) + formatSegment(right);
      }
    }

    // Keep cursor solid while typing/moving, then resume blinking after 500ms
    const cursorEl = document.getElementById('cursor');
    if (cursorEl) {
      cursorEl.classList.add('cursor-solid');
      if (this.cursorBlinkTimeout) {
        clearTimeout(this.cursorBlinkTimeout);
      }
      this.cursorBlinkTimeout = setTimeout(() => {
        cursorEl.classList.remove('cursor-solid');
      }, 500);
    }
  }

  async handleKeydown(e) {
    if (this.shell.loginState !== 'LOGGED_IN' || this.shell.isBooting) return;

    // 1. Sub-Prompt Handling (readInput)
    if (this.shell.activeInputResolver) {
      if (e.key === 'Enter') {
        const val = this.input.value;
        this.input.value = '';
        this.inputDisplay.textContent = '';
        const resolve = this.shell.activeInputResolver;
        this.shell.activeInputResolver = null;
        this.shell.activeInputAbortResolver = null;
        resolve(val);
      } else if (e.key === 'Tab') {
        e.preventDefault();
      } else if (e.ctrlKey && e.key.toLowerCase() === 'u') {
        e.preventDefault();
        this.setInputValue('', 0);
      } else if (e.ctrlKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        this.setInputValue(this.input.value, 0);
      } else if (e.ctrlKey && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        this.setInputValue(this.input.value, this.input.value.length);
      }
      return;
    }

    // 2. Reverse Incremental History Search ((reverse-i-search)`query`: match)
    if (this.searchMode) {
      if (e.ctrlKey && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        const nextIdx = this.findSearchMatch(this.searchQuery, this.searchMatchIndex - 1);
        if (nextIdx !== -1) {
          this.searchMatchIndex = nextIdx;
          this.searchMatch = this.shell.commandHistory[nextIdx];
          this.searchFailed = false;
        } else {
          this.searchFailed = true;
        }
        this.updateSearchDisplay();
        return;
      }

      if (e.key === 'Backspace') {
        e.preventDefault();
        this.searchQuery = this.searchQuery.slice(0, -1);
        const matchIdx = this.findSearchMatch(this.searchQuery, this.shell.commandHistory.length - 1);
        if (matchIdx !== -1) {
          this.searchMatchIndex = matchIdx;
          this.searchMatch = this.shell.commandHistory[matchIdx];
          this.searchFailed = false;
        } else {
          this.searchFailed = !!this.searchQuery;
          if (!this.searchQuery) this.searchMatch = '';
        }
        this.updateSearchDisplay();
        return;
      }

      if (e.key === 'Enter' || (e.ctrlKey && (e.key.toLowerCase() === 'j' || e.key.toLowerCase() === 'm'))) {
        e.preventDefault();
        const chosenCmd = this.searchMatch;
        this.exitSearchMode(false);
        this.setInputValue('', 0);
        if (chosenCmd) {
          await this.onSubmit(chosenCmd);
        }
        return;
      }

      if (e.key === 'Escape' || (e.ctrlKey && (e.key.toLowerCase() === 'g' || e.key.toLowerCase() === 'c'))) {
        e.preventDefault();
        this.exitSearchMode(true);
        return;
      }

      // Accept command for editing at the prompt
      if (e.key === 'Tab' || e.key === 'ArrowLeft' || e.key === 'ArrowRight' || (e.ctrlKey && (e.key.toLowerCase() === 'a' || e.key.toLowerCase() === 'e'))) {
        e.preventDefault();
        const matchedCmd = this.searchMatch;
        this.exitSearchMode(false);
        const cursorPos = (e.key === 'ArrowLeft' || (e.ctrlKey && e.key.toLowerCase() === 'a')) ? 0 : matchedCmd.length;
        this.setInputValue(matchedCmd, cursorPos);
        return;
      }

      // Printable search query characters
      if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        this.searchQuery += e.key;
        const matchIdx = this.findSearchMatch(this.searchQuery, this.shell.commandHistory.length - 1);
        if (matchIdx !== -1) {
          this.searchMatchIndex = matchIdx;
          this.searchMatch = this.shell.commandHistory[matchIdx];
          this.searchFailed = false;
        } else {
          this.searchFailed = true;
        }
        this.updateSearchDisplay();
        return;
      }

      e.preventDefault();
      return;
    }

    // Reset Alt+. cycling if any other key is pressed
    if (!(e.altKey && (e.key === '.' || e.key === '_'))) {
      this.lastArgCycleIndex = -1;
    }

    // Audio typing clicks
    const ignoredKeys = ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Escape'];
    if (!ignoredKeys.includes(e.key) && !e.ctrlKey && !e.altKey && !e.metaKey) {
      audio.playKeyclick(e.key);
    }

    // 3. Viewport Scroll Shortcuts
    if (e.key === 'PageUp') {
      e.preventDefault();
      this.shell.body.scrollBy({ top: -this.shell.body.clientHeight * 0.75, behavior: 'smooth' });
      return;
    }
    if (e.key === 'PageDown') {
      e.preventDefault();
      this.shell.body.scrollBy({ top: this.shell.body.clientHeight * 0.75, behavior: 'smooth' });
      return;
    }
    if (e.shiftKey && e.key === 'Home') {
      e.preventDefault();
      this.shell.body.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (e.shiftKey && e.key === 'End') {
      e.preventDefault();
      this.shell.body.scrollTo({ top: this.shell.body.scrollHeight, behavior: 'smooth' });
      return;
    }

    // 4. Screen & Terminal Controls
    if (e.ctrlKey && e.key.toLowerCase() === 'l') {
      e.preventDefault();
      const currentVal = this.input.value;
      const currentPos = this.input.selectionStart || 0;
      this.shell.clear();
      this.promptPrefix.innerHTML = this.shell.getPromptHtml();
      this.setInputValue(currentVal, currentPos);
      this.shell.focus();
      return;
    }

    if (e.ctrlKey && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (this.shell.isExecutingCommand) {
        this.shell.abortSignal = true;
        this.shell.print('^Z\n[1]+  Stopped', 'color-dim');
      } else {
        this.shell.print('^Z', 'color-dim');
        this.shell.updatePrompt();
      }
      return;
    }

    // 5. History Incremental Search (Ctrl+R)
    if (e.ctrlKey && e.key.toLowerCase() === 'r') {
      e.preventDefault();
      this.searchMode = true;
      this.searchQuery = '';
      this.searchMatch = '';
      this.searchMatchIndex = -1;
      this.searchFailed = false;
      this.searchSavedInput = this.input.value;
      this.searchSavedCursor = this.input.selectionStart || 0;
      this.updateSearchDisplay();
      return;
    }

    // 6. Cursor Navigation
    // Ctrl+A / Home: Beginning of line
    if ((e.ctrlKey && e.key.toLowerCase() === 'a') || (!e.ctrlKey && !e.altKey && e.key === 'Home')) {
      e.preventDefault();
      this.setInputValue(this.input.value, 0);
      return;
    }

    // Ctrl+E / End: End of line
    if ((e.ctrlKey && e.key.toLowerCase() === 'e') || (!e.ctrlKey && !e.altKey && e.key === 'End')) {
      e.preventDefault();
      this.setInputValue(this.input.value, this.input.value.length);
      return;
    }

    // Ctrl+B: Backward character
    if (e.ctrlKey && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      this.setInputValue(this.input.value, Math.max(0, (this.input.selectionStart || 0) - 1));
      return;
    }

    // Ctrl+F: Forward character
    if (e.ctrlKey && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      this.setInputValue(this.input.value, Math.min(this.input.value.length, (this.input.selectionStart || 0) + 1));
      return;
    }

    // Alt+B / Alt+ArrowLeft / Ctrl+ArrowLeft: Backward word
    if ((e.altKey && (e.key.toLowerCase() === 'b' || e.key === 'ArrowLeft')) || (e.ctrlKey && e.key === 'ArrowLeft')) {
      e.preventDefault();
      const pos = this.input.selectionStart || 0;
      this.setInputValue(this.input.value, this.getPrevWordPos(this.input.value, pos));
      return;
    }

    // Alt+F / Alt+ArrowRight / Ctrl+ArrowRight: Forward word
    if ((e.altKey && (e.key.toLowerCase() === 'f' || e.key === 'ArrowRight')) || (e.ctrlKey && e.key === 'ArrowRight')) {
      e.preventDefault();
      const pos = this.input.selectionStart || 0;
      this.setInputValue(this.input.value, this.getNextWordPos(this.input.value, pos));
      return;
    }

    // 7. Kill-Ring & Line Editing
    // Ctrl+U: Cut to beginning of line
    if (e.ctrlKey && e.key.toLowerCase() === 'u') {
      e.preventDefault();
      const val = this.input.value;
      const pos = this.input.selectionStart || 0;
      const cut = val.slice(0, pos);
      this.killRing = this.lastActionWasKill ? cut + this.killRing : cut;
      this.setInputValue(val.slice(pos), 0);
      this.lastActionWasKill = true;
      return;
    }

    // Ctrl+K: Cut to end of line
    if (e.ctrlKey && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      const val = this.input.value;
      const pos = this.input.selectionStart || 0;
      const cut = val.slice(pos);
      this.killRing = this.lastActionWasKill ? this.killRing + cut : cut;
      this.setInputValue(val.slice(0, pos), pos);
      this.lastActionWasKill = true;
      return;
    }

    // Ctrl+W / Alt+Backspace / Ctrl+Backspace: Cut word backward
    if ((e.ctrlKey && (e.key.toLowerCase() === 'w' || e.key === 'Backspace')) || (e.altKey && e.key === 'Backspace')) {
      e.preventDefault();
      const val = this.input.value;
      const pos = this.input.selectionStart || 0;
      const prev = this.getPrevWordPos(val, pos);
      const cut = val.slice(prev, pos);
      this.killRing = this.lastActionWasKill ? cut + this.killRing : cut;
      this.setInputValue(val.slice(0, prev) + val.slice(pos), prev);
      this.lastActionWasKill = true;
      return;
    }

    // Alt+D: Cut word forward
    if (e.altKey && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      const val = this.input.value;
      const pos = this.input.selectionStart || 0;
      const next = this.getNextWordPos(val, pos);
      const cut = val.slice(pos, next);
      this.killRing = this.lastActionWasKill ? this.killRing + cut : cut;
      this.setInputValue(val.slice(0, pos) + val.slice(next), pos);
      this.lastActionWasKill = true;
      return;
    }

    this.lastActionWasKill = false;

    // Ctrl+Y: Yank (paste) kill-ring
    if (e.ctrlKey && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      if (this.killRing) {
        const val = this.input.value;
        const pos = this.input.selectionStart || 0;
        this.setInputValue(val.slice(0, pos) + this.killRing + val.slice(pos), pos + this.killRing.length);
      }
      return;
    }

    // Ctrl+H: Backspace
    if (e.ctrlKey && e.key.toLowerCase() === 'h') {
      e.preventDefault();
      const val = this.input.value;
      const pos = this.input.selectionStart || 0;
      if (pos > 0) {
        this.setInputValue(val.slice(0, pos - 1) + val.slice(pos), pos - 1);
      }
      return;
    }

    // Ctrl+D: Delete character or display persistent session logout notice
    if (e.ctrlKey && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      const val = this.input.value;
      const pos = this.input.selectionStart || 0;
      if (val.length > 0) {
        if (pos < val.length) {
          this.setInputValue(val.slice(0, pos) + val.slice(pos + 1), pos);
        }
      } else {
        this.shell.print('logout: not permitted in this session (session is persistent).', 'color-yellow');
        this.shell.print("Type '<span class=\"blue cmd-link\" data-cmd=\"help\">help</span>' or '<span class=\"blue cmd-link\" data-cmd=\"man -k .\">man -k .</span>' to explore available terminal commands.");
        this.shell.updatePrompt();
      }
      return;
    }

    // 8. Transformations (Transpose & Case)
    // Ctrl+T: Transpose characters
    if (e.ctrlKey && e.key.toLowerCase() === 't') {
      e.preventDefault();
      const val = this.input.value;
      const pos = this.input.selectionStart || 0;
      if (val.length >= 2) {
        if (pos === val.length) {
          const newVal = val.slice(0, pos - 2) + val[pos - 1] + val[pos - 2];
          this.setInputValue(newVal, pos);
        } else if (pos > 0) {
          const newVal = val.slice(0, pos - 1) + val[pos] + val[pos - 1] + val.slice(pos + 1);
          this.setInputValue(newVal, pos + 1);
        }
      }
      return;
    }

    // Alt+T: Transpose words
    if (e.altKey && e.key.toLowerCase() === 't') {
      e.preventDefault();
      const val = this.input.value;
      const pos = this.input.selectionStart || 0;

      let pEnd = pos;
      while (pEnd > 0 && /\s/.test(val[pEnd - 1])) pEnd--;
      let pStart = pEnd;
      while (pStart > 0 && !/\s/.test(val[pStart - 1])) pStart--;

      let nStart = pos;
      while (nStart < val.length && /\s/.test(val[nStart])) nStart++;
      let nEnd = nStart;
      while (nEnd < val.length && !/\s/.test(val[nEnd])) nEnd++;

      if (pStart < pEnd && nStart < nEnd) {
        const w1 = val.slice(pStart, pEnd);
        const mid = val.slice(pEnd, nStart);
        const w2 = val.slice(nStart, nEnd);
        const newVal = val.slice(0, pStart) + w2 + mid + w1 + val.slice(nEnd);
        this.setInputValue(newVal, pStart + w2.length + mid.length + w1.length);
      }
      return;
    }

    // Alt+U / Alt+L / Alt+C: Word case manipulation
    if (e.altKey && (e.key.toLowerCase() === 'u' || e.key.toLowerCase() === 'l' || e.key.toLowerCase() === 'c')) {
      e.preventDefault();
      const val = this.input.value;
      const pos = this.input.selectionStart || 0;
      const next = this.getNextWordPos(val, pos);
      const word = val.slice(pos, next);
      let transformed = word;
      if (e.key.toLowerCase() === 'u') {
        transformed = word.toUpperCase();
      } else if (e.key.toLowerCase() === 'l') {
        transformed = word.toLowerCase();
      } else if (e.key.toLowerCase() === 'c') {
        transformed = word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      }
      this.setInputValue(val.slice(0, pos) + transformed + val.slice(next), next);
      return;
    }

    // 9. History Navigation & Argument Yanking
    // Alt+. / Alt+_: Yank last argument of previous commands
    if (e.altKey && (e.key === '.' || e.key === '_')) {
      e.preventDefault();
      const history = this.shell.commandHistory;
      if (history.length > 0) {
        this.lastArgCycleIndex++;
        const targetIdx = history.length - 1 - this.lastArgCycleIndex;
        if (targetIdx >= 0) {
          const targetCmd = history[targetIdx];
          const parsedArgs = parseArgs(targetCmd);
          const lastArg = parsedArgs.length > 0 ? parsedArgs[parsedArgs.length - 1] : '';
          const val = this.input.value;
          const pos = this.input.selectionStart || 0;

          if (this.lastArgCycleIndex > 0) {
            const start = Math.max(0, pos - this.lastInsertedArgLen);
            this.setInputValue(val.slice(0, start) + lastArg + val.slice(pos), start + lastArg.length);
          } else {
            this.setInputValue(val.slice(0, pos) + lastArg + val.slice(pos), pos + lastArg.length);
          }
          this.lastInsertedArgLen = lastArg.length;
        } else {
          this.lastArgCycleIndex = -1;
        }
      }
      return;
    }

    // Alt+<: Oldest command in history
    if (e.altKey && (e.key === '<' || e.key === ',')) {
      e.preventDefault();
      const history = this.shell.commandHistory;
      if (history.length > 0) {
        if (this.shell.historyIndex === history.length) {
          this.historyDraft = this.input.value;
        }
        this.shell.historyIndex = 0;
        this.setInputValue(history[0]);
      }
      return;
    }

    // Alt+>: Newest command / clear prompt
    if (e.altKey && (e.key === '>' || (e.shiftKey && e.key === '.'))) {
      e.preventDefault();
      this.shell.historyIndex = this.shell.commandHistory.length;
      this.setInputValue(this.historyDraft || '');
      return;
    }

    // Ctrl+P / ArrowUp: Previous command
    if ((e.ctrlKey && e.key.toLowerCase() === 'p') || (!e.ctrlKey && !e.altKey && e.key === 'ArrowUp')) {
      e.preventDefault();
      const history = this.shell.commandHistory;
      if (history.length > 0 && this.shell.historyIndex > 0) {
        if (this.shell.historyIndex === history.length) {
          this.historyDraft = this.input.value;
        }
        this.shell.historyIndex--;
        this.setInputValue(history[this.shell.historyIndex]);
      }
      return;
    }

    // Ctrl+N / ArrowDown: Next command
    if ((e.ctrlKey && e.key.toLowerCase() === 'n') || (!e.ctrlKey && !e.altKey && e.key === 'ArrowDown')) {
      e.preventDefault();
      const history = this.shell.commandHistory;
      if (this.shell.historyIndex < history.length - 1) {
        this.shell.historyIndex++;
        this.setInputValue(history[this.shell.historyIndex]);
      } else if (this.shell.historyIndex === history.length - 1) {
        this.shell.historyIndex = history.length;
        this.setInputValue(this.historyDraft || '');
      }
      return;
    }

    // 10. Command Submission (Enter, Ctrl+J, Ctrl+M)
    if ((e.ctrlKey && (e.key.toLowerCase() === 'j' || e.key.toLowerCase() === 'm')) || (!e.ctrlKey && !e.altKey && e.key === 'Enter')) {
      e.preventDefault();
      const val = this.input.value;
      this.setInputValue('', 0);
      await this.onSubmit(val);
      return;
    }

    // 11. Autocomplete (Tab)
    if (e.key === 'Tab') {
      e.preventDefault();
      this.onTab();
      return;
    }
  }
}
