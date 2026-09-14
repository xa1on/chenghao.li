import { audio } from '../audio.js';
import { parseMarkdown, escapeHTML } from '../utils/markdown.js';
import {
  HOSTNAME,
  DEFAULT_USERNAME,
  HOME_PATH,
  LOCAL_BOOT_PROMPT,
  PROMPT_SYMBOL,
  MAX_TERMINAL_OUTPUT_LINES,
  TYPEWRITER_DEFAULT_DELAY
} from '../config.js';
import {
  findCommentIndex,
  parseArgs,
  expandVariables,
  splitCommandChainsWithOps
} from './parser.js';
import { LineEditor } from './line_editor.js';

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
    this.placeholder = document.getElementById('input-placeholder');

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
    this.isMounted = false;

    this.fileSystem = options.fileSystem || null;
    this.commands = options.commands || {};
    this.onConnect = options.onConnect || null;
    this.typewriterDelay = options.typewriterDelay !== undefined ? options.typewriterDelay : (options.typeSpeed !== undefined ? options.typeSpeed : TYPEWRITER_DEFAULT_DELAY);
    this.maxOutputLines = options.maxOutputLines || Math.max(MAX_TERMINAL_OUTPUT_LINES || 150, 1000);

    // Command execution status & environment variables
    this.lastExitCode = 0;
    this.env = {
      USER: this.currentUsername,
      HOSTNAME: this.hostname,
      HOME: '~',
      PWD: '~',
      '?': 0
    };

    // Input Delegate Stack for Raw Mode vs Cooked Mode
    this.inputHandlers = [];

    // LineEditor instance
    this.lineEditor = new LineEditor({
      shell: this,
      input: this.input,
      inputDisplay: this.inputDisplay,
      promptPrefix: this.promptPrefix,
      placeholder: this.placeholder,
      onSubmit: async (val) => {
        await this.handleInputSubmit(val);
      },
      onTab: () => {
        this.handleTabAutocomplete();
      }
    });
  }

  getEnv() {
    this.env.USER = this.currentUsername;
    this.env.HOSTNAME = this.hostname;
    this.env.PWD = this.formatDisplayPath();
    this.env['?'] = this.lastExitCode;
    return this.env;
  }

  // Input Delegate Stack
  pushInputHandler(handler) {
    this.inputHandlers.push(handler);
  }

  popInputHandler() {
    return this.inputHandlers.pop();
  }

  getActiveInputHandler() {
    return this.inputHandlers.length > 0 ? this.inputHandlers[this.inputHandlers.length - 1] : null;
  }

  setInputValue(newVal, newCursorPos = null) {
    this.lineEditor.setInputValue(newVal, newCursorPos);
  }

  updateInputDisplay(text) {
    this.lineEditor.updateDisplay(text);
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

    // Sync glow backdrop: 100% visual fidelity preserved, throttled to 500ms during games/raw mode
    this.setupGlowBackdrop();

    // Input visual mirroring and cursor synchronization throttled to requestAnimationFrame
    let rafId = null;
    const syncCursor = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        if (this.input) {
          this.lineEditor.updateDisplay(this.input.value);
        }
        rafId = null;
      });
    };

    if (this.input) {
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
    }

    if (this.inputLine) {
      this.inputLine.addEventListener('click', (e) => {
        const isInteractive = e.target.closest('a') || e.target.closest('button') || e.target.closest('.cmd-link');
        if (!isInteractive) {
          e.stopPropagation();
          if (this.input) {
            this.input.selectionStart = this.input.selectionEnd = this.input.value.length;
            syncCursor();
            this.focus();
          }
        }
      });
    }

    // Interactive Keydown Dispatcher
    if (this.input) {
      this.input.addEventListener('keydown', async (e) => {
        const activeHandler = this.getActiveInputHandler();
        if (activeHandler) {
          activeHandler(e);
          return;
        }
        await this.lineEditor.handleKeydown(e);
      });
    }

    // Global Keydown (Ctrl+C and interrupt controls)
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key.toLowerCase() === 'c') {
        const selected = window.getSelection().toString();
        // If text is selected, let standard or terminal copy handle it
        if (selected && selected !== '') {
          return;
        }

        e.preventDefault();
        this.abortSignal = true;

        if (this.lineEditor.searchMode) {
          this.lineEditor.exitSearchMode(true);
          return;
        }

        if (this.activeInputAbortResolver) {
          const abort = this.activeInputAbortResolver;
          this.activeInputAbortResolver = null;
          this.activeInputResolver = null;
          abort();
          return;
        }

        if (this.loginState === 'LOGGED_IN' && !this.isBooting && this.input && !this.input.disabled) {
          const currentVal = this.input.value;
          this.print(`${this.getPromptHtml()} ${this.escapeHTML(currentVal)}^C`);
          this.setInputValue('', 0);
          this.updatePrompt();
          this.focus();
        }
      }
    });

    // Modern Terminal Mouse & Context Menu Handlers
    // Middle-click pastes clipboard text
    document.addEventListener('auxclick', async (e) => {
      if (e.button === 1) {
        if (this.loginState !== 'LOGGED_IN' || this.isBooting || this.isExecutingCommand) return;
        e.preventDefault();
        try {
          const text = await navigator.clipboard.readText();
          if (text && this.input) {
            const pos = this.input.selectionStart || 0;
            const val = this.input.value;
            this.setInputValue(val.slice(0, pos) + text + val.slice(pos), pos + text.length);
            this.focus();
          }
        } catch (_) {}
      }
    });

    // Right-click: allow native context menu if Shift is pressed or clicked outside terminal-body
    document.addEventListener('contextmenu', async (e) => {
      if (e.shiftKey) return; // Allow native menu on Shift+RightClick
      const inTerminal = e.target.closest('#terminal-body');
      if (!inTerminal) return;

      const selected = window.getSelection().toString();
      if (!selected) {
        if (this.loginState !== 'LOGGED_IN' || this.isBooting || this.isExecutingCommand) return;
        e.preventDefault();
        try {
          const text = await navigator.clipboard.readText();
          if (text && this.input) {
            const pos = this.input.selectionStart || 0;
            const val = this.input.value;
            this.setInputValue(val.slice(0, pos) + text + val.slice(pos), pos + text.length);
            this.focus();
          }
        } catch (_) {}
      }
    });

    // Focus redirection and interactive link clicks
    document.addEventListener('click', async (e) => {
      const target = e.target;
      const isInteractive = target.closest('a, button, input, .cmd-link, .ls-item, .contact-link');

      if (isInteractive) {
        audio.playLinkClick();
      }

      if (this.loginState !== 'GAME' && !this.getActiveInputHandler() && !this.isBooting) {
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

  setupGlowBackdrop() {
    const backdropsExist = this.glowBackdrops[0] && this.glowBackdrops[1];
    if (!backdropsExist || !this.output) return;

    let throttleTimeout = null;
    let lastClonedChildCount = 0;

    const performGlowSync = () => {
      if (!this.output || document.hidden) return;

      const currentActive = this.glowBackdrops[this.activeGlowIdx];
      const nextActiveIdx = (this.activeGlowIdx + 1) % 2;
      const nextActive = this.glowBackdrops[nextActiveIdx];

      if (currentActive && nextActive) {
        const childCount = this.output.children.length;
        const maxGlowLines = 85;
        const startIndex = Math.max(0, childCount - maxGlowLines);

        // Populate inactive layer
        nextActive.innerHTML = '';
        const fragment = document.createDocumentFragment();
        for (let i = startIndex; i < childCount; i++) {
          fragment.appendChild(this.output.children[i].cloneNode(true));
        }
        nextActive.appendChild(fragment);

        // Cross-fade
        nextActive.classList.add('active');
        currentActive.classList.remove('active');

        this.activeGlowIdx = nextActiveIdx;
        lastClonedChildCount = childCount;
      }
    };

    const observer = new MutationObserver(() => {
      if (document.hidden) return;
      if (!throttleTimeout) {
        // Use 500ms throttling if an active game/raw handler is running, 150ms otherwise
        const delay = (this.loginState === 'GAME' || this.getActiveInputHandler()) ? 500 : 150;
        throttleTimeout = setTimeout(() => {
          performGlowSync();
          throttleTimeout = null;
        }, delay);
      }
    });

    observer.observe(this.output, {
      childList: true,
      subtree: true,
      characterData: true
    });

    // Page Visibility listener: resume glow on foreground
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        performGlowSync();
      }
    });

    // Initial sync
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

  print(htmlContent, className = 'color-text') {
    const line = document.createElement('div');
    line.className = className;
    line.innerHTML = htmlContent;
    this.output.appendChild(line);

    while (this.output.children.length > this.maxOutputLines) {
      this.output.removeChild(this.output.firstChild);
    }

    this.body.scrollTop = this.body.scrollHeight;
    return line;
  }

  printError(msg) {
    this.lastExitCode = 1;
    return this.print(msg, 'color-error');
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
        this.print(`${promptText}${escapeHTML(val)}`);
        cleanup();
        resolve(val);
      };

      this.activeInputAbortResolver = () => {
        this.print(`${promptText}${escapeHTML(this.input.value)}^C`);
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
    this.lineEditor.historyDraft = '';
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
      this.lastExitCode = 1;
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

    // 2. Command Chaining with true operator evaluation (&&, ||, ;)
    const chains = splitCommandChainsWithOps(trimmed);
    let shouldRun = true;

    for (let i = 0; i < chains.length; i++) {
      if (this.abortSignal) break;
      const { cmd, op } = chains[i];

      if (shouldRun) {
        const exitCode = await this.executeSingleCommand(cmd);
        this.lastExitCode = (typeof exitCode === 'number') ? exitCode : 0;
        this.env['?'] = this.lastExitCode;

        if (op === '&&') {
          shouldRun = (this.lastExitCode === 0);
        } else if (op === '||') {
          shouldRun = (this.lastExitCode !== 0);
        } else {
          shouldRun = true; // ';' or null
        }
      } else {
        // Skipped because conditional check failed; reset on unconditional ';'
        if (op === ';') {
          shouldRun = true;
        }
      }
    }
  }

  async executeSingleCommand(cmdStr) {
    const trimmed = cmdStr.trim();
    if (trimmed === '') return 0;

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

    if (commandPart === '') return 0;

    // 3. Variable expansion ($USER, $HOME, $PWD, $?)
    const expandedCommand = expandVariables(commandPart, this.getEnv());
    const parts = parseArgs(expandedCommand);
    if (parts.length === 0) return 0;

    const command = parts[0].toLowerCase();
    const args = parts.slice(1);

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
            return 1;
          }
        }

        // Intercept -h or --help
        if (args.length === 1 && (args[0] === '-h' || args[0] === '--help')) {
          await this.commands.help.run([command], this);
          return 0;
        }

        // Validate required arguments
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
            return 1;
          }
        }

        const runResult = await cmd.run(args, this);
        return typeof runResult === 'number' ? runResult : 0;
      }

      this.print(`command not found: ${command}. Type 'help' to see list of commands.`, 'color-error');
      return 127;
    } catch (err) {
      this.print(`Error: ${err.message}`, 'color-error');
      return 1;
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
      // Linux bash parity: Only suggest '..' if the user explicitly typed '.' or '..'
      if (prefix.startsWith('.')) {
        if (targetPath.length > 0) {
          dirKeys.push('..');
        }
        dirKeys.push('.');
      }

      const prefixLower = prefix.toLowerCase();
      const matches = dirKeys.filter(key => key.toLowerCase().startsWith(prefixLower));

      if (matches.length === 1) {
        const matchedName = matches[0];
        const itemNode = targetDir[matchedName];
        const isLink = itemNode !== null && typeof itemNode === 'object' && typeof itemNode.symlink === 'string';
        let isDirNode = matchedName === '..' || matchedName === '.' || typeof targetDir[matchedName] === 'object';
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
            const isDirNode = matchedName === '..' || matchedName === '.' || typeof targetDir[matchedName] === 'object';
            return isDirNode ? `<span class="color-dir">${matchedName}/</span>` : `<span class="color-file">${matchedName}</span>`;
          });
          this.print(formattedMatches.join('    '));
        }
      }
    }
  }

  skippableDelay(ms) {
    if (ms <= 0) return Promise.resolve(false);
    return new Promise((resolve) => {
      let timeoutId = null;
      let done = false;

      const finish = (skipped) => {
        if (done) return;
        done = true;
        if (timeoutId) clearTimeout(timeoutId);
        cleanup();
        resolve(skipped);
      };

      const handleSkip = () => {
        finish(true);
      };

      const cleanup = () => {
        window.removeEventListener('keydown', handleSkip, true);
        window.removeEventListener('click', handleSkip, true);
        window.removeEventListener('touchstart', handleSkip, true);
      };

      window.addEventListener('keydown', handleSkip, true);
      window.addEventListener('click', handleSkip, true);
      window.addEventListener('touchstart', handleSkip, true);

      timeoutId = setTimeout(() => {
        finish(false);
      }, ms);
    });
  }

  typeCommand(text, speed = this.typewriterDelay) {
    const fullCleanText = text.replace(/<(?:d|delay):(\d+)>/gi, '');

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

    return new Promise((resolve) => {
      let skipped = false;
      let timeoutId = null;

      const finishImmediately = () => {
        if (skipped) return;
        skipped = true;
        this.lastTypeCommandSkipped = true;
        if (timeoutId) clearTimeout(timeoutId);
        cleanup();
        this.updateInputDisplay(fullCleanText);
        resolve(fullCleanText);
      };

      const handleSkip = () => {
        finishImmediately();
      };

      const cleanup = () => {
        window.removeEventListener('keydown', handleSkip, true);
        window.removeEventListener('click', handleSkip, true);
        window.removeEventListener('touchstart', handleSkip, true);
      };

      window.addEventListener('keydown', handleSkip, true);
      window.addEventListener('click', handleSkip, true);
      window.addEventListener('touchstart', handleSkip, true);

      let tokenIdx = 0;
      let charIdx = 0;
      let globalCharIndex = 0;
      let displayedText = '';

      const step = () => {
        if (skipped) return;

        if (tokenIdx >= tokens.length) {
          this.lastTypeCommandSkipped = false;
          cleanup();
          resolve(displayedText);
          return;
        }

        const token = tokens[tokenIdx];
        if (token.type === 'delay') {
          tokenIdx++;
          charIdx = 0;
          if (token.ms > 0) {
            timeoutId = setTimeout(step, token.ms);
          } else {
            step();
          }
        } else if (token.type === 'text') {
          if (charIdx < token.value.length) {
            const char = token.value[charIdx++];
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
            globalCharIndex++;

            if (delay > 0) {
              timeoutId = setTimeout(step, delay);
            } else {
              step();
            }
          } else {
            tokenIdx++;
            charIdx = 0;
            step();
          }
        }
      };

      step();
    });
  }

  async typeAndSubmit(text, speed = this.typewriterDelay, enter_delay = this.typewriterDelay) {
    const cleanCmd = await this.typeCommand(text, speed);
    if (!this.lastTypeCommandSkipped && enter_delay > 0) {
      await this.skippableDelay(enter_delay);
    }
    await this.handleInputSubmit(cleanCmd);
    return cleanCmd;
  }

  getInitialDeepLink() {
    let rawPath = '';

    try {
      const redirect = sessionStorage.getItem('spa_redirect');
      if (redirect) {
        sessionStorage.removeItem('spa_redirect');
        rawPath = redirect;
      }
    } catch (e) { }

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
        if ((trimmedCmd.startsWith('"') && trimmedCmd.endsWith('"')) ||
          (trimmedCmd.startsWith("'") && trimmedCmd.endsWith("'"))) {
          trimmedCmd = trimmedCmd.slice(1, -1);
        }
        trimmedCmd = trimmedCmd.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
        initialCommand = trimmedCmd;
      }
    }

    const resolvedInitialPath = isHome ? (cleanPath ? '~/' + cleanPath : '~') : (cleanPath ? '/' + cleanPath : '');
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
        if (trimmedCmd && trimmedCmd.toLowerCase() !== 'ls') {
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

    await this.skippableDelay(200);
    this.print(`<span class="color-accent">${this.localPrompt}</span> ${sshCmd}`);
    this.promptPrefix.innerHTML = '';
    this.updateInputDisplay('');

    await this.skippableDelay(1000);

    if (this.onConnect) {
      await this.onConnect(this);
    }

    this.promptPrefix.innerHTML = this.getPromptHtml();
    this.loginState = 'LOGGED_IN';
    audio.fadeHumQuiet();

    await this.skippableDelay(600);

    // Preset initial ls
    await this.typeAndSubmit('ls<d:200> # click items to navigate<d:75>, or use cat/cd', null, 400);

    if (initialPath && initialPath !== '~' && this.fileSystem) {
      const resolved = this.fileSystem.resolvePath(this.currentPath, initialPath);
      if (resolved !== null) {
        const targetObj = this.fileSystem.getNodeByPath(resolved);
        const isDir = typeof targetObj === 'object';

        await this.skippableDelay(400);

        if (isDir) {
          await this.typeAndSubmit(`cd ${initialPath}`);
          if (!initialCommand) {
            await this.skippableDelay(300);
            await this.typeAndSubmit('ls');
          }
        } else {
          const slashIdx = initialPath.lastIndexOf('/');
          if (slashIdx !== -1) {
            const parentDir = initialPath.slice(0, slashIdx);
            const fileName = initialPath.slice(slashIdx + 1);
            await this.typeAndSubmit(`cd ${parentDir}`);
            await this.skippableDelay(300);
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
      await this.skippableDelay(400);
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
