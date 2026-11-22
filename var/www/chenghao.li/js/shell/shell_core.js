import { audio } from '../audio.js';
import { parseMarkdown, escapeHTML } from '../utils/markdown.js';
import {
  HOSTNAME,
  DEFAULT_USERNAME,
  HOME_PATH,
  LOCAL_BOOT_PROMPT,
  PROMPT_SYMBOL,
  MAX_TERMINAL_OUTPUT_LINES,
  TYPEWRITER_DEFAULT_DELAY,
  LINE_RENDER_DELAY,
  LINE_RENDER_DELAY_MIN,
  LINE_RENDER_DELAY_MAX,
  LINE_RENDER_ACCEL_EXPONENT,
  LINE_FADE_DURATION,
  LINE_BLUR_DURATION,
  LINE_FADE_BLUR,
  SCROLL_SMOOTH_FACTOR,
  SCROLL_SMOOTH_TAU,
  MARKDOWN_WRAP_LIMIT,
  TAB_DOUBLE_PRESS_INTERVAL
} from '../config.js';
import {
  findCommentIndex,
  parseArgs,
  expandVariables,
  splitCommandChainsWithOps,
  parseRedirection,
  parseCommandArgs
} from './parser.js';
import { runScript } from './script_runner.js';
import { LineEditor } from './line_editor.js';
import { getCompletions } from './completer.js';

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

export function splitHtmlLines(html) {
  if (typeof html !== 'string') return [String(html)];
  const rawLines = html.replace(/<br\s*\/?>/gi, '\n').split('\n');
  const tagStack = [];

  return rawLines.map(line => {
    const prefix = tagStack.map(t => t.full).join('');
    let processedLine = '';
    const tagRegex = /<\/?([a-zA-Z0-9]+)(?:\s+[^>]*)?>/g;
    let lastIdx = 0;
    let match;

    while ((match = tagRegex.exec(line)) !== null) {
      const fullTag = match[0];
      const tagName = match[1].toLowerCase();
      const textChunk = line.slice(lastIdx, match.index);
      lastIdx = tagRegex.lastIndex;

      if (VOID_TAGS.has(tagName) || fullTag.endsWith('/>')) {
        processedLine += textChunk + fullTag;
        continue;
      }

      if (fullTag.startsWith('</')) {
        let found = false;
        for (let i = tagStack.length - 1; i >= 0; i--) {
          if (tagStack[i].tag === tagName) {
            tagStack.splice(i, 1);
            found = true;
            break;
          }
        }
        if (found) {
          processedLine += textChunk + fullTag;
        } else {
          // Drop orphaned closing tag
          processedLine += textChunk;
        }
      } else {
        tagStack.push({ tag: tagName, full: fullTag });
        processedLine += textChunk + fullTag;
      }
    }

    processedLine += line.slice(lastIdx);
    const suffix = tagStack.slice().reverse().map(t => `</${t.tag}>`).join('');
    return prefix + processedLine + suffix;
  });
}

export class Shell {
  constructor(options = {}) {
    this.redirectCapture = null;
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
    this.lineRenderDelay = options.lineRenderDelay !== undefined ? options.lineRenderDelay : LINE_RENDER_DELAY;
    this.lineRenderDelayMin = options.lineRenderDelayMin !== undefined ? options.lineRenderDelayMin : (typeof LINE_RENDER_DELAY_MIN !== 'undefined' ? LINE_RENDER_DELAY_MIN : 6);
    this.lineRenderDelayMax = options.lineRenderDelayMax !== undefined ? options.lineRenderDelayMax : (typeof LINE_RENDER_DELAY_MAX !== 'undefined' ? LINE_RENDER_DELAY_MAX : 36);
    this.lineRenderAccelExponent = options.lineRenderAccelExponent !== undefined ? options.lineRenderAccelExponent : (typeof LINE_RENDER_ACCEL_EXPONENT !== 'undefined' ? LINE_RENDER_ACCEL_EXPONENT : 1.2);
    this.scrollSmoothFactor = options.scrollSmoothFactor !== undefined ? options.scrollSmoothFactor : (typeof SCROLL_SMOOTH_FACTOR !== 'undefined' ? SCROLL_SMOOTH_FACTOR : 0.12);
    this.scrollSmoothTau = options.scrollSmoothTau !== undefined ? options.scrollSmoothTau : (typeof SCROLL_SMOOTH_TAU !== 'undefined' ? SCROLL_SMOOTH_TAU : 0.08);
    this.lineFadeDuration = options.lineFadeDuration !== undefined ? options.lineFadeDuration : LINE_FADE_DURATION;
    this.lineBlurDuration = options.lineBlurDuration !== undefined ? options.lineBlurDuration : (typeof LINE_BLUR_DURATION !== 'undefined' ? LINE_BLUR_DURATION : 180);
    this.lineFadeBlur = options.lineFadeBlur !== undefined ? options.lineFadeBlur : (typeof LINE_FADE_BLUR !== 'undefined' ? LINE_FADE_BLUR : 30);
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.style.setProperty('--line-fade-duration', `${this.lineFadeDuration}ms`);
      document.documentElement.style.setProperty('--line-blur-duration', `${this.lineBlurDuration}ms`);
      const blurVal = typeof this.lineFadeBlur === 'number' ? `${this.lineFadeBlur}px` : this.lineFadeBlur;
      document.documentElement.style.setProperty('--line-fade-blur', blurVal);
    }
    this.printQueue = Promise.resolve();
    this.printGeneration = 0;
    this.activePrintCount = 0;
    this.queueTotalLines = 0;
    this.queueLineIndex = 0;
    this.skipLineAnimation = false;
    this._skipHandlerAttached = false;
    this._skipHandler = null;
    this._userScrolledUp = false;
    this.disableAutoScroll = false;
    this._autoScrollRaf = null;
    this._lastScrollTime = null;
    this._currentScrollTop = 0;
    this._wheelHandler = null;
    this._touchStartY = null;
    this._touchMoveHandler = null;
    this._touchStartHandler = null;

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
      onSubmit: async () => {
        return await this.submit();
      },
      onTab: () => {
        this.handleTabAutocomplete();
      }
    });

    this.lastTabTimestamp = 0;
    this.tabCount = 0;
    this.lastTabInput = '';
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

  setInput(newVal, newCursorPos = null) {
    this.lineEditor.setInput(newVal, newCursorPos);
  }

  getInputValue() {
    return this.lineEditor ? this.lineEditor.getValue() : (this.input ? this.input.value : '');
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

  setLineFadeBlur(blurPx) {
    this.lineFadeBlur = blurPx;
    if (typeof document !== 'undefined' && document.documentElement) {
      const blurVal = typeof this.lineFadeBlur === 'number' ? `${this.lineFadeBlur}px` : this.lineFadeBlur;
      document.documentElement.style.setProperty('--line-fade-blur', blurVal);
    }
  }

  setLineBlurDuration(durationMs) {
    this.lineBlurDuration = durationMs;
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.style.setProperty('--line-blur-duration', `${this.lineBlurDuration}ms`);
    }
  }

  scrollToBottomSmooth() {
    this._userScrolledUp = false;
    this.disableAutoScroll = false;
    this._startAutoScroll();
  }

  mount() {
    if (this.isMounted) return;
    this.isMounted = true;

    // Move #terminal-input out of .terminal-body to document.body so the browser never
    // performs native un-smoothed scroll-into-view jumps when typing
    if (this.input && typeof document !== 'undefined' && document.body && this.input.parentElement !== document.body) {
      document.body.appendChild(this.input);
    }

    // Track scroll position continuously
    if (this.body) {
      let isDraggingScrollbar = false;

      this.body.addEventListener('pointerdown', (e) => {
        if (e.clientX >= this.body.clientWidth) {
          isDraggingScrollbar = true;
        }
      }, { passive: true });

      if (typeof window !== 'undefined') {
        window.addEventListener('pointerup', () => {
          isDraggingScrollbar = false;
        }, { passive: true });
      }

      this.body.addEventListener('wheel', (e) => {
        if (e.deltaY < 0) {
          this._userScrolledUp = true;
        } else if (e.deltaY > 0) {
          const maxScroll = Math.max(0, this.body.scrollHeight - this.body.clientHeight);
          if ((maxScroll - this.body.scrollTop) <= 20) {
            this._userScrolledUp = false;
            this.disableAutoScroll = false;
          }
        }
      }, { passive: true });

      let touchStartY = null;
      this.body.addEventListener('touchstart', (e) => {
        if (e.touches && e.touches.length > 0) {
          touchStartY = e.touches[0].clientY;
        }
      }, { passive: true });

      this.body.addEventListener('touchmove', (e) => {
        if (touchStartY !== null && e.touches && e.touches.length > 0) {
          const delta = e.touches[0].clientY - touchStartY;
          if (delta > 8) {
            this._userScrolledUp = true;
          } else if (delta < -8) {
            const maxScroll = Math.max(0, this.body.scrollHeight - this.body.clientHeight);
            if ((maxScroll - this.body.scrollTop) <= 20) {
              this._userScrolledUp = false;
              this.disableAutoScroll = false;
            }
          }
        }
      }, { passive: true });

      this.body.addEventListener('scroll', () => {
        const current = this.body.scrollTop;
        this._currentScrollTop = current;
        const maxScroll = Math.max(0, this.body.scrollHeight - this.body.clientHeight);
        if ((maxScroll - current) <= 20) {
          this._userScrolledUp = false;
          this.disableAutoScroll = false;
        } else if (isDraggingScrollbar) {
          this._userScrolledUp = true;
        }
      }, { passive: true });
    }

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
      this.input.addEventListener('input', () => {
        syncCursor();
        this.scrollToBottomSmooth();
      });
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
            this.scrollToBottomSmooth();
          }
        }
      });
    }

    // Interactive Keydown Dispatcher
    if (this.input) {
      this.input.addEventListener('keydown', async (e) => {
        if (e.key !== 'Tab') {
          this.tabCount = 0;
        }
        if (!e.ctrlKey && !e.metaKey && !e.altKey) {
          if (e.key.length === 1 || ['Backspace', 'Delete', 'Enter'].includes(e.key)) {
            this.scrollToBottomSmooth();
          }
        }
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
          this.print(`${this.getPromptHtml()} ${this.escapeHTML(currentVal)}^C`, 'color-text', { instant: true, fade: false });
          this.setInput('', 0);
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
            this.setInput(val.slice(0, pos) + text + val.slice(pos), pos + text.length);
            this.focus();
          }
        } catch (_) { }
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
            this.setInput(val.slice(0, pos) + text + val.slice(pos), pos + text.length);
            this.focus();
          }
        } catch (_) { }
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
        const lsItem = target.closest('.ls-item');
        const cmdElem = target.closest('[data-cmd], .cmd-link');

        if (lsItem) {
          e.stopPropagation();
          const type = lsItem.getAttribute('data-type');
          const path = lsItem.getAttribute('data-path');

          if (path) {
            const targetPathArr = path.split('/').filter(s => s.length > 0);
            const relativePath = this.fileSystem.getRelativePath(this.currentPath, targetPathArr);

            this.scrollToBottomSmooth();
            if (type === 'dir') {
              await this.handleInputSubmit(`cd ${relativePath}`);
              await this.handleInputSubmit('ls');
            } else if (type === 'file') {
              if (relativePath.endsWith('.sh')) {
                const execCmd = relativePath.includes('/') ? relativePath : `./${relativePath}`;
                await this.handleInputSubmit(execCmd);
              } else {
                await this.handleInputSubmit(`cat ${relativePath}`);
              }
            } else if (type === 'broken') {
              this.print(`ls: cannot access '${relativePath}': No such file or directory`, 'color-error');
            }
          }
        } else if (cmdElem) {
          e.stopPropagation();
          const cmd = cmdElem.getAttribute('data-cmd');
          if (cmd) {
            this.scrollToBottomSmooth();
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

  htmlToPlainText(htmlStr) {
    if (typeof htmlStr !== 'string') return '';
    return htmlStr
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<[^>]*>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'");
  }

  _startAutoScroll() {
    if (this.disableAutoScroll || typeof requestAnimationFrame === 'undefined' || !this.body) return;

    this._currentScrollTop = this.body.scrollTop;
    if (this._autoScrollRaf) return;

    this._lastScrollTime = null;

    const easeScroll = (timestamp) => {
      if (this.disableAutoScroll || !this.body) {
        this._autoScrollRaf = null;
        this._lastScrollTime = null;
        return;
      }

      if (!this._userScrolledUp) {
        const target = Math.max(0, this.body.scrollHeight - this.body.clientHeight);
        const current = this._currentScrollTop !== undefined ? this._currentScrollTop : this.body.scrollTop;
        if (target > current) {
          const diff = target - current;
          if (diff <= 0.5) {
            this._currentScrollTop = target;
            this.body.scrollTop = target;
          } else {
            const now = timestamp || (typeof performance !== 'undefined' ? performance.now() : Date.now());
            const dt = this._lastScrollTime ? Math.min((now - this._lastScrollTime) / 1000, 0.05) : 0.0166;
            this._lastScrollTime = now;

            const baseTau = this.scrollSmoothTau || 0.08;
            const tRatio = Math.min(1, Math.max(0, (diff - 20) / 100));
            const tau = Math.max(0.04, baseTau - tRatio * 0.035);
            const blend = 1 - Math.exp(-dt / tau);

            const step = Math.min(diff, Math.max(0.5, diff * blend));
            this._currentScrollTop = Math.min(target, current + step);
            this.body.scrollTop = this._currentScrollTop;
          }
        } else if (current > target) {
          this._currentScrollTop = target;
        }
      }

      const target = Math.max(0, this.body.scrollHeight - this.body.clientHeight);
      const remaining = target - (this._currentScrollTop !== undefined ? this._currentScrollTop : this.body.scrollTop);

      if ((this.activePrintCount > 0 || remaining > 0.5) && !this._userScrolledUp && !this.disableAutoScroll) {
        this._autoScrollRaf = requestAnimationFrame(easeScroll);
      } else {
        if (remaining <= 0.5 && !this._userScrolledUp && !this.disableAutoScroll) {
          this._currentScrollTop = target;
          this.body.scrollTop = target;
        }
        this._autoScrollRaf = null;
        this._lastScrollTime = null;
      }
    };

    this._autoScrollRaf = requestAnimationFrame(easeScroll);
  }

  _stopAutoScroll() {
    if (this._autoScrollRaf) {
      if (typeof cancelAnimationFrame !== 'undefined') {
        cancelAnimationFrame(this._autoScrollRaf);
      }
      this._autoScrollRaf = null;
      this._lastScrollTime = null;
    }
  }

  _ensureSkipListeners() {
    if (this._skipHandlerAttached) return;
    this._skipHandlerAttached = true;
    this.skipLineAnimation = false;

    this._skipHandler = (e) => {
      if (e.type === 'keydown' && (e.ctrlKey || e.metaKey || e.altKey)) return;
      this.skipLineAnimation = true;
      this.completeActiveAnimations();
      this._userScrolledUp = false;
      if (this.body) {
        this._isAutoScrolling = true;
        this.body.scrollTop = this.body.scrollHeight;
        this._currentScrollTop = this.body.scrollTop;
        this._isAutoScrolling = false;
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this._skipHandler, true);
      window.addEventListener('mousedown', this._skipHandler, true);
    }
    this._startAutoScroll();
  }

  _cleanupSkipListeners() {
    if (!this._skipHandlerAttached) return;
    this._skipHandlerAttached = false;
    if (this._skipHandler && typeof window !== 'undefined') {
      window.removeEventListener('keydown', this._skipHandler, true);
      window.removeEventListener('mousedown', this._skipHandler, true);
      this._skipHandler = null;
    }
    this.skipLineAnimation = false;
  }

  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  _trimOutput() {
    while (this.output.children.length > this.maxOutputLines) {
      this.output.removeChild(this.output.firstChild);
    }
  }

  _smoothScrollToBottom() {
    if (this.skipLineAnimation) {
      if (this.body) this.body.scrollTop = this.body.scrollHeight;
    } else {
      this._userScrolledUp = false;
      this._startAutoScroll();
    }
  }

  _printInstant(htmlContent, className) {
    const line = document.createElement('div');
    line.className = className;
    line.innerHTML = htmlContent;
    this.output.appendChild(line);
    this._trimOutput();
    if (this.queueLineIndex !== undefined) {
      this.queueLineIndex += this.countPrintLines(htmlContent);
    }
    if (this.body && !this.disableAutoScroll && !this._userScrolledUp) {
      this._startAutoScroll();
    }
    return line;
  }

  countPrintLines(htmlContent) {
    if (!htmlContent) return 1;
    if (typeof HTMLElement !== 'undefined' && htmlContent instanceof HTMLElement) {
      return 1;
    }
    if (typeof htmlContent === 'string' && htmlContent.includes('<div')) {
      if (typeof document !== 'undefined') {
        const tempWrapper = document.createElement('div');
        tempWrapper.innerHTML = htmlContent;
        if (tempWrapper.children.length === 1 && tempWrapper.firstElementChild.children.length > 1) {
          return tempWrapper.firstElementChild.children.length;
        }
      }
    }
    return splitHtmlLines(String(htmlContent)).length;
  }

  getLineDelay(index = 0, total = 1) {
    const minDelay = this.lineRenderDelayMin;
    const maxDelay = this.lineRenderDelayMax;
    if (total <= 1) {
      return maxDelay;
    }
    if (minDelay >= maxDelay) {
      return minDelay;
    }

    // Normalized progress across the queue: 0.0 at top, 1.0 at bottom
    const t = Math.max(0, Math.min(1, index / (total - 1)));

    // Bell curve: sin(pi * t) goes from 0 at t=0, to 1 at t=0.5, to 0 at t=1
    const speedFactor = Math.pow(Math.sin(Math.PI * t), this.lineRenderAccelExponent || 1.2);

    // Endpoints (speedFactor 0) -> maxDelay (slow)
    // Midpoint (speedFactor 1) -> minDelay (fast)
    const delay = maxDelay - (maxDelay - minDelay) * speedFactor;
    return Math.round(delay);
  }

  print(htmlContent, className = 'color-text', options = {}) {
    if (this.redirectCapture !== null && className !== 'color-error') {
      this.redirectCapture.push(this.htmlToPlainText(htmlContent));
      return null;
    }

    if ((options.instant || this.skipLineAnimation) && this.activePrintCount === 0) {
      return this._printInstant(htmlContent, className);
    }

    const linesInThisPrint = this.countPrintLines(htmlContent);
    this.queueTotalLines = (this.queueTotalLines || 0) + linesInThisPrint;

    this.activePrintCount++;
    this._ensureSkipListeners();
    const generation = this.printGeneration || 0;

    const queued = this.printQueue.then(async () => {
      if (generation !== (this.printGeneration || 0)) {
        return null;
      }
      try {
        return await this._renderPrint(htmlContent, className, options, generation);
      } finally {
        this.activePrintCount--;
        if (this.activePrintCount <= 0 || generation !== (this.printGeneration || 0)) {
          if (generation !== (this.printGeneration || 0)) {
            this.activePrintCount = 0;
          }
          if (this.activePrintCount <= 0) {
            this.activePrintCount = 0;
            this.queueTotalLines = 0;
            this.queueLineIndex = 0;
            this._cleanupSkipListeners();
          }
        }
      }
    });

    this.printQueue = queued.catch(() => { });
    return queued;
  }

  completeActiveAnimations() {
    if (this.output) {
      this.output.querySelectorAll('.terminal-line-fade-in').forEach(el => {
        el.classList.remove('terminal-line-fade-in');
      });
    }
    if (this.inputLine) {
      this.inputLine.classList.remove('terminal-line-fade-in');
    }
  }

  attachFadeIn(el) {
    if (!el) return;
    el.classList.add('terminal-line-fade-in');
    const cleanup = (e) => {
      if (e && e.animationName && e.animationName !== 'terminalLineUnblur') return;
      el.removeEventListener('animationend', cleanup);
      el.classList.remove('terminal-line-fade-in');
    };
    el.addEventListener('animationend', cleanup);
    const maxDuration = Math.max(this.lineFadeDuration || 120, this.lineBlurDuration || 180);
    setTimeout(() => {
      el.removeEventListener('animationend', cleanup);
      el.classList.remove('terminal-line-fade-in');
    }, maxDuration + 50);
  }

  enterFullScreenView() {
    this.completeActiveAnimations();
    if (this.output) {
      this.output.style.display = 'none';
    }
    if (this.inputLine) {
      this.inputLine.classList.add('hidden-input-line');
    }
    if (this.glowBackdrops) {
      this.glowBackdrops.forEach(el => {
        if (el) el.style.display = 'none';
      });
    }
    if (this.body) {
      this.body.style.overflowY = 'hidden';
    }
  }

  exitFullScreenView() {
    this.completeActiveAnimations();
    if (this.output) {
      this.output.style.display = 'flex';
    }
    if (this.inputLine) {
      this.inputLine.classList.remove('hidden-input-line');
    }
    if (this.glowBackdrops) {
      this.glowBackdrops.forEach(el => {
        if (el) el.style.display = '';
      });
    }
    if (this.body) {
      this.body.style.overflowY = '';
    }
  }

  async _renderPrint(htmlContent, className = 'color-text', options = {}, generation = null) {
    if (generation !== null && generation !== (this.printGeneration || 0)) {
      return null;
    }

    if (htmlContent === undefined || htmlContent === null) {
      htmlContent = '';
    }

    if (typeof HTMLElement !== 'undefined' && htmlContent instanceof HTMLElement) {
      if (options.fade !== false && !options.instant) {
        this.attachFadeIn(htmlContent);
      }
      this.output.appendChild(htmlContent);
      this._trimOutput();
      if (this.queueLineIndex !== undefined) this.queueLineIndex++;
      return htmlContent;
    }

    if (options.instant || this.skipLineAnimation) {
      return this._printInstant(htmlContent, className);
    }

    // Check if htmlContent is a structured container with pre-existing block children (like .buddy-box or .markdown-body)
    let isStructuredContainer = false;
    let tempWrapper = null;
    if (typeof htmlContent === 'string' && htmlContent.includes('<div')) {
      tempWrapper = document.createElement('div');
      tempWrapper.innerHTML = htmlContent;
      if (tempWrapper.children.length === 1 && tempWrapper.firstElementChild.children.length > 1) {
        isStructuredContainer = true;
      }
    }

    if (isStructuredContainer && tempWrapper) {
      const container = tempWrapper.firstElementChild;
      const children = Array.from(container.children);
      children.forEach(child => {
        child.style.display = 'none';
      });
      this.output.appendChild(container);
      this._trimOutput();

      const total = this.queueTotalLines || children.length;
      for (const child of children) {
        if (generation !== null && generation !== (this.printGeneration || 0)) return container;
        child.style.display = '';
        if (options.fade !== false && !options.instant) {
          this.attachFadeIn(child);
        }
        const idx = this.queueLineIndex !== undefined ? this.queueLineIndex++ : 0;
        const delay = this.getLineDelay(idx, total);
        if (!this.skipLineAnimation && delay > 0) {
          await this._delay(delay);
        }
      }
      return container;
    }

    const strContent = String(htmlContent);
    const lines = splitHtmlLines(strContent);

    if (lines.length <= 1) {
      const lineEl = document.createElement('div');
      if (className) lineEl.className = className;
      if (options.fade !== false && !options.instant) {
        this.attachFadeIn(lineEl);
      }
      lineEl.innerHTML = strContent || '&nbsp;';
      this.output.appendChild(lineEl);
      this._trimOutput();
      const idx = this.queueLineIndex !== undefined ? this.queueLineIndex++ : 0;
      const total = this.queueTotalLines || 1;
      const delay = this.getLineDelay(idx, total);
      if (!this.skipLineAnimation && delay > 0 && options.fade !== false && !options.instant) {
        await this._delay(delay);
      }
      return lineEl;
    }

    const container = document.createElement('div');
    container.className = className;
    this.output.appendChild(container);
    this._trimOutput();

    const total = this.queueTotalLines || lines.length;
    for (const line of lines) {
      if (generation !== null && generation !== (this.printGeneration || 0)) return container;
      const lineEl = document.createElement('div');
      if (options.fade !== false && !options.instant) {
        this.attachFadeIn(lineEl);
      }
      lineEl.innerHTML = line || '&nbsp;';
      container.appendChild(lineEl);

      const idx = this.queueLineIndex !== undefined ? this.queueLineIndex++ : 0;
      const delay = this.getLineDelay(idx, total);
      if (!this.skipLineAnimation && delay > 0) {
        await this._delay(delay);
      }
    }

    return container;
  }

  printError(msg) {
    this.lastExitCode = 1;
    return this.print(msg, 'color-error');
  }

  playTerminalBell() {
    audio?.playBell?.();
  }

  async readInput(promptText) {
    await this.printQueue;
    return new Promise((resolve) => {
      const originalPrefixHTML = this.promptPrefix.innerHTML;
      if (this.input) this.input.disabled = false;
      if (this.inputLine) {
        this.inputLine.style.display = '';
        this.inputLine.style.visibility = 'visible';
        this.inputLine.classList.remove('terminal-line-fade-in');
        void this.inputLine.offsetWidth;
        this.attachFadeIn(this.inputLine);
      }
      this.promptPrefix.innerHTML = promptText;
      if (this.input) this.input.value = '';

      const cleanup = () => {
        if (this.input) this.input.disabled = true;
        if (this.inputLine) {
          this.inputLine.style.display = 'none';
          this.inputLine.style.visibility = 'hidden';
          this.inputLine.classList.remove('terminal-line-fade-in');
        }
        this.promptPrefix.innerHTML = originalPrefixHTML;
        this.activeInputResolver = null;
        this.activeInputAbortResolver = null;
      };

      this.activeInputResolver = (val) => {
        this.print(`${promptText}${escapeHTML(val)}`, 'color-text', { instant: true, fade: false });
        cleanup();
        resolve(val);
      };

      this.activeInputAbortResolver = () => {
        this.print(`${promptText}${escapeHTML(this.input ? this.input.value : '')}^C`, 'color-text', { instant: true, fade: false });
        cleanup();
        resolve(null);
      };

      this.updateInputDisplay('');
      this.focus();
      this._startAutoScroll();
    });
  }

  showPromptLine() {
    if (this.loginState !== 'LOGGED_IN' || this.isBooting || this.getActiveInputHandler()) {
      return;
    }
    this.updatePrompt();
    if (this.inputLine) {
      this.inputLine.style.display = '';
      this.inputLine.style.visibility = 'visible';
      this.inputLine.classList.remove('terminal-line-fade-in');
      void this.inputLine.offsetWidth;
      this.attachFadeIn(this.inputLine);
    }
    if (this.input) {
      this.input.disabled = false;
    }
    this.focus({ preventScroll: true });
    if (!this.disableAutoScroll && !this._userScrolledUp) {
      this._startAutoScroll();
    }
  }

  hidePromptLine() {
    if (this.inputLine) {
      this.inputLine.style.display = 'none';
      this.inputLine.style.visibility = 'hidden';
      this.inputLine.classList.remove('terminal-line-fade-in');
    }
    if (this.input) {
      this.input.disabled = true;
    }
  }

  getTerminalColumns() {
    if (typeof window !== 'undefined' && this.body) {
      const clientWidth = this.body.clientWidth || window.innerWidth || 800;
      const availableWidth = Math.max(300, clientWidth - 60);
      const cols = Math.floor(availableWidth / 9.6);
      return Math.max(30, Math.min(cols, MARKDOWN_WRAP_LIMIT));
    }
    return MARKDOWN_WRAP_LIMIT;
  }

  parseMarkdown(text, basePathArr = [], wrapLimit) {
    const effectiveLimit = typeof wrapLimit === 'number' && wrapLimit > 0
      ? wrapLimit
      : this.getTerminalColumns();
    return parseMarkdown(text, this.fileSystem ? this.fileSystem.root : {}, basePathArr, effectiveLimit);
  }

  escapeHTML(text) {
    return escapeHTML(text);
  }

  clear() {
    this.printGeneration++;
    if (this.output) this.output.innerHTML = '';
    this.glowBackdrops.forEach(el => {
      if (el) el.innerHTML = '';
    });
    if (this.body) this.body.scrollTop = 0;
    this._currentScrollTop = 0;
    this.queueTotalLines = 0;
    this.queueLineIndex = 0;
    this._userScrolledUp = false;
    this.disableAutoScroll = false;
  }

  focus(options = {}) {
    if (this.input) {
      this.input.focus({ preventScroll: true, ...options });
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

  formatCommandLine(cmdStr) {
    const trimmed = (cmdStr || '').trim();
    const commentIdx = findCommentIndex(trimmed);
    if (commentIdx !== -1) {
      const commandPartStr = trimmed.slice(0, commentIdx);
      const commentPartStrFull = trimmed.slice(commentIdx);
      return escapeHTML(commandPartStr) + `<span class="color-dim">${escapeHTML(commentPartStrFull)}</span>`;
    }
    return escapeHTML(trimmed);
  }

  async submit() {
    const val = this.getInputValue();
    this.setInput('', 0);

    if (this.activeInputResolver) {
      const resolve = this.activeInputResolver;
      this.activeInputResolver = null;
      this.activeInputAbortResolver = null;
      resolve(val);
      return 0;
    }

    if (this.isExecutingCommand) return 0;
    return await this.handleInputSubmit(val);
  }

  async enterAndSubmit(text, delay = 0) {
    this.setInput(text);
    if (delay > 0) {
      await this.skippableDelay(delay);
    }
    return await this.submit();
  }

  async handleInputSubmit(val) {
    if (this.loginState !== 'LOGGED_IN' || this.isExecutingCommand) return 0;

    this.isExecutingCommand = true;
    this.scrollToBottomSmooth();
    this.lineEditor.historyDraft = '';
    const trimmed = val.trim();
    if (trimmed !== '') {
      if (this.commandHistory.length === 0 || this.commandHistory[this.commandHistory.length - 1] !== trimmed) {
        this.commandHistory.push(trimmed);
      }
      this.historyIndex = this.commandHistory.length;
    }

    this.hidePromptLine();

    try {
      const code = await this.executeCommand(val, true);
      await this.printQueue;
      return code;
    } catch (err) {
      this.lastExitCode = 1;
      this.print(`Error executing command: ${err.message}`, 'color-error');
      await this.printQueue;
      console.error(err);
      return 1;
    } finally {
      this.isExecutingCommand = false;
      this.showPromptLine();
      this.abortSignal = false;
    }
  }

  async executeCommand(cmdStr, echoPrompt = true) {
    let trimmed = cmdStr.trim();
    if (trimmed === '') {
      if (echoPrompt) {
        const fadePrompt = Boolean(this.isBooting);
        this.print(this.getPromptHtml(), 'color-text', { fade: fadePrompt, instant: !fadePrompt });
      }
      return 0;
    }

    // 1. Bash History Expansions (!! and !$) - only for interactive commands
    if (echoPrompt && this.commandHistory.length > 1) {
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
        this.print(this.escapeHTML(trimmed), 'color-dim', { fade: false, instant: true });
      }
    }

    // 2. Command Chaining with true operator evaluation (&&, ||, ;)
    const chains = splitCommandChainsWithOps(trimmed);
    let shouldRun = true;

    for (let i = 0; i < chains.length; i++) {
      if (this.abortSignal) break;
      const { cmd, op } = chains[i];

      if (shouldRun) {
        const exitCode = await this.executeSingleCommand(cmd, echoPrompt);
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
    return this.lastExitCode;
  }

  async executeSingleCommand(cmdStr, echoPrompt = true) {
    const trimmed = cmdStr.trim();
    if (trimmed === '') return 0;

    const displayPath = this.formatDisplayPath();

    const commentIdx = findCommentIndex(trimmed);
    const commandPart = (commentIdx !== -1 ? trimmed.slice(0, commentIdx) : trimmed).trim();
    const printedLine = this.formatCommandLine(trimmed);

    if (echoPrompt) {
      const fadePrompt = Boolean(this.isBooting);
      this.print(`${this.getPromptHtml()} ${printedLine}`, 'color-text', { fade: fadePrompt, instant: !fadePrompt });
    }

    if (commandPart === '') return 0;

    // Check for redirection (> or >>)
    const redirection = parseRedirection(commandPart);
    if (redirection) {
      commandPart = redirection.command;
      if (!redirection.target) {
        this.print("-bash: syntax error near unexpected token 'newline'", 'color-error');
        return 2;
      }
      this.redirectCapture = [];
    }

    // 3. Variable expansion ($USER, $HOME, $PWD, $?)
    const expandedCommand = expandVariables(commandPart, this.getEnv());
    const parts = parseArgs(expandedCommand);
    if (parts.length === 0) {
      this.redirectCapture = null;
      return 0;
    }

    const command = parts[0];
    const lowerCommand = command.toLowerCase();
    const args = parts.slice(1);

    if (typeof document !== 'undefined' && echoPrompt) {
      document.title = `${command} - ${this.currentUsername}@${this.hostname}: ${displayPath}`;
    }

    if (lowerCommand !== 'cd' && !this.isBooting && echoPrompt) {
      this.updateBrowserUrl(this.formatDisplayPath(), commandPart);
    }

    let runExitCode = 0;

    try {
      // 1. Direct path execution (e.g. ./script.sh, /home/guest/test.sh)
      if (command.includes('/')) {
        const resolved = this.fileSystem.resolvePath(this.currentPath, command);
        if (resolved === null) {
          this.print(`-bash: ${command}: No such file or directory`, 'color-error');
          return 127;
        }
        const node = this.fileSystem.getNodeByPath(resolved);
        if (node === null) {
          this.print(`-bash: ${command}: No such file or directory`, 'color-error');
          return 127;
        }
        if (typeof node === 'object' && !this.fileSystem.isSymlink?.(node)) {
          this.print(`-bash: ${command}: Is a directory`, 'color-error');
          return 126;
        }
        if (!this.fileSystem.isExecutable(resolved)) {
          this.print(`-bash: ${command}: Permission denied`, 'color-error');
          this.print(`<span class="color-dim">Tip: Run '</span><span class="blue cmd-link" data-cmd="chmod +x ${escapeHTML(command)}">chmod +x ${escapeHTML(command)}</span><span class="color-dim">' to make this script executable, or run with '</span><span class="blue cmd-link" data-cmd="bash ${escapeHTML(command)}">bash ${escapeHTML(command)}</span><span class="color-dim">'.</span>`);
          return 126;
        }

        try {
          const content = await this.fileSystem.readFile(resolved);
          runExitCode = await runScript(content, this, command, args, true);
          return runExitCode;
        } catch (err) {
          this.print(`-bash: ${command}: ${err.message}`, 'color-error');
          return 1;
        }
      }

      // 2. Builtin aliases: [ and .
      if (command === '[') {
        if (args.length === 0 || args[args.length - 1] !== ']') {
          this.print("[: missing ']'", 'color-error');
          return 2;
        }
        const testArgs = args.slice(0, -1);
        if (this.commands['test']) {
          runExitCode = await this.commands['test'].run(testArgs, this);
          return typeof runExitCode === 'number' ? runExitCode : 0;
        }
      }

      if (command === '.') {
        if (this.commands['source']) {
          runExitCode = await this.commands['source'].run(args, this);
          return typeof runExitCode === 'number' ? runExitCode : 0;
        }
      }

      if (this.commands[lowerCommand]) {
        const cmd = this.commands[lowerCommand];

        if (cmd.lazy) {
          try {
            const module = await cmd.import();
            const loadedCmd = module[lowerCommand];
            if (loadedCmd) {
              Object.assign(cmd, loadedCmd);
              cmd.lazy = false;
            }
          } catch (err) {
            this.print(`Failed to load command '${command}': ${err.message}`, 'color-error');
            return 1;
          }
        }

        // Parse options and arguments according to command specification
        const parsed = parseCommandArgs(args, cmd);
        if (parsed.error) {
          this.print(`${command}: ${parsed.error}`, 'color-error');
          this.print(`Try '${command} --help' for more information.`);
          return 1;
        }

        // Intercept -h or --help declaratively
        const wantsHelp = !cmd.disableHelp && (parsed.flags.help || (
          args.includes('--help') && (!cmd.options || cmd.options.length === 0)
        ));
        if (wantsHelp) {
          this.printCommandHelp(cmd);
          return 0;
        }

        // Validate required arguments
        if (cmd.args && cmd.args.length > 0) {
          const requiredArgs = cmd.args.filter(a => a.required);
          if (parsed.length < requiredArgs.length) {
            const missingArg = requiredArgs[parsed.length];
            let usage = cmd.name;
            const argUsageStrings = cmd.args.map(a => a.required ? `&lt;${escapeHTML(a.name)}&gt;` : `[${escapeHTML(a.name)}]`);
            if (argUsageStrings.length > 0) {
              usage += ' ' + argUsageStrings.join(' ');
            }
            this.print(`${command}: missing required argument &lt;${escapeHTML(missingArg.name)}&gt;. Usage: <span class="color-green">${usage}</span>`, 'color-error');
            return 1;
          }
        }

        const runResult = await cmd.run(parsed, this, parsed.flags);
        runExitCode = typeof runResult === 'number' ? runResult : 0;
        return runExitCode;
      }

      this.print(`-bash: ${command}: command not found`, 'color-error');
      this.print(`<span class="color-dim">Try '</span><span class="blue cmd-link" data-cmd="help">help</span><span class="color-dim">' or '</span><span class="blue cmd-link" data-cmd="man -k .">man -k .</span><span class="color-dim">' to explore available commands.</span>`);
      return 127;
    } catch (err) {
      this.print(`Error: ${err.message}`, 'color-error');
      return 1;
    } finally {
      if (redirection) {
        const captured = this.redirectCapture ? this.redirectCapture.join('\n') : '';
        this.redirectCapture = null;

        let targetFile = redirection.target.trim();
        if ((targetFile.startsWith('"') && targetFile.endsWith('"')) || (targetFile.startsWith("'") && targetFile.endsWith("'"))) {
          targetFile = targetFile.slice(1, -1);
        }

        const resolved = this.fileSystem.resolveParentAndName(this.currentPath, targetFile);
        if (resolved === null) {
          this.print(`-bash: ${targetFile}: No such file or directory`, 'color-error');
        } else {
          const targetPath = [...resolved.resolvedParent, resolved.name];
          let finalContent = captured;
          if (redirection.op === '>>') {
            try {
              const existing = await this.fileSystem.readFile(targetPath);
              finalContent = (existing ? existing + '\n' : '') + captured;
            } catch (_) { }
          }
          try {
            this.fileSystem.writeFile(targetPath, finalContent);
          } catch (err) {
            this.print(`-bash: ${targetFile}: ${err.message}`, 'color-error');
          }
        }
      }

      if (typeof document !== 'undefined' && echoPrompt) {
        document.title = `${this.currentUsername}@${this.hostname}: ${this.formatDisplayPath()}`;
      }
    }
  }

  printCommandHelp(cmd) {
    let usage = cmd.name;
    const optionsList = (cmd.options && cmd.options.length > 0) ? cmd.options :
      (cmd.man?.options && cmd.man.options.length > 0) ? cmd.man.options : [];
    if (optionsList.length > 0) {
      usage += ' [OPTIONS]';
    }
    const positionalArgs = (cmd.args || []).filter(a => a.name !== 'flags' && !a.name.startsWith('-'));
    if (positionalArgs.length > 0) {
      const argUsageStrings = positionalArgs.map(a => {
        const base = a.required ? `&lt;${escapeHTML(a.name)}&gt;` : `[${escapeHTML(a.name)}]`;
        return a.variadic ? `${base}...` : base;
      });
      usage += ' ' + argUsageStrings.join(' ');
    }
    let helpText = `<span class="blue" style="font-weight: bold;">Usage:</span> <span class="color-green">${usage}</span>\n`;
    if (cmd.description) {
      helpText += `<span class="blue" style="font-weight: bold;">Description:</span> ${escapeHTML(cmd.description)}\n`;
    }
    if (optionsList.length > 0) {
      helpText += `\n<span class="blue" style="font-weight: bold;">Options:</span>`;
      for (const opt of optionsList) {
        const flagName = opt.flags ? (Array.isArray(opt.flags) ? opt.flags.join(', ') : opt.flags) : (opt.flag || opt.name || '');
        const rawFlag = flagName;
        const paddedFlag = rawFlag.padEnd(20);
        const styledFlag = paddedFlag.replace(rawFlag, `<span class="color-accent">${escapeHTML(rawFlag)}</span>`);
        helpText += `\n  ${styledFlag} ${escapeHTML(opt.description || opt.desc || '')}`;
      }
    }
    if (positionalArgs.length > 0) {
      helpText += `\n<span class="blue" style="font-weight: bold;">Arguments:</span>`;
      for (const arg of positionalArgs) {
        const rawArgName = arg.required ? `<${arg.name}>` : `[${arg.name}]`;
        const escapedArgName = arg.required ? `&lt;${escapeHTML(arg.name)}&gt;` : `[${escapeHTML(arg.name)}]`;
        const paddedArgName = rawArgName.padEnd(16);
        const styledArgName = paddedArgName.replace(rawArgName, `<span class="color-accent">${escapedArgName}</span>`);

        const reqText = arg.required ? '(Required)' : '(Optional)';
        const reqSpan = arg.required ? `<span class="red">${reqText}</span>` : `<span class="color-dim">${reqText}</span>`;
        const paddedReqText = reqText.padEnd(12);
        const styledReqText = paddedReqText.replace(reqText, reqSpan);

        helpText += `\n  ${styledArgName} ${styledReqText} ${escapeHTML(arg.description || '')}`;
      }
    }
    helpText += `\n\n<span class="color-dim">For full manual page, try '</span><span class="blue cmd-link" data-cmd="man ${cmd.name}">man ${cmd.name}</span><span class="color-dim">'.</span>`;
    this.print(helpText);
  }

  handleTabAutocomplete() {
    const currentVal = this.input.value;
    if (currentVal.trimStart() === '') return;

    const cursorPos = this.lineEditor.getCursorPos();
    const result = getCompletions({
      input: currentVal,
      cursorPos,
      shell: this
    });

    if (!result || !result.matches || result.matches.length === 0) {
      this.playTerminalBell();
      this.tabCount = 0;
      return;
    }

    // 1. Single match: apply immediately
    if (result.matches.length === 1 && result.replacement !== null) {
      this.setInput(result.replacement, result.newCursorPos);
      this.tabCount = 0;
      return;
    }

    // 2. Multiple matches: check if LCP can be extended
    const now = Date.now();
    const isConsecutive = (now - this.lastTabTimestamp < TAB_DOUBLE_PRESS_INTERVAL) && (this.lastTabInput === currentVal);
    this.lastTabTimestamp = now;
    this.lastTabInput = currentVal;

    if (result.lcp && result.lcp.length > result.currentToken.length) {
      this.setInput(result.lcpReplacement, result.newLcpCursorPos);
      this.lastTabInput = result.lcpReplacement;
      this.tabCount = 1;
      return;
    }

    // 3. Already at LCP:
    // 1st Tab: ring subtle terminal bell
    // 2nd Tab: echo prompt in scrollback and display candidates
    if (isConsecutive && this.tabCount >= 1) {
      this.print(`${this.getPromptHtml()} ${this.escapeHTML(currentVal)}`, 'color-text', { instant: true, fade: false });
      this.print(result.formattedMatches.join('    '));
      this.tabCount = 0;
    } else {
      this.playTerminalBell();
      this.tabCount = 1;
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
        this.setInput(fullCleanText);
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
          this.setInput(displayedText);
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
    await this.submit();
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
    this.hidePromptLine();
    this.promptPrefix.innerHTML = '';
    this.inputDisplay.textContent = '';

    const { initialPath, initialCommand } = this.getInitialDeepLink();

    if (initialCommand || (initialPath && initialPath !== '~')) {
      this.disableAutoScroll = true;
      if (this.body) this.body.scrollTop = 0;
      this._currentScrollTop = 0;
    }

    audio.startHum();

    const sshCmd = `ssh ${this.currentUsername}@${this.hostname}`;
    this.print(`<span class="color-accent">${this.localPrompt}</span> ${sshCmd}`, 'color-text');

    if (this.onConnect) {
      await this.onConnect(this);
    }

    this.loginState = 'LOGGED_IN';
    audio.fadeHumQuiet();

    // Preset initial ls
    await this.executeCommand('ls # click items to navigate, or use cat/cd', true);

    if (initialPath && initialPath !== '~' && this.fileSystem) {
      const resolved = this.fileSystem.resolvePath(this.currentPath, initialPath);
      if (resolved !== null) {
        const targetObj = this.fileSystem.getNodeByPath(resolved);
        const isDir = typeof targetObj === 'object';

        if (isDir) {
          await this.executeCommand(`cd ${initialPath}`, true);
          if (!initialCommand) {
            await this.executeCommand('ls', true);
          }
        } else {
          const slashIdx = initialPath.lastIndexOf('/');
          if (slashIdx !== -1) {
            const parentDir = initialPath.slice(0, slashIdx);
            const fileName = initialPath.slice(slashIdx + 1);
            await this.executeCommand(`cd ${parentDir}`, true);
            await this.executeCommand(`cat ${fileName}`, true);
          } else {
            await this.executeCommand(`cat ${initialPath}`, true);
          }
        }
      } else {
        this.print(`Target path '${initialPath}' not found.`, 'color-error');
      }
    }

    if (initialCommand) {
      const trimmed = initialCommand.trim();
      if (trimmed !== '') {
        if (this.commandHistory.length === 0 || this.commandHistory[this.commandHistory.length - 1] !== trimmed) {
          this.commandHistory.push(trimmed);
        }
        this.historyIndex = this.commandHistory.length;
      }
      await this.executeCommand(initialCommand, true);
    }

    await this.printQueue;
    this.isBooting = false;

    if (initialCommand || (initialPath && initialPath !== '~')) {
      this.disableAutoScroll = false;
      this._userScrolledUp = true;
    }

    this.showPromptLine();
    this.updateBrowserUrl(this.formatDisplayPath(), initialCommand);
  }
}
