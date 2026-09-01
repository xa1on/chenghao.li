import { audio } from '../../audio.js?v=38beffc128';

export const paint = {
  name: 'paint',
  description: 'Create and edit ASCII art with colors and block characters.',
  category: 'filesystem',
  lazy: true,
  args: [
    { name: 'filename', description: 'File to edit or create (supports .art for colors, or .txt for plain text).', required: true },
    { name: '--width, -w', description: 'Override the canvas width (optional).', required: false },
    { name: '--height, -h', description: 'Override the canvas height (optional).', required: false }
  ],
  run: async (args, shell) => {
    if (args.length === 0) {
      shell.print('paint: missing filename operand. Usage: paint [filename] [-w width] [-h height]', 'color-error');
      return;
    }

    let fileArg = null;
    let widthOverride = null;
    let heightOverride = null;

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === '--width' || arg === '-w') {
        const val = parseInt(args[i + 1], 10);
        if (!isNaN(val) && val > 0) {
          widthOverride = val;
          i++;
        }
      } else if (arg === '--height' || arg === '-h') {
        const val = parseInt(args[i + 1], 10);
        if (!isNaN(val) && val > 0) {
          heightOverride = val;
          i++;
        }
      } else if (!fileArg) {
        fileArg = arg.trim();
      }
    }

    if (!fileArg) {
      shell.print('paint: missing filename operand. Usage: paint [filename] [-w width] [-h height]', 'color-error');
      return;
    }

    while (fileArg.endsWith('/') && fileArg.length > 1) {
      fileArg = fileArg.slice(0, -1);
    }

    let resolved = shell.fileSystem.resolvePath(shell.currentPath, fileArg);
    let initialContent = '';
    let isNewFile = false;

    if (resolved === null) {
      const parentAndName = shell.fileSystem.resolveParentAndName(shell.currentPath, fileArg);
      if (parentAndName === null) {
        shell.print(`paint: cannot open '${fileArg}': No such file or directory`, 'color-error');
        return;
      }
      resolved = [...parentAndName.resolvedParent, parentAndName.name];
      isNewFile = true;
    } else {
      const node = shell.fileSystem.getNodeByPath(resolved);
      if (node && typeof node === 'object') {
        shell.print(`paint: '${fileArg}' is a directory`, 'color-error');
        return;
      }
      try {
        initialContent = await shell.fileSystem.readFile(resolved);
      } catch (err) {
        shell.print(`paint: error reading '${fileArg}': ${err.message}`, 'color-error');
        return;
      }
    }

    return new Promise((resolve) => {
      const onSave = (content) => {
        try {
          shell.fileSystem.writeFile(resolved, content);
          return true;
        } catch (err) {
          return err.message;
        }
      };

      const onExit = () => {
        resolve();
      };

      const editor = new PaintEditor(
        shell,
        fileArg,
        initialContent,
        resolved,
        onSave,
        onExit,
        isNewFile,
        widthOverride,
        heightOverride
      );
      editor.start();
    });
  }
};

class PaintEditor {
  constructor(shell, filename, initialContent, resolvedPath, onSave, onExit, isNewFile, widthOverride = null, heightOverride = null) {
    this.shell = shell;
    this.filename = filename;
    this.initialContent = initialContent;
    this.resolvedPath = resolvedPath;
    this.onSave = onSave;
    this.onExit = onExit;
    this.isNewFile = isNewFile;

    // Optional user overrides
    this.widthOverride = widthOverride;
    this.heightOverride = heightOverride;

    this.container = null;
    this.gridEl = null;
    this.statusEl = null;

    this.isModified = false;
    this.originalState = this.shell.loginState;
    this.shell.loginState = 'GAME'; // Bypass shell typing listener

    // Canvas state
    this.width = 40;
    this.height = 20;
    this.cells = []; // 2D array: this.cells[y][x] = { char, color, background }
    this.cellDOMs = []; // 2D array of DOM elements: this.cellDOMs[y][x]
    this.fontSize = 16; // default font size

    // Tool & brush state
    this.activeTool = 'pencil'; // pencil, eraser, bucket
    this.activeChar = '█'; // default block
    this.activeColor = 'white'; // white, red, green, yellow, blue, magenta, cyan, color-dim
    this.activeBgColor = 'none'; // background color defaults to transparent/none
    this.autoDraw = false; // drawing lock

    // Check color support: only .art files support coloring UI
    this.isColorSupported = this.filename.endsWith('.art');

    // Cursor coordinates
    this.cursorX = 0;
    this.cursorY = 0;

    // Undo / Redo history stacks
    this.undoStack = [];
    this.redoStack = [];

    // Mouse drawing state
    this.isMouseDown = false;
    this.lastMousePos = { x: -1, y: -1 };

    // Standard blocks
    this.blocks = ['█', '▓', '▒', '░', '▀', '▄'];
    // Brush color options
    this.brushColors = [
      'white', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan',
      'white color-dim', 'red color-dim', 'green color-dim', 'yellow color-dim', 'blue color-dim', 'magenta color-dim', 'cyan color-dim'
    ];
    // Background color options
    this.bgColors = [
      'none',
      'bg-white', 'bg-red', 'bg-green', 'bg-yellow', 'bg-blue', 'bg-magenta', 'bg-cyan',
      'bg-white color-dim', 'bg-red color-dim', 'bg-green color-dim', 'bg-yellow color-dim', 'bg-blue color-dim', 'bg-magenta color-dim', 'bg-cyan color-dim'
    ];

    // Toolbar element references for O(1) toolbar rendering updates
    this.toolDOMs = {};
    this.blockDOMs = [];
    this.colorDOMs = {};
    this.bgColorDOMs = {};

    this.statusMessage = isNewFile ? `"${filename}" [New File]` : `"${filename}"`;
    this.statusTimeout = null;

    this.parseInitialContent();
  }

  showStatus(msg) {
    this.statusMessage = msg;
    this.drawHeader();
    if (this.statusTimeout) clearTimeout(this.statusTimeout);
    this.statusTimeout = setTimeout(() => {
      this.statusMessage = '';
      this.drawHeader();
    }, 4000);
  }

  parseInitialContent() {
    let loadedData = null;
    const isArtFile = this.filename.endsWith('.art');
    const contentStr = typeof this.initialContent === 'string' ? this.initialContent : '';

    if (isArtFile && contentStr.trim()) {
      try {
        loadedData = JSON.parse(contentStr);
      } catch (e) {
        // Fallback if JSON parse fails
      }
    }

    // Determine dimensions: Priority order -> 1. Command arguments, 2. Art file metadata, 3. Viewport auto-fit
    let loadedWidth = null;
    let loadedHeight = null;
    if (loadedData && typeof loadedData.width === 'number' && typeof loadedData.height === 'number') {
      loadedWidth = loadedData.width;
      loadedHeight = loadedData.height;
    }

    const containerWidth = window.innerWidth - 100;
    const containerHeight = window.innerHeight - 280;
    const defaultWidth = Math.max(10, Math.min(120, Math.floor(containerWidth / 20)));
    const defaultHeight = Math.max(5, Math.min(60, Math.floor(containerHeight / 20)));

    this.width = this.widthOverride !== null ? this.widthOverride : (loadedWidth !== null ? loadedWidth : defaultWidth);
    this.height = this.heightOverride !== null ? this.heightOverride : (loadedHeight !== null ? loadedHeight : defaultHeight);

    // Initialize cells
    this.cells = [];
    for (let y = 0; y < this.height; y++) {
      const row = [];
      for (let x = 0; x < this.width; x++) {
        row.push({ char: ' ', color: 'white', background: 'none' });
      }
      this.cells.push(row);
    }

    // Populate data
    if (loadedData && Array.isArray(loadedData.cells)) {
      let idx = 0;
      for (let y = 0; y < this.height; y++) {
        for (let x = 0; x < this.width; x++) {
          if (idx < loadedData.cells.length) {
            const cell = loadedData.cells[idx++];
            if (cell) {
              this.cells[y][x] = {
                char: cell.char || ' ',
                color: cell.color || cell.fg || 'white',
                background: cell.background || cell.bg || 'none'
              };
            }
          }
        }
      }
    } else if (!isArtFile && contentStr) {
      // Load raw plain text
      const lines = contentStr.split(/\r?\n/);
      if (lines.length > this.height) {
        this.height = lines.length;
        this.cells = Array.from({ length: this.height }, () =>
          Array.from({ length: this.width }, () => ({ char: ' ', color: 'white', background: 'none' }))
        );
      }
      for (let y = 0; y < Math.min(lines.length, this.height); y++) {
        const line = lines[y];
        if (line.length > this.width) {
          const oldWidth = this.width;
          this.width = line.length;
          for (let r = 0; r < this.height; r++) {
            while (this.cells[r].length < this.width) {
              this.cells[r].push({ char: ' ', color: 'white', background: 'none' });
            }
          }
        }
        for (let x = 0; x < Math.min(line.length, this.width); x++) {
          this.cells[y][x].char = line[x];
        }
      }
    }
  }

  saveSnapshot() {
    const snapshot = this.cells.map(row => row.map(cell => ({ ...cell })));
    this.undoStack.push(snapshot);
    this.redoStack = []; // clear redo on new action
    if (this.undoStack.length > 50) {
      this.undoStack.shift();
    }
  }

  undo() {
    if (this.undoStack.length > 0) {
      const current = this.cells.map(row => row.map(cell => ({ ...cell })));
      this.redoStack.push(current);
      this.cells = this.undoStack.pop();
      this.isModified = true;
      this.drawFullGrid();
      this.drawHeader();
      audio.playKeyclick('u');
    } else {
      this.showStatus('Nothing to undo');
    }
  }

  redo() {
    if (this.redoStack.length > 0) {
      const current = this.cells.map(row => row.map(cell => ({ ...cell })));
      this.undoStack.push(current);
      this.cells = this.redoStack.pop();
      this.isModified = true;
      this.drawFullGrid();
      this.drawHeader();
      audio.playKeyclick('r');
    } else {
      this.showStatus('Nothing to redo');
    }
  }

  start() {
    // Hide terminal output & input
    this.shell.output.style.display = 'none';
    this.shell.inputLine.classList.add('hidden-input-line');
    this.shell.body.style.overflowY = 'hidden';

    // Reset view scrolling to top to align the full-screen layout to the viewport
    window.scrollTo(0, 0);
    if (this.shell.body) {
      this.shell.body.scrollTop = 0;
    }
    document.documentElement.scrollTop = 0;

    // Create container
    this.container = document.createElement('div');
    this.container.className = 'terminal-editor paint-editor';
    this.container.style.display = 'flex';
    this.container.style.flexDirection = 'column';
    this.container.style.width = '100%';
    this.container.style.height = '100%';

    // Append to terminal body
    this.shell.body.appendChild(this.container);

    // Initial DOM setup
    this.setupDOM();

    // Event listeners - Delay binding to avoid catching the Enter key that launched the command
    this.keydownHandler = (e) => this.handleKeydown(e);
    setTimeout(() => {
      window.addEventListener('keydown', this.keydownHandler);
    }, 50);

    this.mouseupHandler = () => {
      this.isMouseDown = false;
      this.lastMousePos = { x: -1, y: -1 };
    };
    window.addEventListener('mouseup', this.mouseupHandler);

    this.container.addEventListener('contextmenu', (e) => e.preventDefault());

    this.drawAll();
  }

  cleanup() {
    window.removeEventListener('keydown', this.keydownHandler);
    window.removeEventListener('mouseup', this.mouseupHandler);

    if (this.statusTimeout) clearTimeout(this.statusTimeout);
    if (this.container) this.container.remove();

    // Restore terminal
    this.shell.output.style.display = 'flex';
    this.shell.inputLine.classList.remove('hidden-input-line');
    this.shell.body.style.overflowY = '';
    this.shell.loginState = this.originalState;
    this.shell.updatePrompt();
    this.shell.focus();
  }

  setupDOM() {
    const colorHelp = this.isColorSupported ? '<div class="paint-help-item"><span class="paint-help-key">c</span> Cycle Brush Color</div><div class="paint-help-item"><span class="paint-help-key">v</span> Cycle Background Color</div>' : '';

    this.container.innerHTML = `
      <div class="paint-header" id="paint-header"></div>
      <div class="paint-content">
        <div class="paint-grid" id="paint-grid"></div>
      </div>
      <div class="paint-footer">
        <div class="paint-toolbar" id="paint-toolbar"></div>
        <div class="paint-help-grid">
          <div class="paint-help-item"><span class="paint-help-key">Arrows/WASD</span> Move</div>
          <div class="paint-help-item"><span class="paint-help-key">Space</span> Draw</div>
          <div class="paint-help-item"><span class="paint-help-key">Enter</span> Toggle Autodraw</div>
          <div class="paint-help-item"><span class="paint-help-key">Shift+Move</span> Line Draw</div>
          <div class="paint-help-item"><span class="paint-help-key">Backspace/0</span> Erase</div>
          <div class="paint-help-item"><span class="paint-help-key">1-6</span> Select Blocks</div>
          <div class="paint-help-item"><span class="paint-help-key">Any Key</span> Custom Brush</div>
          ${colorHelp}
          <div class="paint-help-item"><span class="paint-help-key">t</span> Cycle Tool</div>
          <div class="paint-help-item"><span class="paint-help-key">+/-</span> Zoom Canvas</div>
          <div class="paint-help-item"><span class="paint-help-key">u/r</span> Undo/Redo</div>
          <div class="paint-help-item"><span class="paint-help-key">Ctrl+s/q</span> Save/Quit</div>
        </div>
      </div>
    `;

    this.gridEl = this.container.querySelector('#paint-grid');
    this.statusEl = this.container.querySelector('#paint-header');
    this.toolbarEl = this.container.querySelector('#paint-toolbar');

    this.gridEl.style.gridTemplateColumns = `repeat(${this.width}, 1fr)`;
    this.gridEl.style.setProperty('--cell-font-size', `${this.fontSize}px`);

    // Mouse handlers on grid element
    this.gridEl.addEventListener('mousedown', (e) => {
      const cellEl = e.target.closest('.paint-cell');
      if (!cellEl) return;
      e.preventDefault(); // Prevents selection / drag artifacts
      const x = parseInt(cellEl.dataset.x, 10);
      const y = parseInt(cellEl.dataset.y, 10);

      this.isMouseDown = true;
      this.saveSnapshot(); // Save snapshot once at the start of the mouse stroke
      const oldX = this.cursorX;
      const oldY = this.cursorY;
      this.cursorX = x;
      this.cursorY = y;

      const isRightClick = e.button === 2 || e.buttons === 2;
      this.applyAction(x, y, isRightClick);
      this.updateCellDOM(oldX, oldY);
      this.updateCellDOM(x, y);
      this.drawHeader();
    });

    this.gridEl.addEventListener('mouseover', (e) => {
      const cellEl = e.target.closest('.paint-cell');
      if (!cellEl) return;
      const x = parseInt(cellEl.dataset.x, 10);
      const y = parseInt(cellEl.dataset.y, 10);

      const oldX = this.cursorX;
      const oldY = this.cursorY;
      this.cursorX = x;
      this.cursorY = y;

      if (this.isMouseDown) {
        const isRightClick = e.button === 2 || e.buttons === 2;
        if (this.lastMousePos.x !== -1 && (Math.abs(this.lastMousePos.x - x) > 1 || Math.abs(this.lastMousePos.y - y) > 1)) {
          const points = this.getLinePoints(this.lastMousePos.x, this.lastMousePos.y, x, y);
          for (const p of points) {
            this.applyAction(p.x, p.y, isRightClick);
            this.updateCellDOM(p.x, p.y);
          }
        } else {
          this.applyAction(x, y, isRightClick);
        }
      }
      this.updateCellDOM(oldX, oldY);
      this.updateCellDOM(x, y);
      this.drawHeader();
    });

    // Event delegation on toolbar wrapper element to avoid inline onclick globals
    this.toolbarEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.paint-option-btn');
      if (!btn) return;
      if (btn.dataset.tool) {
        this.selectTool(btn.dataset.tool);
      } else if (btn.dataset.block) {
        this.selectBlock(btn.dataset.block);
      } else if (btn.dataset.color) {
        this.selectColor(btn.dataset.color);
      } else if (btn.dataset.bg) {
        this.selectBgColor(btn.dataset.bg);
      }
    });
  }

  getLinePoints(x0, y0, x1, y1) {
    const points = [];
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = (x0 < x1) ? 1 : -1;
    const sy = (y0 < y1) ? 1 : -1;
    let err = dx - dy;

    let x = x0;
    let y = y0;

    while (true) {
      points.push({ x, y });
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }
    }
    return points;
  }

  applyAction(x, y, isRightClick = false) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
    this.lastMousePos = { x, y };

    const actualTool = isRightClick ? 'eraser' : this.activeTool;

    if (actualTool === 'pencil') {
      this.cells[y][x].char = this.activeChar;
      this.cells[y][x].color = this.isColorSupported ? this.activeColor : 'white';
      this.cells[y][x].background = this.isColorSupported ? this.activeBgColor : 'none';
      this.isModified = true;
      audio.playKeyclick(this.activeChar);
    } else if (actualTool === 'eraser') {
      this.cells[y][x].char = ' ';
      this.cells[y][x].color = 'white';
      this.cells[y][x].background = 'none';
      this.isModified = true;
      audio.playKeyclick(' ');
    } else if (actualTool === 'bucket') {
      const targetChar = this.cells[y][x].char;
      const targetColor = this.cells[y][x].color;
      const targetBg = this.cells[y][x].background;

      if (targetChar === this.activeChar && 
          targetColor === (this.isColorSupported ? this.activeColor : 'white') &&
          targetBg === (this.isColorSupported ? this.activeBgColor : 'none')) {
        return;
      }

      this.floodFill(x, y, targetChar, targetColor, targetBg);
      this.isModified = true;
      this.drawFullGrid();
      audio.playMelody([
        { f: 400, dur: 0.05, delay: 0 },
        { f: 600, dur: 0.1, delay: 0.05 }
      ], 'sine', 0.1);
    }
  }

  floodFill(startX, startY, targetChar, targetColor, targetBg) {
    const queue = [[startX, startY]];
    const visited = new Uint8Array(this.width * this.height);

    let head = 0;
    while (head < queue.length) {
      const [x, y] = queue[head++];
      if (x < 0 || x >= this.width || y < 0 || y >= this.height) continue;

      const idx = y * this.width + x;
      if (visited[idx]) continue;
      visited[idx] = 1;

      const cell = this.cells[y][x];
      if (cell.char === targetChar && cell.color === targetColor && cell.background === targetBg) {
        cell.char = this.activeChar;
        cell.color = this.isColorSupported ? this.activeColor : 'white';
        cell.background = this.isColorSupported ? this.activeBgColor : 'none';

        if (x + 1 < this.width) queue.push([x + 1, y]);
        if (x - 1 >= 0) queue.push([x - 1, y]);
        if (y + 1 < this.height) queue.push([x, y + 1]);
        if (y - 1 >= 0) queue.push([x, y - 1]);
      }
    }
  }

  drawAll() {
    this.drawHeader();
    this.initializeGridDOM();
    this.initializeToolbarDOM();
    this.drawToolbar();
  }

  initializeGridDOM() {
    this.gridEl.innerHTML = '';
    this.cellDOMs = [];
    const fragment = document.createDocumentFragment();

    for (let y = 0; y < this.height; y++) {
      const rowDOMs = [];
      for (let x = 0; x < this.width; x++) {
        const cell = this.cells[y][x];
        const isCursor = (x === this.cursorX && y === this.cursorY);
        const cursorClass = isCursor ? 'paint-cursor' : '';
        const colorClass = this.isColorSupported ? cell.color : 'white';
        const bgClass = this.isColorSupported ? cell.background : 'none';

        const cellEl = document.createElement('div');
        cellEl.className = `paint-cell ${cursorClass}`;
        if (colorClass) {
          colorClass.split(' ').forEach(cls => cellEl.classList.add(cls));
        }
        if (bgClass && bgClass !== 'none') {
          bgClass.split(' ').forEach(cls => cellEl.classList.add(cls));
        }
        cellEl.dataset.x = x;
        cellEl.dataset.y = y;
        cellEl.textContent = cell.char;

        fragment.appendChild(cellEl);
        rowDOMs.push(cellEl);
      }
      this.cellDOMs.push(rowDOMs);
    }
    this.gridEl.appendChild(fragment);
  }

  drawFullGrid() {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        this.updateCellDOM(x, y);
      }
    }
  }

  updateCellDOM(x, y) {
    const row = this.cells[y];
    if (!row) return;
    const cell = row[x];
    if (!cell) return;
    const el = this.cellDOMs[y]?.[x];
    if (!el) return;

    const isCursor = (x === this.cursorX && y === this.cursorY);
    const classes = ['paint-cell'];
    if (isCursor) classes.push('paint-cursor');
    
    const colorClass = this.isColorSupported ? cell.color : 'white';
    if (colorClass) {
      colorClass.split(' ').forEach(cls => classes.push(cls));
    }

    const bgClass = this.isColorSupported ? cell.background : 'none';
    if (bgClass && bgClass !== 'none') {
      bgClass.split(' ').forEach(cls => classes.push(cls));
    }

    const expectedClass = classes.join(' ');
    if (el.className !== expectedClass) {
      el.className = expectedClass;
    }

    const expectedChar = cell.char;
    if (el.textContent !== expectedChar) {
      el.textContent = expectedChar;
    }
  }

  drawHeader() {
    const modStr = this.isModified ? '*' : '';
    const statusText = this.statusMessage || `Paint - ${this.filename}${modStr} [${this.width}x${this.height}]`;
    const lockStr = this.autoDraw ? '[AUTODRAW ON]' : '';
    this.statusEl.innerHTML = `
      <span>${statusText}</span>
      <span style="color: var(--accent-color); font-weight: bold; margin-left: 20px;">${lockStr}</span>
      <span>Col ${this.cursorX + 1}, Row ${this.cursorY + 1}</span>
    `;
  }

  initializeToolbarDOM() {
    let toolsHtml = '';
    const tools = ['pencil', 'eraser', 'bucket'];
    for (const t of tools) {
      toolsHtml += `<span class="paint-option-btn" id="tool-btn-${t}" data-tool="${t}"></span>`;
    }

    let blocksHtml = '';
    for (let i = 0; i < this.blocks.length; i++) {
      const b = this.blocks[i];
      blocksHtml += `<span class="paint-option-btn" id="block-btn-${i}" data-block="${b}"></span>`;
    }

    let colorsRowHtml = '';
    let bgColorsRowHtml = '';
    if (this.isColorSupported) {
      // Foreground Colors
      let colorsHtml = '';
      for (const c of this.brushColors) {
        const id = c.replace(' ', '-');
        const isDim = c.includes('color-dim');
        const opacityStyle = isDim ? '; opacity: 0.6;' : '';
        colorsHtml += `<span class="paint-option-btn" id="color-btn-${id}" style="color: ${this.getColorStyle(c)}${opacityStyle}" data-color="${c}"></span>`;
      }
      colorsRowHtml = `
        <div class="paint-toolbar-row">
          <span class="paint-label">BRUSH COLOR:</span>
          <div class="paint-options">${colorsHtml}</div>
        </div>
      `;

      // Background Colors
      let bgHtml = '';
      for (const bg of this.bgColors) {
        const id = bg.replace(' ', '-');
        const isDim = bg.includes('color-dim');
        const opacityStyle = isDim ? '; opacity: 0.6;' : '';
        const colorHex = bg === 'none' ? 'inherit' : this.getColorStyle(bg.replace('bg-', ''));
        bgHtml += `<span class="paint-option-btn" id="bg-btn-${id}" style="color: ${colorHex}${opacityStyle}" data-bg="${bg}"></span>`;
      }
      bgColorsRowHtml = `
        <div class="paint-toolbar-row">
          <span class="paint-label">BACKGROUND:</span>
          <div class="paint-options">${bgHtml}</div>
        </div>
      `;
    }

    this.toolbarEl.innerHTML = `
      <div class="paint-toolbar-row">
        <span class="paint-label">TOOL:</span>
        <div class="paint-options">${toolsHtml}</div>
      </div>
      <div class="paint-toolbar-row">
        <span class="paint-label">BLOCKS:</span>
        <div class="paint-options">${blocksHtml}</div>
      </div>
      ${colorsRowHtml}
      ${bgColorsRowHtml}
    `;

    for (const t of tools) {
      this.toolDOMs[t] = this.container.querySelector(`#tool-btn-${t}`);
    }
    for (let i = 0; i < this.blocks.length; i++) {
      this.blockDOMs[i] = this.container.querySelector(`#block-btn-${i}`);
    }
    if (this.isColorSupported) {
      for (const c of this.brushColors) {
        const id = c.replace(' ', '-');
        this.colorDOMs[c] = this.container.querySelector(`#color-btn-${id}`);
      }
      for (const bg of this.bgColors) {
        const id = bg.replace(' ', '-');
        this.bgColorDOMs[bg] = this.container.querySelector(`#bg-btn-${id}`);
      }
    }
  }

  drawToolbar() {
    const tools = ['pencil', 'eraser', 'bucket'];
    for (const t of tools) {
      const el = this.toolDOMs[t];
      if (!el) continue;
      const isActive = this.activeTool === t;
      const displayLabel = isActive ? `[${t.toUpperCase()}]` : t;

      if (el.textContent !== displayLabel) {
        el.textContent = displayLabel;
      }
      if (el.classList.contains('active') !== isActive) {
        el.classList.toggle('active', isActive);
      }
    }

    for (let i = 0; i < this.blocks.length; i++) {
      const b = this.blocks[i];
      const el = this.blockDOMs[i];
      if (!el) continue;
      const isActive = this.activeChar === b;
      const displayLabel = isActive ? `[${i+1}:${b}]` : `${i+1}:${b}`;

      if (el.textContent !== displayLabel) {
        el.textContent = displayLabel;
      }
      if (el.classList.contains('active') !== isActive) {
        el.classList.toggle('active', isActive);
      }
    }

    if (this.isColorSupported) {
      for (const c of this.brushColors) {
        const el = this.colorDOMs[c];
        if (!el) continue;
        const isActive = this.activeColor === c;
        const formattedName = c.replace(' color-dim', ' (dim)');
        const displayLabel = isActive ? `[${formattedName}]` : formattedName;

        if (el.textContent !== displayLabel) {
          el.textContent = displayLabel;
        }
        if (el.classList.contains('active') !== isActive) {
          el.classList.toggle('active', isActive);
        }
      }

      for (const bg of this.bgColors) {
        const el = this.bgColorDOMs[bg];
        if (!el) continue;
        const isActive = this.activeBgColor === bg;
        const formattedName = bg === 'none' ? 'none' : bg.replace('bg-', '').replace(' color-dim', ' (dim)');
        const displayLabel = isActive ? `[${formattedName}]` : formattedName;

        if (el.textContent !== displayLabel) {
          el.textContent = displayLabel;
        }
        if (el.classList.contains('active') !== isActive) {
          el.classList.toggle('active', isActive);
        }
      }
    }
  }

  getColorStyle(colorClass) {
    const baseColor = colorClass.split(' ')[0];
    const colors = {
      white: '#ffffff',
      red: '#ff1100',
      green: '#7ee787',
      yellow: '#d29922',
      blue: '#58a6ff',
      magenta: '#d859c7',
      cyan: '#39c5cf',
      'color-dim': '#8b949e'
    };
    return colors[baseColor] || 'inherit';
  }

  selectTool(t) {
    this.activeTool = t;
    audio.playKeyclick('t');
    this.drawToolbar();
  }

  selectBlock(b) {
    this.activeChar = b;
    if (this.activeTool === 'eraser') {
      this.activeTool = 'pencil';
    }
    audio.playKeyclick('b');
    this.drawToolbar();
  }

  selectColor(c) {
    this.activeColor = c;
    audio.playKeyclick('c');
    this.drawToolbar();
  }

  selectBgColor(bg) {
    this.activeBgColor = bg;
    audio.playKeyclick('c');
    this.drawToolbar();
  }

  handleKeydown(e) {
    const key = e.key;

    if ((e.ctrlKey || e.metaKey) && key.toLowerCase() === 's') {
      e.preventDefault();
      this.saveFile();
      return;
    }

    if (key >= '1' && key <= '6') {
      e.preventDefault();
      this.activeChar = this.blocks[parseInt(key, 10) - 1];
      if (this.activeTool === 'eraser') {
        this.activeTool = 'pencil';
      }
      audio.playKeyclick(key);
      this.drawToolbar();
      return;
    }

    if (key === '0') {
      e.preventDefault();
      this.activeTool = 'eraser';
      audio.playKeyclick('0');
      this.drawToolbar();
      return;
    }

    if (key === 'Enter') {
      e.preventDefault();
      this.autoDraw = !this.autoDraw;
      if (this.autoDraw) {
        this.saveSnapshot();
        this.applyAction(this.cursorX, this.cursorY);
      }
      audio.playKeyclick('\n');
      this.drawHeader();
      this.updateCellDOM(this.cursorX, this.cursorY);
      return;
    }

    if (key === ' ') {
      e.preventDefault();
      this.saveSnapshot();
      this.applyAction(this.cursorX, this.cursorY);
      this.updateCellDOM(this.cursorX, this.cursorY);
      return;
    }

    if (key === 'Backspace') {
      e.preventDefault();
      this.saveSnapshot();
      this.cells[this.cursorY][this.cursorX].char = ' ';
      this.cells[this.cursorY][this.cursorX].color = 'white';
      this.cells[this.cursorY][this.cursorX].background = 'none';
      this.isModified = true;
      audio.playKeyclick('Backspace');
      this.updateCellDOM(this.cursorX, this.cursorY);
      return;
    }

    if (key === 'c') {
      if (this.isColorSupported) {
        e.preventDefault();
        const idx = this.brushColors.indexOf(this.activeColor);
        this.activeColor = this.brushColors[(idx + 1) % this.brushColors.length];
        audio.playKeyclick('c');
        this.drawToolbar();
      }
      return;
    }

    if (key === 'v') {
      if (this.isColorSupported) {
        e.preventDefault();
        const idx = this.bgColors.indexOf(this.activeBgColor);
        this.activeBgColor = this.bgColors[(idx + 1) % this.bgColors.length];
        audio.playKeyclick('v');
        this.drawToolbar();
      }
      return;
    }

    if (key === 't') {
      e.preventDefault();
      const tools = ['pencil', 'eraser', 'bucket'];
      const idx = tools.indexOf(this.activeTool);
      this.activeTool = tools[(idx + 1) % tools.length];
      audio.playKeyclick('t');
      this.drawToolbar();
      return;
    }

    if (key === '+' || key === '=') {
      e.preventDefault();
      if (this.fontSize < 36) {
        this.fontSize += 2;
        this.gridEl.style.setProperty('--cell-font-size', `${this.fontSize}px`);
        audio.playKeyclick('+');
      }
      return;
    }
    if (key === '-') {
      e.preventDefault();
      if (this.fontSize > 8) {
        this.fontSize -= 2;
        this.gridEl.style.setProperty('--cell-font-size', `${this.fontSize}px`);
        audio.playKeyclick('-');
      }
      return;
    }

    if (key === 'u') {
      e.preventDefault();
      this.undo();
      return;
    }
    if (key === 'r') {
      e.preventDefault();
      this.redo();
      return;
    }

    if (key === 'q') {
      e.preventDefault();
      this.confirmExit();
      return;
    }

    let dx = 0;
    let dy = 0;
    if (key === 'ArrowUp' || key === 'w' || key === 'W') {
      dy = -1;
    } else if (key === 'ArrowDown' || key === 's' || key === 'S') {
      dy = 1;
    } else if (key === 'ArrowLeft' || key === 'a' || key === 'A') {
      dx = -1;
    } else if (key === 'ArrowRight' || key === 'd' || key === 'D') {
      dx = 1;
    }

    if (dx !== 0 || dy !== 0) {
      e.preventDefault();
      const oldX = this.cursorX;
      const oldY = this.cursorY;
      this.cursorX = Math.max(0, Math.min(this.width - 1, this.cursorX + dx));
      this.cursorY = Math.max(0, Math.min(this.height - 1, this.cursorY + dy));

      if (this.autoDraw || e.shiftKey) {
        this.saveSnapshot();
        this.applyAction(oldX, oldY);
        this.applyAction(this.cursorX, this.cursorY);
      } else {
        audio.playKeyclick('Arrow');
      }

      this.updateCellDOM(oldX, oldY);
      this.updateCellDOM(this.cursorX, this.cursorY);
      this.drawHeader();
      return;
    }

    if (key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      this.activeChar = key;
      this.activeTool = 'pencil';
      audio.playKeyclick(key);
      this.showStatus(`Brush character set to: '${key}'`);
      this.drawToolbar();
    }
  }

  saveFile() {
    let content = '';
    const isArtFile = this.filename.endsWith('.art');

    if (isArtFile) {
      const data = {
        width: this.width,
        height: this.height,
        cells: []
      };
      for (let y = 0; y < this.height; y++) {
        for (let x = 0; x < this.width; x++) {
          data.cells.push(this.cells[y][x]);
        }
      }
      content = JSON.stringify(data, null, 2);
    } else {
      const lines = [];
      for (let y = 0; y < this.height; y++) {
        let line = '';
        for (let x = 0; x < this.width; x++) {
          line += this.cells[y][x].char;
        }
        lines.push(line.replace(/\s+$/, ''));
      }
      content = lines.join('\n');
    }

    const saveResult = this.onSave(content);
    if (saveResult === true) {
      this.isModified = false;
      this.showStatus(`Wrote ${this.filename} successfully`);
      audio.playMelody([
        { f: 523.25, dur: 0.05, delay: 0 },
        { f: 659.25, dur: 0.05, delay: 0.05 },
        { f: 783.99, dur: 0.1, delay: 0.1 }
      ], 'triangle', 0.1);
    } else {
      this.showStatus(`Error saving: ${saveResult}`);
    }
  }

  confirmExit() {
    if (this.isModified) {
      const confirmExit = confirm('You have unsaved changes. Are you sure you want to quit?');
      if (!confirmExit) return;
    }
    audio.playKeyclick('q');
    this.cleanup();
    this.onExit();
  }
}
