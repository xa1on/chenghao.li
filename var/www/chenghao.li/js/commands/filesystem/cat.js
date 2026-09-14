export const cat = {
  name: 'cat',
  description: 'Display the contents of one or more text files, or render colored ASCII art.',
  category: 'filesystem',
  args: [
    { name: 'filename', description: 'The text file to display, or .art file to render.', required: true }
  ],
  run: async (args, shell) => {
    if (args.length === 0) {
      shell.print('cat: missing file operand', 'color-error');
      return 1;
    }

    let overallStatus = 0;

    for (const fileArg of args) {
      const resolved = shell.fileSystem.resolvePath(shell.currentPath, fileArg);
      if (resolved === null) {
        shell.print(`cat: ${fileArg}: No such file or directory`, 'color-error');
        overallStatus = 1;
        continue;
      }
      const targetNode = shell.fileSystem.getNodeByPath(resolved);
      if (targetNode === null) {
        shell.print(`cat: ${fileArg}: No such file or directory`, 'color-error');
        overallStatus = 1;
        continue;
      }
      if (typeof targetNode === 'object') {
        shell.print(`cat: ${fileArg}: Is a directory`, 'color-error');
        overallStatus = 1;
        continue;
      }

      const fileName = resolved[resolved.length - 1];
      const lowerName = fileName.toLowerCase();
      const isImage = lowerName.endsWith('.png') ||
        lowerName.endsWith('.jpg') ||
        lowerName.endsWith('.jpeg') ||
        lowerName.endsWith('.gif') ||
        lowerName.endsWith('.webp') ||
        lowerName.endsWith('.svg') ||
        lowerName.endsWith('.ico');

      if (isImage) {
        const hash = shell.fileSystem.isBuiltInPath(resolved) ? shell.fileSystem.getNodeByPath(resolved) : '';
        const filePath = '/' + resolved.join('/') + (typeof hash === 'string' && hash && hash !== 'core' ? '?v=' + hash : '');
        shell.print(`<img src="${filePath}" class="terminal-image" alt="${shell.escapeHTML(fileName)}">`);
        continue;
      }

      // Render colored ASCII art files directly to the terminal
      if (lowerName.endsWith('.art')) {
        try {
          const content = await shell.fileSystem.readFile(resolved);
          const data = JSON.parse(content);
          if (data && typeof data.width === 'number' && typeof data.height === 'number' && Array.isArray(data.cells)) {
            let html = '<pre style="font-family: \'Fira Code\', monospace; line-height: 1.2; letter-spacing: 0; font-size: 14px; margin: 10px 0; white-space: pre; overflow-x: auto; border: none; background: transparent; padding: 0;">';
            let idx = 0;
            for (let y = 0; y < data.height; y++) {
              let currentClass = null;
              let currentSpanText = '';

              const flushSpan = () => {
                if (currentSpanText) {
                  html += `<span class="${currentClass}">${currentSpanText}</span>`;
                  currentSpanText = '';
                }
              };

              for (let x = 0; x < data.width; x++) {
                if (idx < data.cells.length) {
                  const cell = data.cells[idx++] || {};
                  const char = cell.char !== undefined ? cell.char : ' ';
                  const colorClass = cell.color || cell.fg || 'white';
                  const bgClass = cell.background || cell.bg || 'none';
                  const bgClasses = bgClass !== 'none' ? ' ' + bgClass : '';
                  const fullClass = `${colorClass}${bgClasses}`;

                  if (fullClass !== currentClass) {
                    flushSpan();
                    currentClass = fullClass;
                  }
                  currentSpanText += shell.escapeHTML(char);
                }
              }
              flushSpan();
              if (y < data.height - 1) {
                html += '\n';
              }
            }
            html += '</pre>';
            shell.print(html);
            continue;
          }
        } catch (e) {
          // Fallback to plain text if parsing fails
        }
      }

      try {
        const content = await shell.fileSystem.readFile(resolved);
        const output = fileName.endsWith('.md') ? shell.parseMarkdown(content, resolved.slice(0, -1)) : shell.escapeHTML(content);
        shell.print(output);
      } catch (err) {
        shell.print(`cat: error reading ${fileArg}: ${err.message}`, 'color-error');
        overallStatus = 1;
      }
    }

    return overallStatus;
  }
};
