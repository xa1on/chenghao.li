/**
 * Terminal manual page viewer with interactive pager.
 * Supports standard Unix man sections, apropos search (man -k), and alternate screen browsing.
 */

export function generateManHeaderLine(name, width = 80) {
  const leftHeader = `${name.toUpperCase()}(1)`;
  const centerHeader = 'General Commands Manual';
  const rightHeader = `${name.toUpperCase()}(1)`;

  const spaceCount = Math.max(2, width - leftHeader.length - centerHeader.length - rightHeader.length);
  const leftSpace = ' '.repeat(Math.floor(spaceCount / 2));
  const rightSpace = ' '.repeat(Math.ceil(spaceCount / 2));
  return `<span class="color-dim">${leftHeader}${leftSpace}${centerHeader}${rightSpace}${rightHeader}</span>`;
}

export class TerminalPager {
  constructor(shell, title, lines, isManPage = true) {
    this.shell = shell;
    this.title = title;
    this.lines = lines;
    this.isManPage = isManPage;

    this.scrollTop = 0;
    this.maxVisibleLines = 20;
    this.terminalColumns = 80;
    this.showHelpBar = false;

    this.container = null;
    this.contentEl = null;
    this.statusEl = null;
    this.helpEl = null;

    this.originalState = this.shell.loginState;
    this.resolvePromise = null;
    this.keyHandler = (e) => this.handleKeydown(e);
    this.wheelHandler = (e) => this.handleWheel(e);
    this.resizeObserver = null;
  }

  start() {
    return new Promise((resolve) => {
      this.resolvePromise = resolve;

      // Save and reset terminal body scroll position to align full-screen pager to viewport
      this.savedScrollTop = this.shell.body ? this.shell.body.scrollTop : 0;
      window.scrollTo(0, 0);
      document.documentElement.scrollTop = 0;
      if (this.shell.body) {
        this.shell.body.scrollTop = 0;
        this.shell.body.scrollLeft = 0;
      }

      // Hide shell standard output & prompt
      this.shell.output.style.display = 'none';
      this.shell.inputLine.classList.add('hidden-input-line');

      // Hide glow backdrops to prevent phantom scroll height or bleed-through
      if (this.shell.glowBackdrops) {
        this.shell.glowBackdrops.forEach(el => {
          if (el) el.style.display = 'none';
        });
      }

      this.shell.body.style.overflowY = 'hidden';

      this.shell.loginState = 'GAME'; // Pause regular readline input

      // Create container
      this.container = document.createElement('div');
      this.container.className = 'terminal-editor terminal-pager';
      this.container.tabIndex = 0;
      this.container.style.cssText = `
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
        min-height: 0;
        font-family: inherit;
        color: inherit;
        background: transparent;
        outline: none;
        user-select: text;
        line-height: 1.25;
      `;

      // Content viewer
      this.contentEl = document.createElement('div');
      this.contentEl.className = 'pager-content';
      this.contentEl.style.cssText = `
        flex: 1;
        overflow: hidden;
        min-height: 0;
        white-space: pre-wrap;
        word-break: break-all;
        padding: 4px 6px;
      `;
      this.container.appendChild(this.contentEl);

      // Status line
      this.statusEl = document.createElement('div');
      this.statusEl.className = 'pager-status';
      this.statusEl.style.cssText = `
        background-color: #e5e5e5;
        color: #0b0b12;
        font-weight: bold;
        padding: 1px 8px;
        text-shadow: none !important;
        display: flex;
        justify-content: space-between;
        font-size: 0.95em;
      `;
      this.container.appendChild(this.statusEl);

      // Help bar (toggled with 'h')
      this.helpEl = document.createElement('div');
      this.helpEl.className = 'pager-help-bar';
      this.helpEl.style.cssText = `
        background-color: #1a1a24;
        color: #a0a0b0;
        padding: 2px 8px;
        font-size: 0.85em;
        border-top: 1px solid rgba(255,255,255,0.1);
        display: none;
      `;
      this.helpEl.innerHTML = `<span class="color-accent">Commands:</span> [j/Down: line down] [k/Up: line up] [Space/PgDn: page down] [b/PgUp: page up] [g: top] [G: end] [q: quit] [h: toggle help]`;
      this.container.appendChild(this.helpEl);

      this.shell.body.appendChild(this.container);

      // Global capture keydown listener ensures 'q' and 'h' are caught reliably regardless of focus
      document.addEventListener('keydown', this.keyHandler, true);
      if (this.shell.pushInputHandler) {
        this.shell.pushInputHandler(this.keyHandler);
      }
      this.container.addEventListener('wheel', this.wheelHandler, { passive: false });

      this.resizeObserver = new ResizeObserver(() => {
        this.measureLayout();
        this.render();
      });
      this.resizeObserver.observe(this.container);

      this.measureLayout();
      this.render();
      this.container.focus();
    });
  }

  measureLayout() {
    if (!this.contentEl) return;
    const testSpan = document.createElement('span');
    testSpan.textContent = 'M';
    testSpan.style.fontFamily = 'inherit';
    testSpan.style.visibility = 'hidden';
    this.contentEl.appendChild(testSpan);
    const charWidth = testSpan.getBoundingClientRect().width || 8.5;
    const lineHeight = testSpan.getBoundingClientRect().height || 18;
    testSpan.remove();

    const availableWidth = this.contentEl.clientWidth || (this.container ? this.container.clientWidth - 16 : 640);
    this.terminalColumns = Math.max(40, Math.floor(availableWidth / charWidth));

    // Dynamically scale the top bar if this is a manual page
    if (this.isManPage && this.lines.length > 0) {
      this.lines[0] = generateManHeaderLine(this.title, this.terminalColumns);
    }

    const contentHeight = this.contentEl.clientHeight || (this.container ? this.container.clientHeight - 26 : 400);
    this.maxVisibleLines = Math.max(5, Math.floor(contentHeight / lineHeight));
    const maxScroll = Math.max(0, this.lines.length - this.maxVisibleLines);
    if (this.scrollTop > maxScroll) {
      this.scrollTop = maxScroll;
    }
  }

  handleWheel(e) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 3 : -3;
    this.scrollBy(delta);
  }

  handleKeydown(e) {
    const key = e.key;

    if (key === 'q' || key === 'Q' || key === 'Escape' || (e.ctrlKey && key.toLowerCase() === 'c')) {
      e.preventDefault();
      e.stopPropagation();
      this.close();
      return;
    }

    if (key === 'h' || key === 'H') {
      e.preventDefault();
      e.stopPropagation();
      this.showHelpBar = !this.showHelpBar;
      this.helpEl.style.display = this.showHelpBar ? 'block' : 'none';
      this.measureLayout();
      this.render();
      return;
    }

    if (key === 'ArrowDown' || key === 'j' || key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      this.scrollBy(1);
      return;
    }

    if (key === 'ArrowUp' || key === 'k') {
      e.preventDefault();
      e.stopPropagation();
      this.scrollBy(-1);
      return;
    }

    if (key === ' ' || key === 'PageDown' || (e.ctrlKey && key.toLowerCase() === 'f')) {
      e.preventDefault();
      e.stopPropagation();
      this.scrollBy(Math.max(1, this.maxVisibleLines - 2));
      return;
    }

    if (key === 'PageUp' || key === 'b' || (e.ctrlKey && key.toLowerCase() === 'b')) {
      e.preventDefault();
      e.stopPropagation();
      this.scrollBy(-Math.max(1, this.maxVisibleLines - 2));
      return;
    }

    if (key === 'g' || key === 'Home') {
      e.preventDefault();
      e.stopPropagation();
      this.scrollTo(0);
      return;
    }

    if (key === 'G' || key === 'End') {
      e.preventDefault();
      e.stopPropagation();
      const maxScroll = Math.max(0, this.lines.length - this.maxVisibleLines);
      this.scrollTo(maxScroll);
      return;
    }
  }

  scrollBy(delta) {
    const maxScroll = Math.max(0, this.lines.length - this.maxVisibleLines);
    this.scrollTop = Math.max(0, Math.min(maxScroll, this.scrollTop + delta));
    this.render();
  }

  scrollTo(pos) {
    const maxScroll = Math.max(0, this.lines.length - this.maxVisibleLines);
    this.scrollTop = Math.max(0, Math.min(maxScroll, pos));
    this.render();
  }

  render() {
    if (!this.contentEl) return;

    const visibleSlice = this.lines.slice(this.scrollTop, this.scrollTop + this.maxVisibleLines);
    this.contentEl.innerHTML = visibleSlice.join('\n');

    const totalLines = this.lines.length;
    const currentLine = Math.min(totalLines, this.scrollTop + 1);
    const isAtEnd = this.scrollTop + this.maxVisibleLines >= totalLines;
    const pct = totalLines > 0 ? Math.round(((this.scrollTop + Math.min(totalLines, this.maxVisibleLines)) / totalLines) * 100) : 100;

    const statusText = isAtEnd
      ? ` Manual page ${this.title}(1) line ${currentLine}/${totalLines} 100% (END) (press h for help or q to quit)`
      : ` Manual page ${this.title}(1) line ${currentLine}/${totalLines} ${pct}% (press h for help or q to quit)`;

    this.statusEl.textContent = statusText;
  }

  close() {
    document.removeEventListener('keydown', this.keyHandler, true);

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    if (this.container) {
      this.container.remove();
    }

    this.shell.output.style.display = 'flex';
    this.shell.inputLine.classList.remove('hidden-input-line');
    if (this.shell.glowBackdrops) {
      this.shell.glowBackdrops.forEach(el => {
        if (el) el.style.display = '';
      });
    }
    this.shell.body.style.overflowY = '';
    this.shell.loginState = this.originalState;

    if (this.shell.popInputHandler) {
      this.shell.popInputHandler();
    }

    this.shell.updatePrompt();
    this.shell.focus();
    if (this.shell.body && typeof this.savedScrollTop === 'number') {
      this.shell.body.scrollTop = this.savedScrollTop;
    } else if (this.shell.body) {
      this.shell.body.scrollTop = this.shell.body.scrollHeight;
    }

    if (this.resolvePromise) {
      this.resolvePromise();
    }
  }
}

/**
 * Generate formatted man page lines for a command.
 * Dynamically includes canonical sections only when relevant/defined.
 */
export function generateManLines(cmd, shell, width = 80) {
  const name = cmd.name;
  const man = cmd.man || {};

  // Header line dynamically generated for width
  const headerLine = generateManHeaderLine(name, width);
  const lines = [headerLine, ''];

  // Helper for section title
  const addSection = (title, contentLines) => {
    lines.push(`<span class="blue" style="font-weight: bold;">${title}</span>`);
    for (const line of contentLines) {
      lines.push(line);
    }
    lines.push('');
  };

  // NAME
  const shortDesc = man.shortDesc || cmd.description || man.description || 'no description available';
  addSection('NAME', [
    `       ${name} - ${shortDesc}`
  ]);

  // SYNOPSIS
  let synopsisText = `${name}`;
  if (man.synopsis) {
    synopsisText = man.synopsis;
  } else if (cmd.args && cmd.args.length > 0) {
    const argStrs = cmd.args.map(a => a.required ? `&lt;${a.name}&gt;` : `[${a.name}]`);
    synopsisText += ' ' + argStrs.join(' ');
  }
  addSection('SYNOPSIS', [
    `       <span class="color-accent">${synopsisText}</span>`
  ]);

  // DESCRIPTION
  const fullDesc = man.description || cmd.description || '';
  const descParagraphs = fullDesc.split('\n\n').filter(Boolean);
  const descLines = descParagraphs.map(p => `       ${p.replace(/\n/g, '\n       ')}`);
  if (descLines.length > 0) {
    addSection('DESCRIPTION', descLines);
  }

  // OPTIONS / ARGUMENTS
  if (man.options && man.options.length > 0) {
    const optLines = [];
    for (const opt of man.options) {
      optLines.push(`       <span class="color-green">${opt.flags || opt.name}</span>`);
      optLines.push(`              ${opt.desc || opt.description}`);
      optLines.push('');
    }
    if (optLines.length > 0 && optLines[optLines.length - 1] === '') optLines.pop();
    addSection('OPTIONS', optLines);
  } else if (cmd.args && cmd.args.length > 0) {
    const argLines = [];
    for (const arg of cmd.args) {
      const label = arg.required ? `&lt;${arg.name}&gt; (required)` : `[${arg.name}] (optional)`;
      argLines.push(`       <span class="color-green">${label}</span>`);
      argLines.push(`              ${arg.description}`);
      argLines.push('');
    }
    if (argLines.length > 0 && argLines[argLines.length - 1] === '') argLines.pop();
    addSection('ARGUMENTS', argLines);
  }

  // EXAMPLES
  if (man.examples && man.examples.length > 0) {
    const exLines = [];
    for (const ex of man.examples) {
      if (ex.desc) {
        exLines.push(`       ${ex.desc}`);
      }
      exLines.push(`              <span class="color-accent">${ex.cmd || ex.command}</span>`);
      exLines.push('');
    }
    if (exLines.length > 0 && exLines[exLines.length - 1] === '') exLines.pop();
    addSection('EXAMPLES', exLines);
  }

  // FILES (only if defined)
  if (man.files && man.files.length > 0) {
    const fileLines = [];
    for (const file of man.files) {
      fileLines.push(`       <span class="color-green">${file.path}</span>`);
      fileLines.push(`              ${file.desc}`);
      fileLines.push('');
    }
    if (fileLines.length > 0 && fileLines[fileLines.length - 1] === '') fileLines.pop();
    addSection('FILES', fileLines);
  }

  // ENVIRONMENT (only if defined)
  if (man.environment && man.environment.length > 0) {
    const envLines = [];
    for (const env of man.environment) {
      envLines.push(`       <span class="color-green">${env.name}</span>`);
      envLines.push(`              ${env.desc}`);
      envLines.push('');
    }
    if (envLines.length > 0 && envLines[envLines.length - 1] === '') envLines.pop();
    addSection('ENVIRONMENT', envLines);
  }

  // BUGS
  const bugsText = man.bugs || 'Known quirks or bugs can be reported at https://github.com/xa1on/xa1on.github.io/issues.';
  addSection('BUGS', [
    `       ${bugsText}`
  ]);

  // AUTHOR (only rendered if explicitly specified)
  if (man.author) {
    addSection('AUTHOR', [
      `       ${man.author}`
    ]);
  }

  // SEE ALSO
  const seeAlsoText = man.seeAlso || 'help(1), info(1)';
  addSection('SEE ALSO', [
    `       ${seeAlsoText}`
  ]);

  // Trailing blank lines
  lines.push('');
  return lines;
}

export const man = {
  name: 'man',
  description: 'An interface to the system reference manuals.',
  category: 'general',
  args: [
    { name: 'command', description: 'The command name to view manual for, or -k <keyword> to search.', required: false }
  ],
  man: {
    description: 'man is the system manual pager. Each page argument given to man is normally the name of a program, utility or function.',
    synopsis: 'man [-k] [name]',
    options: [
      { flags: '-k, --apropos <keyword>', desc: 'Search manual page names and descriptions for matching keywords.' }
    ],
    examples: [
      { cmd: 'man ls', desc: 'Display the manual page for the ls utility.' },
      { cmd: 'man -k game', desc: 'Search for manual pages containing the word "game".' },
      { cmd: 'man -k .', desc: 'List all available manual pages.' }
    ],
    seeAlso: 'help(1), info(1)'
  },
  run: async (args, shell) => {
    if (args.length === 0) {
      shell.print("What manual page do you want?\nFor example, try 'man man' or 'man -k .' to view all available pages.");
      return 1;
    }

    // Handle apropos search (-k or --apropos)
    if (args[0] === '-k' || args[0] === '--apropos') {
      const keyword = args.slice(1).join(' ').trim().toLowerCase();
      if (!keyword) {
        shell.print("man: option requires an argument -- 'k'\nTry 'man --help' or 'man man' for more information.", 'color-error');
        return 1;
      }

      const matches = [];
      const isMatchAll = keyword === '.' || keyword === '*' || keyword === 'all';

      for (const [name, cmd] of Object.entries(shell.commands)) {
        const desc = (cmd.description || cmd.helpText || '').toLowerCase();
        const cat = (cmd.category || '').toLowerCase();
        if (isMatchAll || name.toLowerCase().includes(keyword) || desc.includes(keyword) || cat.includes(keyword)) {
          matches.push({ name, desc: cmd.description || cmd.helpText || '' });
        }
      }

      if (matches.length === 0) {
        shell.print(`${keyword}: nothing appropriate.`);
        return 0;
      }

      matches.sort((a, b) => a.name.localeCompare(b.name));
      let out = '';
      for (const m of matches) {
        const padded = `${m.name} (1)`.padEnd(20);
        out += `<span class="blue cmd-link" data-cmd="man ${m.name}">${padded}</span> - ${m.desc}\n`;
      }
      shell.print(out.trimEnd());
      return 0;
    }

    const targetName = args[0].toLowerCase();

    // Check if target is a command
    let cmd = shell.commands[targetName];
    if (!cmd) {
      shell.print(`No manual entry for ${targetName}`);
      return 1;
    }

    // Resolve lazy command if needed
    if (cmd.lazy && typeof cmd.import === 'function') {
      try {
        const module = await cmd.import();
        const loadedCmd = module[targetName];
        if (loadedCmd) {
          Object.assign(cmd, loadedCmd);
          cmd.lazy = false;
        }
      } catch (err) {
        shell.print(`Failed to load manual for '${targetName}': ${err.message}`, 'color-error');
        return 1;
      }
    }

    const lines = generateManLines(cmd, shell);
    const pager = new TerminalPager(shell, targetName, lines, true);
    await pager.start();
    return 0;
  }
};
