import { audio } from './audio.js';
import { parseMarkdown, escapeHTML } from './utils/markdown.js';

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

    this.loginState = 'BOOTING';
    this.currentUsername = 'guest';
    this.currentPath = [];
    this.commandHistory = [];
    this.historyIndex = -1;
    this.activeInputResolver = null;
    this.activeInputAbortResolver = null;
    this.abortSignal = false;
    this.isExecutingCommand = false;

    this.fileSystem = options.fileSystem || null;
    this.commands = options.commands || {};
    this.onConnect = options.onConnect || null;
    this.typewriterDelay = options.typewriterDelay !== undefined ? options.typewriterDelay : (options.typeSpeed !== undefined ? options.typeSpeed : 50);
    this.placeholder = document.getElementById('input-placeholder');
  }

  mount() {
    // Expose compatibility namespace for scripts if needed, but decoupled internally

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
      const charCell = e.target.closest('.char-cell');
      if (charCell) {
        e.stopPropagation();
        const idx = parseInt(charCell.getAttribute('data-idx'), 10);
        this.input.selectionStart = this.input.selectionEnd = idx;
        syncCursor();
        this.focus();
      } else {
        const isInteractive = e.target.closest('a') || e.target.closest('button') || e.target.closest('.cmd-link');
        if (!isInteractive) {
          e.stopPropagation();
          this.input.selectionStart = this.input.selectionEnd = this.input.value.length;
          syncCursor();
          this.focus();
        }
      }
    });

    // Special keyboard listeners (Enter, Up, Down, Tab)
    this.input.addEventListener('keydown', async (e) => {
      if (this.loginState === 'GAME' || this.loginState === 'BOOTING') {
        return;
      }

      const ignoredKeys = ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Escape'];
      if (!ignoredKeys.includes(e.key)) {
        audio.playKeyclick(e.key);
      }

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
        }
        return;
      }

      if (e.key === 'Enter') {
        const val = this.input.value;
        this.input.value = '';
        this.inputDisplay.textContent = '';
        await this.handleInputSubmit(val);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (this.loginState !== 'LOGGED_IN') return;
        if (this.commandHistory.length > 0 && this.historyIndex > 0) {
          this.historyIndex--;
          this.input.value = this.commandHistory[this.historyIndex];
          this.updateInputDisplay(this.commandHistory[this.historyIndex]);
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (this.loginState !== 'LOGGED_IN') return;
        if (this.historyIndex < this.commandHistory.length - 1) {
          this.historyIndex++;
          this.input.value = this.commandHistory[this.historyIndex];
          this.updateInputDisplay(this.commandHistory[this.historyIndex]);
        } else if (this.historyIndex === this.commandHistory.length - 1) {
          this.historyIndex = this.commandHistory.length;
          this.input.value = '';
          this.inputDisplay.textContent = '';
        }
      } else if (e.key === 'Tab') {
        e.preventDefault();
        if (this.loginState !== 'LOGGED_IN') return;
        this.handleTabAutocomplete();
      }
    });

    // Capture Ctrl+C interrupts (only if no text is selected)
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key.toLowerCase() === 'c') {
        if (window.getSelection().toString() === '') {
          e.preventDefault();
          this.abortSignal = true;

          // If we're inside a readInput() call, abort it cleanly
          if (this.activeInputAbortResolver) {
            const abort = this.activeInputAbortResolver;
            this.activeInputAbortResolver = null;
            this.activeInputResolver = null;
            abort();
            return;
          }

          // Normal shell Ctrl+C behavior (only when NOT in a readInput sub-prompt)
          if (this.loginState === 'LOGGED_IN' && !this.input.disabled) {
            const currentVal = this.input.value;
            this.print(`<span class="color-accent"><span class="red">${this.currentUsername}</span>@chenghao.li</span>:<span class="color-dir">${this.currentPath.length === 0 ? '~' : '/' + this.currentPath.join('/')}</span># ${this.escapeHTML(currentVal)}^C`);
            this.input.value = '';
            this.inputDisplay.textContent = '';
            this.updatePrompt();
            this.focus();
          }
        }
      }
    });

    // Global click delegation handler
    document.addEventListener('click', async (e) => {
      const target = e.target;
      if (!target) return;

      const isInteractive = target.tagName === 'A' ||
        target.classList.contains('ls-item') ||
        target.classList.contains('cmd-link') ||
        target.tagName === 'BUTTON';

      if (isInteractive) {
        audio.playLinkClick();
      }

      // Handle focus redirection
      if (this.loginState !== 'GAME') {
        const selectedText = window.getSelection().toString();
        if (!selectedText) {
          this.focus();
        }
      }

      // Handle interactive item clicks (ls-item and cmd-link)
      if (this.loginState === 'LOGGED_IN' && !this.isExecutingCommand) {
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

    const MAX_LINES = 150;
    while (this.output.children.length > MAX_LINES) {
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
    const wrapCharacters = (str, startIdx) => {
      return str.split('').map((char, i) => {
        const displayChar = char === '\n' ? '\n' : (char === ' ' ? '\u00A0' : char);
        return `<span class="char-cell" data-idx="${startIdx + i}">${escapeHTML(displayChar)}</span>`;
      }).join('');
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
      this.inputDisplay.innerHTML = wrapCharacters(left, 0) + getCursorHTML(charUnder) + wrapCharacters(right, selStart + 1);
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
          this.inputDisplay.innerHTML = wrapCharacters(left, 0) + getCursorHTML(charUnder) + wrapCharacters(right, selStart + 1) + `<span class="color-dim">${wrapCharacters(commentPart, commentIdx)}</span>`;
        } else {
          const localSel = selStart - commentIdx;
          const left = commentPart.slice(0, localSel);
          const charUnder = commentPart.slice(localSel, localSel + 1);
          const right = commentPart.slice(localSel + 1);
          this.inputDisplay.innerHTML = wrapCharacters(commandPart, 0) + `<span class="color-dim">${wrapCharacters(left, commentIdx)}${getCursorHTML(charUnder)}${wrapCharacters(right, selStart + 1)}</span>`;
        }
      } else {
        const left = text.slice(0, selStart);
        const charUnder = text.slice(selStart, selStart + 1);
        const right = text.slice(selStart + 1);
        this.inputDisplay.innerHTML = wrapCharacters(left, 0) + getCursorHTML(charUnder) + wrapCharacters(right, selStart + 1);
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
      const displayPath = this.currentPath.length === 0 ? '~' : '/' + this.currentPath.join('/');
      this.promptPrefix.innerHTML = `<span class="color-accent"><span class="red">${this.currentUsername}</span>@chenghao.li</span>:<span class="color-dir">${displayPath}</span>#`;
      this.input.value = '';
      this.updateInputDisplay('');
    } else if (this.loginState === 'BOOTING') {
      this.inputDisplay.textContent = '';
      this.input.value = '';
    }
  }

  async handleInputSubmit(val) {
    if (this.loginState !== 'LOGGED_IN' || this.isExecutingCommand) return;

    this.isExecutingCommand = true;
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
      this.input.disabled = false;
      this.inputLine.style.visibility = 'visible';
      this.abortSignal = false;
      this.updatePrompt();
      this.focus();
    }
  }

  async executeCommand(cmdStr) {
    const trimmed = cmdStr.trim();
    if (trimmed === '') return;

    const displayPath = this.currentPath.length === 0 ? '~' : '/' + this.currentPath.join('/');

    const commentIdx = findCommentIndex(trimmed);
    let commandPart = trimmed;
    let printedLine = escapeHTML(trimmed);
    if (commentIdx !== -1) {
      const commandPartStr = trimmed.slice(0, commentIdx);
      const commentPartStrFull = trimmed.slice(commentIdx);
      printedLine = escapeHTML(commandPartStr) + `<span class="color-dim">${escapeHTML(commentPartStrFull)}</span>`;
      commandPart = commandPartStr.trim();
    }

    this.print(`<span class="color-accent"><span class="red">${this.currentUsername}</span>@chenghao.li</span>:<span class="color-dir">${displayPath}</span># ${printedLine}`);

    if (commandPart === '') return;

    const parts = parseArgs(commandPart);
    if (parts.length === 0) return;
    const command = parts[0].toLowerCase();
    const args = parts.slice(1);

    this.abortSignal = false;

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
      if (args.includes('-h') || args.includes('--help')) {
        await this.commands.help.run([command], this);
        return;
      }

      // Automatically validate required arguments
      if (cmd.args && cmd.args.length > 0) {
        const requiredArgs = cmd.args.filter(a => a.required);
        if (args.length < requiredArgs.length) {
          const missingArg = requiredArgs[args.length];
          let usage = cmd.name;
          const argUsageStrings = cmd.args.map(a => a.required ? `<${a.name}>` : `[${a.name}]`);
          if (argUsageStrings.length > 0) {
            usage += ' ' + argUsageStrings.join(' ');
          }
          this.print(`${command}: missing required argument &lt;${missingArg.name}&gt;. Usage: <span class="color-green">${usage}</span>`, 'color-error');
          return;
        }
      }

      await cmd.run(args, this);
      return;
    }

    this.print(`command not found: ${command}. Type 'help' to see list of commands.`, 'color-error');
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
        this.input.value = matches[0] + ' ';
        this.updateInputDisplay(this.input.value);
      } else if (matches.length > 1) {
        const lcp = getLongestCommonPrefix(matches);
        if (lcp.length > typedCmd.length) {
          this.input.value = lcp;
          this.updateInputDisplay(this.input.value);
        } else {
          this.print(matches.join('    '), 'color-accent');
          const displayPath = this.currentPath.length === 0 ? '~' : '/' + this.currentPath.join('/');
          this.print(`<span class="color-accent"><span class="red">${this.currentUsername}</span>@chenghao.li</span>:<span class="color-dir">${displayPath}</span># ${this.escapeHTML(currentVal)}`);
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
          this.input.value = parts.join(' ');
          this.updateInputDisplay(this.input.value);
        } else if (matches.length > 1) {
          const lcp = getLongestCommonPrefix(matches);
          if (lcp.length > typedArg.length) {
            parts[parts.length - 1] = lcp;
            this.input.value = parts.join(' ');
            this.updateInputDisplay(this.input.value);
          } else {
            this.print(matches.join('    '), 'color-accent');
            const displayPath = this.currentPath.length === 0 ? '~' : '/' + this.currentPath.join('/');
            this.print(`<span class="color-accent"><span class="red">${this.currentUsername}</span>@chenghao.li</span>:<span class="color-dir">${displayPath}</span># ${this.escapeHTML(currentVal)}`);
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
        const isDirNode = matchedName === '..' || typeof targetDir[matchedName] === 'object';
        const completedArg = (slashIdx !== -1 ? argVal.slice(0, slashIdx + 1) : '') + matchedName + (isDirNode ? '/' : ' ');

        parts[parts.length - 1] = completedArg;
        this.input.value = parts.join(' ');
        this.updateInputDisplay(this.input.value);
      } else if (matches.length > 1) {
        const lcp = getLongestCommonPrefix(matches);
        if (lcp.length > prefix.length) {
          const completedPrefix = (slashIdx !== -1 ? argVal.slice(0, slashIdx + 1) : '') + lcp;
          parts[parts.length - 1] = completedPrefix;
          this.input.value = parts.join(' ');
          this.updateInputDisplay(this.input.value);
        } else {
          const formattedMatches = matches.map(matchedName => {
            const isDirNode = matchedName === '..' || typeof targetDir[matchedName] === 'object';
            return isDirNode ? `<span class="color-dir">${matchedName}/</span>` : `<span class="color-file">${matchedName}</span>`;
          });
          this.print(formattedMatches.join('    '));

          const displayPath = this.currentPath.length === 0 ? '~' : '/' + this.currentPath.join('/');
          this.print(`<span class="color-accent"><span class="red">${this.currentUsername}</span>@chenghao.li</span>:<span class="color-dir">${displayPath}</span># ${this.escapeHTML(currentVal)}`);
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
  }

  async startConnection() {
    this.loginState = 'BOOTING';
    this.input.disabled = true;
    this.promptPrefix.innerHTML = '<span class="color-accent">C:\\Users\\cli&gt;</span>';
    this.inputDisplay.textContent = '';

    audio.startHum();

    const cmdText = 'ssh ' + this.currentUsername + '<d:100>@chenghao.li';
    await this.typeCommand(cmdText);

    await new Promise(resolve => setTimeout(resolve, 400));
    this.print('<span class="color-accent">C:\\Users\\cli&gt;</span> ssh ' + this.currentUsername + '@chenghao.li');
    this.inputDisplay.textContent = '';

    audio.playBootChime();
    if (this.onConnect) {
      await this.onConnect(this);
    }
    this.promptPrefix.innerHTML = `<span class="color-accent"><span class="red">${this.currentUsername}</span>@chenghao.li</span>:<span class="color-dir">~</span>#`;
    this.loginState = 'LOGGED_IN';
    audio.fadeHumQuiet();

    await new Promise(resolve => setTimeout(resolve, 600));

    const lsMainText = 'ls<d:200> # click items to navigate<d:100>, or use cat/cd<d:75> (check out info!)';
    await this.typeCommand(lsMainText);
    await this.handleInputSubmit('ls # click items to navigate, or use cat/cd (check out info!)');

    await new Promise(resolve => setTimeout(resolve, 400));

    const lsInfoText = '<d:100>ls<d:200> info';
    await this.typeCommand(lsInfoText);
    await this.handleInputSubmit('ls info');

    this.input.disabled = false;
  }
}
