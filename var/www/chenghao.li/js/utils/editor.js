export class BaseEditor {
  constructor(shell, filename, initialContent, resolvedPath, onSave, onExit, isNewFile = false) {
    this.shell = shell;
    this.filename = filename;
    this.content = initialContent;
    this.resolvedPath = resolvedPath;
    this.onSave = onSave;
    this.onExit = onExit;
    this.isNewFile = isNewFile;
    this.isModified = false;

    this.container = null;
    this.textarea = null;
    this.maxVisibleLines = null;
    this.scrollTopLine = 0;

    this.originalState = this.shell.loginState;
    this.shell.loginState = 'GAME'; // Bypass shell typing listener

    this.resizeObserver = null;
  }

  initDOM(editorClassName) {
    // Hide terminal output & input line
    this.shell.output.style.display = 'none';
    this.shell.inputLine.classList.add('hidden-input-line');

    // Prevent terminal body from scrolling
    this.shell.body.style.overflowY = 'hidden';

    // Create editor container
    this.container = document.createElement('div');
    this.container.className = `terminal-editor ${editorClassName}`;
    this.container.style.display = 'flex';
    this.container.style.flexDirection = 'column';
    this.container.style.width = '100%';
    this.container.style.height = '100%';

    // Create hidden textarea
    this.textarea = document.createElement('textarea');
    this.textarea.style.position = 'absolute';
    this.textarea.style.left = '0';
    this.textarea.style.top = '0';
    this.textarea.style.opacity = '0';
    this.textarea.style.width = '100%';
    this.textarea.style.height = '100%';
    this.textarea.style.pointerEvents = 'none';
    this.textarea.style.zIndex = '-1';
    this.textarea.spellcheck = false;
    this.textarea.autocomplete = 'off';
    this.textarea.value = this.content;

    this.shell.body.appendChild(this.container);
    this.shell.body.appendChild(this.textarea);

    // Focus on click
    this.container.addEventListener('click', () => {
      this.textarea.focus();
    });

    this.textarea.focus();
    this.textarea.selectionStart = 0;
    this.textarea.selectionEnd = 0;
  }

  start(contentSelector, lineSelector, lineInnerHtml) {
    this.contentSelector = contentSelector;
    this.lineSelector = lineSelector;
    this.lineInnerHtml = lineInnerHtml;

    this.measureLayout();
    this.draw();

    this.textarea.addEventListener('input', () => {
      this.draw();
    });

    this.textarea.addEventListener('keydown', (e) => {
      this.handleKeydown(e);
    });

    this.resizeObserver = new ResizeObserver(() => {
      this.measureLayout();
      this.draw();
    });
    if (this.container) {
      this.resizeObserver.observe(this.container);
    }
  }

  cleanup() {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    if (this.container) this.container.remove();
    if (this.textarea) this.textarea.remove();

    this.shell.output.style.display = 'flex';
    this.shell.inputLine.classList.remove('hidden-input-line');
    this.shell.body.style.overflowY = '';
    this.shell.loginState = this.originalState;
    this.shell.updatePrompt();
    this.shell.focus();
  }

  measureLayout() {
    if (!this.contentSelector) return;
    const contentEl = this.container ? this.container.querySelector(this.contentSelector) : null;
    if (contentEl) {
      const rect = contentEl.getBoundingClientRect();
      let testLine = contentEl.querySelector(this.lineSelector);
      let createdTestLine = false;
      if (!testLine) {
        testLine = document.createElement('div');
        testLine.className = this.lineSelector.replace(/^\./, '');
        testLine.innerHTML = this.lineInnerHtml;
        contentEl.appendChild(testLine);
        createdTestLine = true;
      }
      const lineHeight = testLine.getBoundingClientRect().height;
      if (createdTestLine) {
        testLine.remove();
      }
      if (rect.height > 0 && lineHeight > 0) {
        this.maxVisibleLines = Math.floor((rect.height - 10) / (lineHeight + 1));
      }
    }
    if (!this.maxVisibleLines || this.maxVisibleLines <= 0) {
      this.maxVisibleLines = this.lineSelector.includes('vim') ? 24 : 20;
    }
  }

  adjustScroll(curLine) {
    const maxVisibleLines = this.maxVisibleLines || 20;
    const { totalLines } = this.getLinesAndCursor();
    if (curLine < this.scrollTopLine) {
      this.scrollTopLine = curLine;
    } else if (curLine >= this.scrollTopLine + maxVisibleLines) {
      this.scrollTopLine = curLine - maxVisibleLines + 1;
    }
    if (this.scrollTopLine + maxVisibleLines > totalLines) {
      this.scrollTopLine = Math.max(0, totalLines - maxVisibleLines);
    }
  }

  // Get raw lines, cursor indices, and offsets
  getLinesAndCursor() {
    const text = this.textarea.value;
    const selStart = this.textarea.selectionStart;
    const selEnd = this.textarea.selectionEnd;

    let rawLines = text.split('\n');
    if (rawLines.length > 1 && rawLines[rawLines.length - 1] === '' && selStart < text.length) {
      rawLines.pop();
    }
    let curLine = 0;
    let curCol = 0;

    // Find the cursor line and column based on selectionStart (active typing cursor)
    let currentIdx = 0;
    for (let i = 0; i < rawLines.length; i++) {
      const lineLen = rawLines[i].length;
      if (selStart >= currentIdx && selStart <= currentIdx + lineLen) {
        curLine = i;
        curCol = selStart - currentIdx;
        break;
      }
      currentIdx += lineLen + 1; // +1 for \n
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

  // Escape a single line and inject cursor highlight
  escapeLine(lineStr, lineStartIdx, selStart) {
    const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const lineEndIdx = lineStartIdx + lineStr.length;

    if (selStart >= lineStartIdx && selStart <= lineEndIdx) {
      const curCol = selStart - lineStartIdx;
      const before = lineStr.slice(0, curCol);
      const charAtCursor = lineStr.slice(curCol, curCol + 1) || ' ';
      const after = lineStr.slice(curCol + 1);
      return escape(before) + `<span class="terminal-cursor">${escape(charAtCursor)}</span>` + escape(after);
    }
    return escape(lineStr);
  }
}

export async function runEditor(EditorClass, args, cmdName, shell) {
  let fileArg = args[0].trim();
  while (fileArg.endsWith('/') && fileArg.length > 1) {
    fileArg = fileArg.slice(0, -1);
  }
  let resolved = shell.fileSystem.resolvePath(shell.currentPath, fileArg);
  let initialContent = '';
  let isNewFile = false;

  if (resolved === null) {
    const parentAndName = shell.fileSystem.resolveParentAndName(shell.currentPath, fileArg);
    if (parentAndName === null) {
      shell.print(`${cmdName}: cannot open '${fileArg}': No such file or directory`, 'color-error');
      return;
    }
    resolved = [...parentAndName.resolvedParent, parentAndName.name];
    isNewFile = true;
  } else {
    const node = shell.fileSystem.getNodeByPath(resolved);
    if (node && typeof node === 'object') {
      shell.print(`${cmdName}: '${fileArg}' is a directory`, 'color-error');
      return;
    }
    try {
      initialContent = await shell.fileSystem.readFile(resolved);
    } catch (err) {
      shell.print(`${cmdName}: error reading '${fileArg}': ${err.message}`, 'color-error');
      return;
    }
  }

  return new Promise((resolve) => {
    let editor = null;
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

    try {
      editor = new EditorClass(shell, fileArg, initialContent, resolved, onSave, onExit, isNewFile);
      editor.start();
    } catch (err) {
      if (editor && typeof editor.cleanup === 'function') {
        editor.cleanup();
      } else {
        shell.loginState = 'LOGGED_IN';
        shell.updatePrompt();
        shell.focus();
      }
      shell.print(`${cmdName}: editor failed: ${err.message}`, 'color-error');
      resolve();
    }
  });
}
