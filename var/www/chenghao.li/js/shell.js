import { audio } from './audio.js';
import { parseMarkdown, escapeHTML } from './utils/markdown.js';
import {
  HOSTNAME,
  DEFAULT_USERNAME,
  HOME_PATH,
  LOCAL_BOOT_PROMPT,
  PROMPT_SYMBOL,
  MAX_TERMINAL_OUTPUT_LINES,
  TYPEWRITER_DEFAULT_DELAY
} from './config.js';

function findCommentIndex(str) {
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaped = false;

  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }
    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }
    if (char === '#' && !inSingleQuote && !inDoubleQuote) {
      if (i === 0 || /\s/.test(str[i - 1])) {
        return i;
      }
    }
  }
  return -1;
}

function parseArgs(cmdStr) {
  const args = [];
  let current = '';
  let inDoubleQuote = false;
  let inSingleQuote = false;
  let escaped = false;

  for (let i = 0; i < cmdStr.length; i++) {
    const char = cmdStr[i];
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }
    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }
    if (/\s/.test(char) && !inDoubleQuote && !inSingleQuote) {
      if (current !== '') {
        args.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }
  if (current !== '') {
    args.push(current);
  }
  return args;
}

function splitCommandChains(str) {
  const commands = [];
  let current = '';
  let inDoubleQuote = false;
  let inSingleQuote = false;
  let escaped = false;

  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      current += char;
      escaped = true;
      continue;
    }
    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      current += char;
      continue;
    }
    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      current += char;
      continue;
    }

    if (!inDoubleQuote && !inSingleQuote) {
      if (char === ';') {
        if (current.trim()) commands.push(current.trim());
        current = '';
        continue;
      }
      if (char === '&' && str[i + 1] === '&') {
        if (current.trim()) commands.push(current.trim());
        current = '';
        i++;
        continue;
      }
    }
    current += char;
  }
  if (current.trim()) {
    commands.push(current.trim());
  }
  return commands;
}

export class Shell {
  constructor(options = {}) {
    this.body = document.getElementById('terminal-body');
    this.output = document.getElementById('terminal-output');
    this.glowBackdrops = [
      document.getElementById('terminal-glow-backdrop-1'),
      document.getElementById('terminal-glow-backdrop-2')
    ];
    this.activeGlowIdx = 0;
    this.inputLine = document.getElementById('input-line');
    this.promptPrefix = document.getElementById('prompt-prefix');
    this.inputDisplay = document.getElementById('input-display');
    this.input = document.getElementById('terminal-input');

    this.hostname = options.hostname || HOSTNAME;
    this.currentUsername = options.username || DEFAULT_USERNAME;
    this.homePath = options.homePath || HOME_PATH;
    this.localPrompt = options.localPrompt || LOCAL_BOOT_PROMPT;
    this.promptSymbol = options.promptSymbol || PROMPT_SYMBOL;

    this.loginState = 'BOOTING';
    this.currentPath = [...this.homePath];
    this.previousPath = null;
    this.commandHistory = [];
    this.historyIndex = -1;
    this.activeInputResolver = null;
    this.activeInputAbortResolver = null;
    this.abortSignal = false;
    this.isExecutingCommand = false;
    this.isBooting = false;

    this.fileSystem = options.fileSystem || null;
    this.commands = options.commands || {};
    this.onConnect = options.onConnect || null;
    this.typewriterDelay = options.typewriterDelay !== undefined ? options.typewriterDelay : (options.typeSpeed !== undefined ? options.typeSpeed : TYPEWRITER_DEFAULT_DELAY);
    this.placeholder = document.getElementById('input-placeholder');

    // Readline editing and search state
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
  }

  setInputValue(newVal, newCursorPos = null) {
    this.input.value = newVal;
    const pos = newCursorPos !== null ? Math.max(0, Math.min(newVal.length, newCursorPos)) : newVal.length;
    this.input.setSelectionRange(pos, pos);
    this.updateInputDisplay(newVal);
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
    if (!query) return startIdx >= 0 && startIdx < this.commandHistory.length ? startIdx : -1;
    const qLower = query.toLowerCase();
    for (let i = startIdx; i >= 0; i--) {
      if (this.commandHistory[i].toLowerCase().includes(qLower)) {
        return i;
      }
    }
    return -1;
  }

  updateSearchDisplay() {
    const failedText = this.searchFailed ? 'failed ' : '';
    this.promptPrefix.innerHTML = `<span class="color-accent">(${failedText}reverse-i-search)\`${this.escapeHTML(this.searchQuery)}\`: </span>`;

    const match = this.searchMatch || '';
    if (this.searchQuery && match) {
      const qLower = this.searchQuery.toLowerCase();
      const matchLower = match.toLowerCase();
      const idx = matchLower.indexOf(qLower);
      if (idx !== -1) {
        const before = this.escapeHTML(match.slice(0, idx));
        const matched = this.escapeHTML(match.slice(idx, idx + this.searchQuery.length));
        const after = this.escapeHTML(match.slice(idx + this.searchQuery.length));
        this.inputDisplay.innerHTML = `${before}<span class="color-dir" style="text-decoration: underline;">${matched}</span>${after}<span class="terminal-cursor" id="cursor">&nbsp;</span>`;
      } else {
        this.inputDisplay.innerHTML = `${this.escapeHTML(match)}<span class="terminal-cursor" id="cursor">&nbsp;</span>`;
      }
    } else {
      this.inputDisplay.innerHTML = `${this.escapeHTML(match)}<span class="terminal-cursor" id="cursor">&nbsp;</span>`;
    }
  }

  exitSearchMode(cancel = false) {
    this.searchMode = false;
    this.searchQuery = '';
    this.searchFailed = false;
    this.searchMatch = '';
    this.searchMatchIndex = -1;
    this.promptPrefix.innerHTML = this.getPromptHtml();
    if (cancel) {
      this.setInputValue(this.searchSavedInput, this.searchSavedCursor);
    }
  }

  getPromptHtml(promptSuffix = this.promptSymbol, displayPath = this.formatDisplayPath()) {
    return `<span class="color-accent"><span class="red">${this.currentUsername}</span>@${this.hostname}</span>:<span class="color-dir">${displayPath}</span>${promptSuffix}`;
  }

  formatDisplayPath(pathArr = this.currentPath) {
    const isHome = pathArr.length >= this.homePath.length &&
      this.homePath.every((part, idx) => pathArr[idx] === part);
    if (isHome) {
      if (pathArr.length === this.homePath.length) {
        return '~';
      }
      return '~/' + pathArr.slice(this.homePath.length).join('/');
    }
    if (pathArr.length === 0) {
      return '/';
    }
    return '/' + pathArr.join('/');
  }

  mount() {
    if (this.isMounted) return;
    this.isMounted = true;

    // Handle deep links when user navigates history
    window.addEventListener('popstate', async () => {
      if (this.loginState !== 'LOGGED_IN' || this.isBooting || this.isExecutingCommand) return;
      const { initialPath, initialCommand } = this.getInitialDeepLink();
      if (initialPath && this.fileSystem) {
        const resolved = this.fileSystem.resolvePath(this.currentPath, initialPath);
        if (resolved !== null) {
          const targetObj = this.fileSystem.getNodeByPath(resolved);
          if (typeof targetObj === 'object') {
            this.currentPath = resolved;
            this.updatePrompt();
          }
        }
      }
      if (initialCommand) {
        await this.handleInputSubmit(initialCommand);
      }
    });

    // Background preloading of lazy commands metadata
    for (const [name, cmd] of Object.entries(this.commands)) {
      if (cmd.lazy) {
        cmd.import().then(module => {
          const loadedCmd = module[name];
          if (loadedCmd) {
            Object.assign(cmd, loadedCmd);
            cmd.lazy = false;
          }
        }).catch(err => {
          console.error(`Failed to preload metadata for command: ${name}`, err);
        });
      }
    }


    // Sync glow backdrop using a dual-layer cross-fade
    const backdropsExist = this.glowBackdrops[0] && this.glowBackdrops[1];
    if (backdropsExist && this.output) {
      let throttleTimeout = null;
      const observer = new MutationObserver(() => {
        if (!throttleTimeout) {
          throttleTimeout = setTimeout(() => {
            if (this.output) {
              const currentActive = this.glowBackdrops[this.activeGlowIdx];
              const nextActiveIdx = (this.activeGlowIdx + 1) % 2;
              const nextActive = this.glowBackdrops[nextActiveIdx];

              if (currentActive && nextActive) {
                const childCount = this.output.children.length;
                const maxGlowLines = 85;
                const startIndex = Math.max(0, childCount - maxGlowLines);

                // 1. Clear and populate the inactive layer
                nextActive.innerHTML = '';
                const fragment = document.createDocumentFragment();
                for (let i = startIndex; i < childCount; i++) {
                  fragment.appendChild(this.output.children[i].cloneNode(true));
                }
                nextActive.appendChild(fragment);

                // 2. Cross-fade by swapping class
                nextActive.classList.add('active');
                currentActive.classList.remove('active');

                // 3. Switch active pointer
                this.activeGlowIdx = nextActiveIdx;
              }
            }
            throttleTimeout = null;
          }, 150);
        }
      });
      observer.observe(this.output, {
        childList: true,
        subtree: true,
        characterData: true
      });

      // Initial sync on first active backdrop
      const initialActive = this.glowBackdrops[0];
      if (initialActive) {
        initialActive.innerHTML = '';
        const fragment = document.createDocumentFragment();
        const childCount = this.output.children.length;
        const startIndex = Math.max(0, childCount - 85);
        for (let i = startIndex; i < childCount; i++) {
          fragment.appendChild(this.output.children[i].cloneNode(true));
        }
        initialActive.appendChild(fragment);
      }
    }

    // Input visual mirroring and cursor synchronization throttled to requestAnimationFrame
    let rafId = null;
    const syncCursor = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        this.updateInputDisplay(this.input.value);
        rafId = null;
      });
    };

    this.input.addEventListener('input', syncCursor);
    this.input.addEventListener('keyup', syncCursor);
    this.input.addEventListener('click', syncCursor);
    this.input.addEventListener('focus', syncCursor);
    this.input.addEventListener('keydown', (e) => {
      const cursorKeys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Backspace', 'Delete'];
      if (cursorKeys.includes(e.key)) {
        syncCursor();
      }
    });

    this.inputLine.addEventListener('click', (e) => {
      const isInteractive = e.target.closest('a') || e.target.closest('button') || e.target.closest('.cmd-link');
      if (!isInteractive) {
        e.stopPropagation();
        this.input.selectionStart = this.input.selectionEnd = this.input.value.length;
        syncCursor();
        this.focus();
      }
    });

    // Special keyboard listeners (GNU Readline Emacs Mode & Terminal Control)
    this.input.addEventListener('keydown', async (e) => {
      if (this.loginState !== 'LOGGED_IN' || this.isBooting) return;

      // 1. ReadInput Sub-Prompt Handling
      if (this.activeInputResolver) {
        if (e.key === 'Enter') {
          const val = this.input.value;
          this.input.value = '';
          this.inputDisplay.textContent = '';
          const resolve = this.activeInputResolver;
          this.activeInputResolver = null;
          this.activeInputAbortResolver = null;
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
            this.searchMatch = this.commandHistory[nextIdx];
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
          const matchIdx = this.findSearchMatch(this.searchQuery, this.commandHistory.length - 1);
          if (matchIdx !== -1) {
            this.searchMatchIndex = matchIdx;
            this.searchMatch = this.commandHistory[matchIdx];
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
            await this.handleInputSubmit(chosenCmd);
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
          const matchIdx = this.findSearchMatch(this.searchQuery, this.commandHistory.length - 1);
          if (matchIdx !== -1) {
            this.searchMatchIndex = matchIdx;
            this.searchMatch = this.commandHistory[matchIdx];
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
        this.body.scrollBy({ top: -this.body.clientHeight * 0.75, behavior: 'smooth' });
        return;
      }
      if (e.key === 'PageDown') {
        e.preventDefault();
        this.body.scrollBy({ top: this.body.clientHeight * 0.75, behavior: 'smooth' });
        return;
      }
      if (e.shiftKey && e.key === 'Home') {
        e.preventDefault();
        this.body.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      if (e.shiftKey && e.key === 'End') {
        e.preventDefault();
        this.body.scrollTo({ top: this.body.scrollHeight, behavior: 'smooth' });
        return;
      }

      // 4. Screen & Terminal Controls
      if (e.ctrlKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        const currentVal = this.input.value;
        const currentPos = this.input.selectionStart || 0;
        this.clear();
        this.promptPrefix.innerHTML = this.getPromptHtml();
        this.setInputValue(currentVal, currentPos);
        this.focus();
        return;
      }

      if (e.ctrlKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (this.isExecutingCommand) {
          this.abortSignal = true;
          this.print('^Z\n[1]+  Stopped', 'color-dim');
        } else {
          this.print('^Z', 'color-dim');
          this.updatePrompt();
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
          this.print('logout: not permitted in this session (session is persistent).', 'color-yellow');
          this.print("Type '<span class=\"blue cmd-link\" data-cmd=\"help\">help</span>' to explore available terminal commands.");
          this.updatePrompt();
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
        if (this.commandHistory.length > 0) {
          this.lastArgCycleIndex++;
          const targetIdx = this.commandHistory.length - 1 - this.lastArgCycleIndex;
          if (targetIdx >= 0) {
            const targetCmd = this.commandHistory[targetIdx];
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
        if (this.commandHistory.length > 0) {
          if (this.historyIndex === this.commandHistory.length) {
            this.historyDraft = this.input.value;
          }
          this.historyIndex = 0;
          this.setInputValue(this.commandHistory[0]);
        }
        return;
      }

      // Alt+>: Newest command / clear prompt
      if (e.altKey && (e.key === '>' || (e.shiftKey && e.key === '.'))) {
        e.preventDefault();
        this.historyIndex = this.commandHistory.length;
        this.setInputValue(this.historyDraft || '');
        return;
      }

      // Ctrl+P / ArrowUp: Previous command
      if ((e.ctrlKey && e.key.toLowerCase() === 'p') || (!e.ctrlKey && !e.altKey && e.key === 'ArrowUp')) {
        e.preventDefault();
        if (this.commandHistory.length > 0 && this.historyIndex > 0) {
          if (this.historyIndex === this.commandHistory.length) {
            this.historyDraft = this.input.value;
          }
          this.historyIndex--;
          this.setInputValue(this.commandHistory[this.historyIndex]);
        }
        return;
      }

      // Ctrl+N / ArrowDown: Next command
      if ((e.ctrlKey && e.key.toLowerCase() === 'n') || (!e.ctrlKey && !e.altKey && e.key === 'ArrowDown')) {
        e.preventDefault();
        if (this.historyIndex < this.commandHistory.length - 1) {
          this.historyIndex++;
          this.setInputValue(this.commandHistory[this.historyIndex]);
        } else if (this.historyIndex === this.commandHistory.length - 1) {
          this.historyIndex = this.commandHistory.length;
          this.setInputValue(this.historyDraft || '');
        }
        return;
      }

      // 10. Command Submission (Enter, Ctrl+J, Ctrl+M)
      if ((e.ctrlKey && (e.key.toLowerCase() === 'j' || e.key.toLowerCase() === 'm')) || (!e.ctrlKey && !e.altKey && e.key === 'Enter')) {
        e.preventDefault();
        const val = this.input.value;
        this.setInputValue('', 0);
        await this.handleInputSubmit(val);
        return;
      }

      // 11. Autocomplete (Tab)
      if (e.key === 'Tab') {
        e.preventDefault();
        this.handleTabAutocomplete();
        return;
      }
    });

    // Capture Ctrl+C interrupts across document
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key.toLowerCase() === 'c') {
        if (window.getSelection().toString() === '') {
          e.preventDefault();
          this.abortSignal = true;

          if (this.searchMode) {
            this.exitSearchMode(true);
            return;
          }

          if (this.activeInputAbortResolver) {
            const abort = this.activeInputAbortResolver;
            this.activeInputAbortResolver = null;
            this.activeInputResolver = null;
            abort();
            return;
          }

          if (this.loginState === 'LOGGED_IN' && !this.isBooting && !this.input.disabled) {
            const currentVal = this.input.value;
            this.print(`${this.getPromptHtml()} ${this.escapeHTML(currentVal)}^C`);
            this.setInputValue('', 0);
            this.updatePrompt();
            this.focus();
          }
        }
      }
    });

    // Authentic X11 mouse selection auto-copy
    document.addEventListener('mouseup', () => {
      const selected = window.getSelection().toString();
      if (selected && selected.trim() !== '') {
        try {
          navigator.clipboard.writeText(selected);
        } catch (_) {}
      }
    });

    // Authentic X11 right-click & middle-click paste into prompt
    document.addEventListener('contextmenu', async (e) => {
      if (this.loginState !== 'LOGGED_IN' || this.isBooting || this.isExecutingCommand) return;
      const selected = window.getSelection().toString();
      if (!selected) {
        e.preventDefault();
        try {
          const text = await navigator.clipboard.readText();
          if (text) {
            const pos = this.input.selectionStart || 0;
            const val = this.input.value;
            this.setInputValue(val.slice(0, pos) + text + val.slice(pos), pos + text.length);
            this.focus();
          }
        } catch (_) {}
      }
    });

    document.addEventListener('auxclick', async (e) => {
      if (e.button === 1) { // Middle click
        if (this.loginState !== 'LOGGED_IN' || this.isBooting || this.isExecutingCommand) return;
        e.preventDefault();
        try {
          const text = await navigator.clipboard.readText();
          if (text) {
            const pos = this.input.selectionStart || 0;
            const val = this.input.value;
            this.setInputValue(val.slice(0, pos) + text + val.slice(pos), pos + text.length);
            this.focus();
          }
        } catch (_) {}
      }
    });

    // Delegate click handling across document
    document.addEventListener('click', async (e) => {
      const target = e.target;
      const isInteractive = target.closest('a, button, input, .cmd-link, .ls-item, .contact-link');

      if (isInteractive) {
        audio.playLinkClick();
      }

      // Handle focus redirection
      if (this.loginState !== 'GAME' && !this.isBooting) {
        const selectedText = window.getSelection().toString();
        if (!selectedText) {
          this.focus();
        }
      }

      // Handle interactive item clicks (ls-item and cmd-link)
      if (this.loginState === 'LOGGED_IN' && !this.isExecutingCommand && !this.isBooting) {
        if (target.classList.contains('ls-item')) {
          e.stopPropagation();
          const type = target.getAttribute('data-type');
          const path = target.getAttribute('data-path');

          if (path) {
            const targetPathArr = path.split('/').filter(s => s.length > 0);
            const relativePath = this.fileSystem.getRelativePath(this.currentPath, targetPathArr);

            if (type === 'dir') {
              await this.handleInputSubmit(`cd ${relativePath}`);
              await this.handleInputSubmit('ls');
            } else if (type === 'file') {
              await this.handleInputSubmit(`cat ${relativePath}`);
            } else if (type === 'broken') {
              this.print(`ls: cannot access '${relativePath}': No such file or directory`, 'color-error');
            }
          }
        } else if (target.classList.contains('cmd-link')) {
          e.stopPropagation();
          const cmd = target.getAttribute('data-cmd');
          if (cmd) {
            await this.handleInputSubmit(cmd);
          }
        }
      }
    });
  }

  print(htmlContent, className = 'color-text') {
    const line = document.createElement('div');
    line.className = className;
    line.innerHTML = htmlContent;
    this.output.appendChild(line);

    while (this.output.children.length > MAX_TERMINAL_OUTPUT_LINES) {
      this.output.removeChild(this.output.firstChild);
    }

    this.body.scrollTop = this.body.scrollHeight;
    return line;
  }

  updateInputDisplay(text) {
    // 1. Toggle placeholder visibility (only show when logged in and no sub-prompt)
    if (this.loginState === 'LOGGED_IN' && !this.activeInputResolver && text === '') {
      if (this.placeholder) this.placeholder.style.display = 'inline';
    } else {
      if (this.placeholder) this.placeholder.style.display = 'none';
    }

    const selStart = text === this.input.value ? (this.input.selectionStart || 0) : text.length;
    const formatSegment = (str) => {
      return escapeHTML(str).replace(/ /g, '\u00A0');
    };

    const getCursorHTML = (char) => {
      const displayChar = (char === '' || char === ' ' || char === '\n') ? '\u00A0' : char;
      return `<span class="terminal-cursor" id="cursor">${escapeHTML(displayChar)}</span>`;
    };

    // 2. Render text with the cursor embedded at selStart
    if (text === '') {
      this.inputDisplay.innerHTML = getCursorHTML('');
    } else if (this.activeInputResolver) {
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

  readInput(promptText) {
    return new Promise((resolve) => {
      const originalPrefixHTML = this.promptPrefix.innerHTML;
      this.input.disabled = false;
      this.inputLine.style.visibility = 'visible';
      this.promptPrefix.innerHTML = promptText;
      this.input.value = '';

      const cleanup = () => {
        this.input.disabled = true;
        this.inputLine.style.visibility = 'hidden';
        this.promptPrefix.innerHTML = originalPrefixHTML;
        this.activeInputResolver = null;
        this.activeInputAbortResolver = null;
      };

      this.activeInputResolver = (val) => {
        // Echo the prompt + typed value into the output before hiding
        this.print(`${promptText}${val}`);
        cleanup();
        resolve(val);
      };

      // Allow Ctrl+C to break out of readInput by resolving with null
      this.activeInputAbortResolver = () => {
        // Echo the prompt + typed text + ^C before hiding
        this.print(`${promptText}${this.input.value}^C`);
        cleanup();
        resolve(null);
      };

      this.updateInputDisplay('');
      this.focus();
    });
  }

  parseMarkdown(text, basePathArr = []) {
    return parseMarkdown(text, this.fileSystem ? this.fileSystem.root : {}, basePathArr);
  }

  escapeHTML(text) {
    return escapeHTML(text);
  }

  clear() {
    this.output.innerHTML = '';
    this.glowBackdrops.forEach(el => {
      if (el) el.innerHTML = '';
    });
    this.body.scrollTop = 0;
  }

  focus() {
    if (this.input) {
      this.input.focus();
    }
  }

  updatePrompt() {
    if (this.loginState === 'LOGGED_IN') {
      this.promptPrefix.innerHTML = this.getPromptHtml();
      this.input.value = '';
      this.updateInputDisplay('');
      if (typeof document !== 'undefined') {
        document.title = `${this.currentUsername}@${this.hostname}: ${this.formatDisplayPath()}`;
      }
    } else if (this.loginState === 'BOOTING') {
      this.inputDisplay.textContent = '';
      this.input.value = '';
    }
  }

  async handleInputSubmit(val) {
    if (this.loginState !== 'LOGGED_IN' || this.isExecutingCommand) return;

    this.isExecutingCommand = true;
    this.historyDraft = '';
    const trimmed = val.trim();
    if (trimmed !== '') {
      if (this.commandHistory.length === 0 || this.commandHistory[this.commandHistory.length - 1] !== trimmed) {
        this.commandHistory.push(trimmed);
      }
      this.historyIndex = this.commandHistory.length;
    }

    this.input.disabled = true;
    this.inputLine.style.visibility = 'hidden';

    try {
      await this.executeCommand(val);
    } catch (err) {
      this.print(`Error executing command: ${err.message}`, 'color-error');
      console.error(err);
    } finally {
      this.isExecutingCommand = false;
      this.inputLine.style.visibility = 'visible';
      this.input.disabled = this.isBooting;
      this.updatePrompt();
      if (!this.isBooting) {
        this.focus();
      }
      this.abortSignal = false;
    }
  }

  async executeCommand(cmdStr) {
    let trimmed = cmdStr.trim();
    if (trimmed === '') return;

    // 1. Bash History Expansions (!! and !$)
    if (this.commandHistory.length > 1) {
      const prevCmd = this.commandHistory[this.commandHistory.length - 2];
      const prevArgs = parseArgs(prevCmd);
      const prevLastArg = prevArgs.length > 0 ? prevArgs[prevArgs.length - 1] : '';

      let expanded = false;
      if (trimmed.includes('!!')) {
        trimmed = trimmed.replace(/!!/g, prevCmd);
        expanded = true;
      }
      if (trimmed.includes('!$')) {
        trimmed = trimmed.replace(/!\$/g, prevLastArg);
        expanded = true;
      }
      if (expanded) {
        this.commandHistory[this.commandHistory.length - 1] = trimmed;
        this.print(this.escapeHTML(trimmed), 'color-dim');
      }
    }

    // 2. Command Chaining (; and &&)
    const chains = splitCommandChains(trimmed);
    if (chains.length > 1) {
      for (const singleCmd of chains) {
        if (this.abortSignal) break;
        await this.executeSingleCommand(singleCmd);
      }
      return;
    }

    await this.executeSingleCommand(trimmed);
  }

  async executeSingleCommand(cmdStr) {
    const trimmed = cmdStr.trim();
    if (trimmed === '') return;

    const displayPath = this.formatDisplayPath();

    const commentIdx = findCommentIndex(trimmed);
    let commandPart = trimmed;
    let printedLine = escapeHTML(trimmed);
    if (commentIdx !== -1) {
      const commandPartStr = trimmed.slice(0, commentIdx);
      const commentPartStrFull = trimmed.slice(commentIdx);
      printedLine = escapeHTML(commandPartStr) + `<span class="color-dim">${escapeHTML(commentPartStrFull)}</span>`;
      commandPart = commandPartStr.trim();
    }

    this.print(`${this.getPromptHtml()} ${printedLine}`);

    if (commandPart === '') return;

    const parts = parseArgs(commandPart);
    if (parts.length === 0) return;
    const command = parts[0].toLowerCase();
    const args = parts.slice(1);

    this.abortSignal = false;

    if (typeof document !== 'undefined') {
      document.title = `${command} - ${this.currentUsername}@${this.hostname}: ${displayPath}`;
    }

    if (command !== 'cd' && !this.isBooting) {
      this.updateBrowserUrl(this.formatDisplayPath(), commandPart);
    }

    try {
      if (this.commands[command]) {
        const cmd = this.commands[command];

        if (cmd.lazy) {
          try {
            const module = await cmd.import();
            const loadedCmd = module[command];
            if (loadedCmd) {
              Object.assign(cmd, loadedCmd);
              cmd.lazy = false;
            }
          } catch (err) {
            this.print(`Failed to load command '${command}': ${err.message}`, 'color-error');
            return;
          }
        }

        // Intercept -h or --help to display detailed command help
        if (args.length === 1 && (args[0] === '-h' || args[0] === '--help')) {
          await this.commands.help.run([command], this);
          return;
        }

        // Automatically validate required arguments
        if (cmd.args && cmd.args.length > 0) {
          const requiredArgs = cmd.args.filter(a => a.required);
          if (args.length < requiredArgs.length) {
            const missingArg = requiredArgs[args.length];
            let usage = cmd.name;
            const argUsageStrings = cmd.args.map(a => a.required ? `&lt;${escapeHTML(a.name)}&gt;` : `[${escapeHTML(a.name)}]`);
            if (argUsageStrings.length > 0) {
              usage += ' ' + argUsageStrings.join(' ');
            }
            this.print(`${command}: missing required argument &lt;${escapeHTML(missingArg.name)}&gt;. Usage: <span class="color-green">${usage}</span>`, 'color-error');
            return;
          }
        }

        await cmd.run(args, this);
        return;
      }

      this.print(`command not found: ${command}. Type 'help' to see list of commands.`, 'color-error');
    } finally {
      if (typeof document !== 'undefined') {
        document.title = `${this.currentUsername}@${this.hostname}: ${this.formatDisplayPath()}`;
      }
    }
  }

  handleTabAutocomplete() {
    const currentVal = this.input.value;
    const trimmed = currentVal.trimStart();
    if (trimmed === '') return;

    const parts = currentVal.split(/\s+/);
    const isCommandOnly = parts.length === 1;

    const getLongestCommonPrefix = (words) => {
      if (words.length === 0) return '';
      let prefix = words[0];
      for (let i = 1; i < words.length; i++) {
        while (words[i].toLowerCase().indexOf(prefix.toLowerCase()) !== 0) {
          prefix = prefix.substring(0, prefix.length - 1);
          if (prefix === '') return '';
        }
      }
      return prefix;
    };

    if (isCommandOnly) {
      const typedCmd = parts[0].toLowerCase();
      const availableCmds = Object.keys(this.commands);
      const matches = availableCmds.filter(cmd => cmd.startsWith(typedCmd));

      if (matches.length === 1) {
        this.setInputValue(matches[0] + ' ');
      } else if (matches.length > 1) {
        const lcp = getLongestCommonPrefix(matches);
        if (lcp.length > typedCmd.length) {
          this.setInputValue(lcp);
        } else {
          this.print(matches.join('    '), 'color-accent');
        }
      }
    } else {
      const command = parts[0].toLowerCase();
      const cmd = this.commands[command];
      const argIdx = parts.length - 2;
      const argMetadata = (cmd && cmd.args) ? cmd.args[argIdx] : null;

      if (argMetadata && argMetadata.suggestions && argMetadata.suggestions.length > 0) {
        const typedArg = parts[parts.length - 1].toLowerCase();
        const suggestions = argMetadata.suggestions;
        const matches = suggestions.filter(s => s.startsWith(typedArg));

        if (matches.length === 1) {
          parts[parts.length - 1] = matches[0] + ' ';
          this.setInputValue(parts.join(' '));
        } else if (matches.length > 1) {
          const lcp = getLongestCommonPrefix(matches);
          if (lcp.length > typedArg.length) {
            parts[parts.length - 1] = lcp;
            this.setInputValue(parts.join(' '));
          } else {
            this.print(matches.join('    '), 'color-accent');
          }
        }
        return;
      }

      const argVal = parts[parts.length - 1];
      const slashIdx = argVal.lastIndexOf('/');
      let targetPath = [...this.currentPath];
      let prefix = argVal;

      if (slashIdx !== -1) {
        let pathPrefix = argVal.slice(0, slashIdx);
        if (pathPrefix === '' && argVal.startsWith('/')) {
          pathPrefix = '/';
        }
        prefix = argVal.slice(slashIdx + 1);

        const resolvedPrefixPath = this.fileSystem.resolvePath(this.currentPath, pathPrefix);
        if (resolvedPrefixPath === null) {
          return;
        }
        targetPath = resolvedPrefixPath;
      }

      const targetDir = this.fileSystem.getNodeByPath(targetPath);
      if (!targetDir || typeof targetDir !== 'object') return;

      const dirKeys = Object.keys(targetDir);
      if (targetPath.length > 0) {
        dirKeys.push('..');
      }

      const prefixLower = prefix.toLowerCase();
      const matches = dirKeys.filter(key => key.toLowerCase().startsWith(prefixLower));

      if (matches.length === 1) {
        const matchedName = matches[0];
        const itemNode = targetDir[matchedName];
        const isLink = itemNode !== null && typeof itemNode === 'object' && typeof itemNode.symlink === 'string';
        let isDirNode = matchedName === '..' || typeof targetDir[matchedName] === 'object';
        if (isLink) {
          const resolved = this.fileSystem.resolvePath(targetPath, itemNode.symlink);
          isDirNode = resolved !== null && typeof this.fileSystem.getNodeByPath(resolved) === 'object';
        }
        const completedArg = (slashIdx !== -1 ? argVal.slice(0, slashIdx + 1) : '') + matchedName + (isDirNode ? '/' : ' ');

        parts[parts.length - 1] = completedArg;
        this.setInputValue(parts.join(' '));
      } else if (matches.length > 1) {
        const lcp = getLongestCommonPrefix(matches);
        if (lcp.length > prefix.length) {
          const completedPrefix = (slashIdx !== -1 ? argVal.slice(0, slashIdx + 1) : '') + lcp;
          parts[parts.length - 1] = completedPrefix;
          this.setInputValue(parts.join(' '));
        } else {
          const formattedMatches = matches.map(matchedName => {
            const itemNode = targetDir[matchedName];
            const isLink = itemNode !== null && typeof itemNode === 'object' && typeof itemNode.symlink === 'string';
            if (isLink) {
              const resolved = this.fileSystem.resolvePath(targetPath, itemNode.symlink);
              const isDir = resolved !== null && typeof this.fileSystem.getNodeByPath(resolved) === 'object';
              return `<span class="cyan">${matchedName}@</span>`;
            }
            const isDirNode = matchedName === '..' || typeof targetDir[matchedName] === 'object';
            return isDirNode ? `<span class="color-dir">${matchedName}/</span>` : `<span class="color-file">${matchedName}</span>`;
          });
          this.print(formattedMatches.join('    '));
        }
      }
    }
  }

  async typeCommand(text, speed = this.typewriterDelay) {
    // Parse inline delay tags like <d:500> or <delay:500>
    const tokens = [];
    const regex = /<(?:d|delay):(\d+)>/gi;
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        tokens.push({ type: 'text', value: text.slice(lastIndex, match.index) });
      }
      tokens.push({ type: 'delay', ms: parseInt(match[1], 10) });
      lastIndex = regex.lastIndex;
    }
    if (lastIndex < text.length) {
      tokens.push({ type: 'text', value: text.slice(lastIndex) });
    }

    let displayedText = '';
    let globalCharIndex = 0;

    for (const token of tokens) {
      if (token.type === 'delay') {
        if (token.ms > 0) {
          await new Promise(resolve => setTimeout(resolve, token.ms));
        }
      } else if (token.type === 'text') {
        for (let i = 0; i < token.value.length; i++) {
          const char = token.value[i];
          displayedText += char;
          this.updateInputDisplay(displayedText);
          audio.playKeyclick(char);

          let delay = 50;
          if (typeof speed === 'number') {
            delay = speed;
          } else if (typeof speed === 'function') {
            delay = speed(char, globalCharIndex, text);
          } else if (speed && typeof speed === 'object') {
            const min = typeof speed.min === 'number' ? speed.min : 30;
            const max = typeof speed.max === 'number' ? speed.max : 80;
            delay = Math.floor(Math.random() * (max - min + 1)) + min;
          }

          if (delay > 0) {
            await new Promise(resolve => setTimeout(resolve, delay));
          }
          globalCharIndex++;
        }
      }
    }
    return displayedText;
  }

  async typeAndSubmit(text, speed = this.typewriterDelay, enter_delay = this.typewriterDelay) {
    const cleanCmd = await this.typeCommand(text, speed);
    await new Promise(resolve => setTimeout(resolve, enter_delay));
    await this.handleInputSubmit(cleanCmd);
    return cleanCmd;
  }

  getInitialDeepLink() {
    let rawPath = '';

    // 1. Check sessionStorage from 404.html redirect
    try {
      const redirect = sessionStorage.getItem('spa_redirect');
      if (redirect) {
        sessionStorage.removeItem('spa_redirect');
        rawPath = redirect;
      }
    } catch (e) { }

    // 2. If no redirect, check URL pathname, search query, or hash
    if (!rawPath && typeof window !== 'undefined') {
      if (window.location.pathname && window.location.pathname !== '/' && !window.location.pathname.endsWith('index.html')) {
        rawPath = window.location.pathname + window.location.search + window.location.hash;
      } else if (window.location.hash) {
        rawPath = window.location.hash.replace(/^#\/?/, '');
      } else if (window.location.search) {
        rawPath = window.location.search;
      }
    }

    if (!rawPath) {
      return { initialPath: '', initialCommand: '' };
    }

    // Extract path part and query part
    let pathPart = rawPath;
    let queryPart = '';
    const qIndex = rawPath.indexOf('?');
    if (qIndex !== -1) {
      pathPart = rawPath.slice(0, qIndex);
      queryPart = rawPath.slice(qIndex + 1);
    } else if (typeof window !== 'undefined' && window.location.search) {
      queryPart = window.location.search.replace(/^\?/, '');
    }

    let cleanPath = pathPart.split('#')[0].trim();
    while (cleanPath.startsWith('/')) cleanPath = cleanPath.slice(1);
    while (cleanPath.endsWith('/')) cleanPath = cleanPath.slice(0, -1);

    // Handle home (~) and legacy root paths (e.g. root/blogs -> blogs)
    let isHome = false;
    if (cleanPath === '~' || cleanPath === 'root') {
      cleanPath = '';
      isHome = true;
    } else if (cleanPath.startsWith('~/')) {
      cleanPath = cleanPath.slice(2);
      isHome = true;
    } else if (cleanPath.startsWith('root/')) {
      cleanPath = cleanPath.slice(5);
      isHome = true;
    }

    if (cleanPath === 'index.html' || cleanPath === '404.html') {
      cleanPath = '';
      isHome = true;
    }

    // Parse command parameter from query string (?md=, ?cat=, ?cmd=, ?p=, ?c=, ?run=)
    let initialCommand = '';
    if (queryPart) {
      const params = new URLSearchParams(queryPart);
      const mdParam = params.get('md');
      const catParam = params.get('cat');
      const cmdParam = params.get('cmd') || params.get('p') || params.get('c') || params.get('run') || params.get('path');

      if (mdParam !== null && mdParam !== undefined && mdParam !== '') {
        let trimmedMd = mdParam.trim();
        if (!trimmedMd.toLowerCase().endsWith('.md')) {
          trimmedMd += '.md';
        }
        initialCommand = `cat ${trimmedMd}`;
      } else if (catParam !== null && catParam !== undefined && catParam !== '') {
        initialCommand = `cat ${catParam.trim()}`;
      } else if (cmdParam) {
        let trimmedCmd = cmdParam.trim();
        // Unwrap outer matching quotes if present
        if ((trimmedCmd.startsWith('"') && trimmedCmd.endsWith('"')) ||
          (trimmedCmd.startsWith("'") && trimmedCmd.endsWith("'"))) {
          trimmedCmd = trimmedCmd.slice(1, -1);
        }
        // Unescape escaped quotes \" -> "
        trimmedCmd = trimmedCmd.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
        initialCommand = trimmedCmd;
      }
    }

    const resolvedInitialPath = isHome ? (cleanPath ? '~/' + cleanPath : '~') : (cleanPath ? '/' + cleanPath : '');

    // Immediately sync browser URL so the address bar reflects the original URL upon load
    this.updateBrowserUrl(resolvedInitialPath || (isHome ? '~' : '/'), initialCommand);

    return {
      initialPath: resolvedInitialPath,
      initialCommand: initialCommand
    };
  }

  updateBrowserUrl(pathStr, cmdStr = '') {
    if (typeof window === 'undefined' || !window.history) return;
    try {
      let raw = (pathStr || '').trim();
      let cleanPath = raw;
      while (cleanPath.startsWith('/')) cleanPath = cleanPath.slice(1);
      while (cleanPath.endsWith('/')) cleanPath = cleanPath.slice(0, -1);

      let newUrl = '/';
      if (raw === '~' || raw.startsWith('~/')) {
        let sub = raw === '~' ? '' : raw.slice(2);
        newUrl = sub ? '/~/' + sub + '/' : '/~/';
      } else if (raw.startsWith('/')) {
        newUrl = cleanPath ? '/' + cleanPath + '/' : '/';
      }

      if (cmdStr && typeof cmdStr === 'string') {
        const trimmedCmd = cmdStr.trim();
        // Omit from URL if the command is purely 'ls'
        if (trimmedCmd && trimmedCmd.toLowerCase() !== 'ls') {
          // Check for single-file 'cat <file>' shorthands (e.g. ?md=name or ?cat=name.txt)
          const catMatch = trimmedCmd.match(/^cat\s+([^\s"']+)$/i);
          if (catMatch) {
            const fileTarget = catMatch[1];
            if (fileTarget.toLowerCase().endsWith('.md')) {
              const baseName = fileTarget.slice(0, -3);
              newUrl += `?md=${baseName}`;
            } else {
              newUrl += `?cat=${fileTarget}`;
            }
          } else {
            newUrl += `?cmd=${encodeURIComponent(trimmedCmd)}`;
          }
        }
      }

      if (window.location.pathname + window.location.search + window.location.hash !== newUrl) {
        window.history.replaceState(null, '', newUrl);
      }
    } catch (e) { }
  }

  async startConnection() {
    this.loginState = 'BOOTING';
    this.isBooting = true;
    this.input.disabled = true;
    this.promptPrefix.innerHTML = `<span class="color-accent">${this.localPrompt}</span>`;
    this.inputDisplay.textContent = '';

    const { initialPath, initialCommand } = this.getInitialDeepLink();

    audio.startHum();

    const sshCmd = `ssh ${this.currentUsername}@${this.hostname}`;
    const cmdText = `ssh ${this.currentUsername}<d:100>@${this.hostname}`;
    await this.typeCommand(cmdText);

    await new Promise(resolve => setTimeout(resolve, 200));
    this.print(`<span class="color-accent">${this.localPrompt}</span> ${sshCmd}`);
    this.promptPrefix.innerHTML = '';
    this.updateInputDisplay('');

    await new Promise(resolve => setTimeout(resolve, 1000));

    if (this.onConnect) {
      await this.onConnect(this);
    }

    this.promptPrefix.innerHTML = this.getPromptHtml();
    this.loginState = 'LOGGED_IN';
    audio.fadeHumQuiet();

    await new Promise(resolve => setTimeout(resolve, 600));

    // Preset initial ls
    await this.typeAndSubmit('ls<d:200> # click items to navigate<d:75>, or use cat/cd', null, 400);

    if (initialPath && initialPath !== '~' && this.fileSystem) {
      const resolved = this.fileSystem.resolvePath(this.currentPath, initialPath);
      if (resolved !== null) {
        const targetObj = this.fileSystem.getNodeByPath(resolved);
        const isDir = typeof targetObj === 'object';

        await new Promise(resolve => setTimeout(resolve, 400));

        if (isDir) {
          await this.typeAndSubmit(`cd ${initialPath}`);
          if (!initialCommand) {
            await new Promise(resolve => setTimeout(resolve, 300));
            await this.typeAndSubmit('ls');
          }
        } else {
          // Legacy file path deep link without ?cmd=
          const slashIdx = initialPath.lastIndexOf('/');
          if (slashIdx !== -1) {
            const parentDir = initialPath.slice(0, slashIdx);
            const fileName = initialPath.slice(slashIdx + 1);
            await this.typeAndSubmit(`cd ${parentDir}`);
            await new Promise(resolve => setTimeout(resolve, 300));
            await this.typeAndSubmit(`cat ${fileName}`);
          } else {
            await this.typeAndSubmit(`cat ${initialPath}`);
          }
        }
      } else {
        this.print(`Target path '${initialPath}' not found.`, 'color-error');
      }
    }

    if (initialCommand) {
      await new Promise(resolve => setTimeout(resolve, 400));
      await this.typeAndSubmit(initialCommand);
    }

    this.isBooting = false;
    this.input.disabled = false;
    this.inputLine.style.visibility = 'visible';
    this.updatePrompt();
    this.focus();
    this.updateBrowserUrl(this.formatDisplayPath(), initialCommand);
  }
}
