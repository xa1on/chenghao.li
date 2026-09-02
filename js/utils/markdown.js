import { resolvePath, getNodeByPath } from '../fs.js?v=99f0c1d3f5';

export function escapeHTML(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const ALLOWED_CLASSES = [
  'blue',
  'red',
  'green',
  'yellow',
  'cyan',
  'magenta',
  'white',
  'color-text',
  'color-dir',
  'color-file',
  'color-link',
  'color-error',
  'color-accent',
  'color-dim',
  'blue-color',
  'green-color',
  'red-color',
  'yellow-color',
  'cyan-color',
  'magenta-color',
  'white-color'
];

export function sanitizeHTML(str) {
  let escaped = escapeHTML(str);

  // Restore allowed span tags
  escaped = escaped.replace(/&lt;span class=&quot;([a-zA-Z\-]+)&quot;&gt;/g, (match, className) => {
    if (ALLOWED_CLASSES.includes(className)) {
      return `<span class="${className}">`;
    }
    return match;
  });

  // Restore closing span tags
  escaped = escaped.replace(/&lt;\/span&gt;/g, '</span>');

  return escaped;
}

const getVisibleLength = (htmlStr) => {
  const plainText = htmlStr.replace(/<[^>]*>/g, '');
  const unescaped = plainText
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'");
  return unescaped.length;
};

const parseInline = (line, vfs = {}, basePathArr = []) => {
  const sanitized = sanitizeHTML(line);

  // 1. Extract inline code spans first so inner characters (like * or _) are not parsed as markdown
  const codeTokens = [];
  let processed = sanitized.replace(/\`([^\`]+)\`/g, (match, codeContent) => {
    const placeholder = `__CODE_TOKEN_${codeTokens.length}__`;
    codeTokens.push(`<span class="color-accent">${codeContent}</span>`);
    return placeholder;
  });

  // 2. Links
  processed = processed.replace(/\[(.*?)\]\((.*?)\)/g, (match, text, href) => {
    const cleanHref = href.trim();
    if (/^javascript:/i.test(cleanHref)) {
      return `<span class="color-text" title="Blocked: javascript link">${text}</span>`;
    }

    const isAbsoluteUrl = /^(https?:\/\/|mailto:|tel:|#)/i.test(cleanHref);
    if (!isAbsoluteUrl) {
      const resolved = resolvePath(vfs, basePathArr, cleanHref);
      if (resolved !== null) {
        const node = getNodeByPath(vfs, resolved);
        const type = typeof node === 'object' ? 'dir' : 'file';
        const absolutePath = '/' + resolved.join('/');
        return `<span class="color-link ls-item" data-type="${type}" data-path="${absolutePath}">${text}</span>`;
      }
    }

    return `<a href="${cleanHref}" class="color-link" target="_blank">${text}</a>`;
  });

  // 3. Bold formatting
  processed = processed.replace(/\*\*(.*?)\*\*/g, '<span class="color-accent">$1</span>');

  // 4. Restore inline code spans
  for (let i = 0; i < codeTokens.length; i++) {
    processed = processed.replace(`__CODE_TOKEN_${i}__`, codeTokens[i]);
  }

  return processed;
};

function renderTextTable(tableLines, vfs = {}, basePathArr = []) {
  if (tableLines.length < 2) {
    return tableLines.map(line => `<div>${parseInline(line, vfs, basePathArr)}</div>`).join('\n');
  }

  const parseRow = (rowStr) => {
    let cells = rowStr.trim().split('|');
    if (cells[0] === '') cells.shift();
    if (cells[cells.length - 1] === '') cells.pop();
    return cells.map(c => c.trim());
  };

  const headerLine = tableLines[0];
  const separatorLine = tableLines[1];
  const dataLines = tableLines.slice(2);

  const separatorCells = parseRow(separatorLine);
  const isValidSeparator = separatorCells.every(cell => /^[:\-\s]+$/.test(cell));
  if (!isValidSeparator) {
    return tableLines.map(line => `<div>${parseInline(line, vfs, basePathArr)}</div>`).join('\n');
  }

  const alignments = separatorCells.map(cell => {
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    return 'left';
  });

  const headerCells = parseRow(headerLine);
  const allRows = [headerCells];
  for (const row of dataLines) {
    allRows.push(parseRow(row));
  }

  let maxCols = alignments.length;
  for (const row of allRows) {
    if (row.length > maxCols) maxCols = row.length;
  }

  // Calculate widths after parseInline so we align based on visible text length, caching the visible length
  const parsedRows = allRows.map(row => {
    const parsedRow = [];
    for (let c = 0; c < maxCols; c++) {
      const htmlText = c < row.length ? parseInline(row[c], vfs, basePathArr) : '';
      parsedRow.push({
        htmlText,
        visibleLength: getVisibleLength(htmlText)
      });
    }
    return parsedRow;
  });

  const colWidths = Array(maxCols).fill(0);
  for (const row of parsedRows) {
    for (let c = 0; c < maxCols; c++) {
      const cell = row[c];
      if (cell.visibleLength > colWidths[c]) {
        colWidths[c] = cell.visibleLength;
      }
    }
  }

  const padCell = (cell, width, align) => {
    const rawLen = cell.visibleLength;
    const htmlText = cell.htmlText;
    if (rawLen >= width) return htmlText;

    const extra = width - rawLen;
    if (align === 'center') {
      const left = Math.floor(extra / 2);
      const right = extra - left;
      return ' '.repeat(left) + htmlText + ' '.repeat(right);
    } else if (align === 'right') {
      return ' '.repeat(extra) + htmlText;
    } else {
      return htmlText + ' '.repeat(extra);
    }
  };

  const spacing = '  ';
  let outputRows = [];

  // 1. Format Header
  const headerParts = [];
  for (let c = 0; c < maxCols; c++) {
    headerParts.push(padCell(parsedRows[0][c], colWidths[c], alignments[c] || 'left'));
  }
  outputRows.push(`<span class="color-accent">${headerParts.join(spacing)}</span>`);

  // 2. Format Separator Row (dashes)
  const sepParts = [];
  for (let c = 0; c < maxCols; c++) {
    sepParts.push('-'.repeat(colWidths[c]));
  }
  outputRows.push(`<span class="color-dim">${sepParts.join(spacing)}</span>`);

  // 3. Format Data Rows
  for (let r = 1; r < parsedRows.length; r++) {
    const rowParts = [];
    for (let c = 0; c < maxCols; c++) {
      rowParts.push(padCell(parsedRows[r][c], colWidths[c], alignments[c] || 'left'));
    }
    outputRows.push(rowParts.join(spacing));
  }

  return `<pre class="markdown-table-text">${outputRows.join('\n')}</pre>`;
}

export function parseMarkdown(text, vfs = {}, basePathArr = []) {
  if (typeof text !== 'string') return '';

  const lines = text.split('\n');
  const blocks = [];
  let currentBlock = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // 1. Inside a code block
    if (currentBlock && currentBlock.type === 'code') {
      if (trimmed.startsWith('```')) {
        blocks.push(currentBlock);
        currentBlock = null;
      } else {
        currentBlock.lines.push(line);
      }
      continue;
    }

    // Code block start
    if (trimmed.startsWith('```')) {
      if (currentBlock) blocks.push(currentBlock);
      currentBlock = {
        type: 'code',
        lang: trimmed.slice(3).trim(),
        lines: []
      };
      continue;
    }

    // 2. Inside a table block (consecutive rows starting and ending with pipe)
    const isTableRow = trimmed.startsWith('|') && trimmed.endsWith('|');
    if (isTableRow) {
      if (currentBlock && currentBlock.type !== 'table') {
        blocks.push(currentBlock);
        currentBlock = null;
      }
      if (!currentBlock) {
        currentBlock = {
          type: 'table',
          lines: []
        };
      }
      currentBlock.lines.push(line);
      continue;
    } else {
      if (currentBlock && currentBlock.type === 'table') {
        blocks.push(currentBlock);
        currentBlock = null;
      }
    }

    // 3. Horizontal Rule
    if (/^[*\-_]{3,}$/.test(trimmed)) {
      if (currentBlock) blocks.push(currentBlock);
      blocks.push({ type: 'hr' });
      currentBlock = null;
      continue;
    }

    // 4. Header block
    const headerMatch = line.match(/^(#+)\s*(.*)$/);
    if (headerMatch) {
      if (currentBlock) blocks.push(currentBlock);
      blocks.push({
        type: 'header',
        content: headerMatch[2]
      });
      currentBlock = null;
      continue;
    }

    // 5. Empty line (Paragraph separator)
    if (trimmed === '') {
      if (currentBlock) {
        blocks.push(currentBlock);
        currentBlock = null;
      }
      blocks.push({ type: 'empty' });
      continue;
    }

    // 6. List items (group consecutive list items)
    const isListItem = /^\s*([*\-+]|\d+\.)\s+/.test(line);
    if (isListItem) {
      if (currentBlock && currentBlock.type !== 'list') {
        blocks.push(currentBlock);
        currentBlock = null;
      }
      if (!currentBlock) {
        currentBlock = {
          type: 'list',
          lines: []
        };
      }
      currentBlock.lines.push(line);
      continue;
    } else {
      if (currentBlock && currentBlock.type === 'list') {
        blocks.push(currentBlock);
        currentBlock = null;
      }
    }

    // 7. Normal paragraph
    if (currentBlock && currentBlock.type !== 'paragraph') {
      blocks.push(currentBlock);
      currentBlock = null;
    }
    if (!currentBlock) {
      currentBlock = {
        type: 'paragraph',
        lines: []
      };
    }
    currentBlock.lines.push(line);
  }

  if (currentBlock) {
    blocks.push(currentBlock);
  }

  const renderedBlocks = blocks.map(block => {
    switch (block.type) {
      case 'header': {
        return `<div><span class="color-accent">${parseInline(block.content, vfs, basePathArr)}</span></div>`;
      }
      case 'hr': {
        return '<hr class="markdown-hr">';
      }
      case 'empty': {
        return '<div>&nbsp;</div>';
      }
      case 'code': {
        const escapedCode = block.lines.map(l => escapeHTML(l)).join('\n');
        return `<pre class="markdown-code-block"><code>${escapedCode}</code></pre>`;
      }
      case 'table': {
        return renderTextTable(block.lines, vfs, basePathArr);
      }
      case 'list': {
        return block.lines.map(line => `<div>${parseInline(line, vfs, basePathArr)}</div>`).join('');
      }
      case 'paragraph': {
        let paragraphText = '';
        for (let i = 0; i < block.lines.length; i++) {
          const rawLine = block.lines[i];
          const hasManualBreak = rawLine.endsWith('  ');
          const cleanLine = rawLine.trim();

          if (paragraphText === '') {
            paragraphText = cleanLine;
          } else {
            paragraphText += ' ' + cleanLine;
          }
          if (hasManualBreak) {
            paragraphText += '<br>';
          }
        }
        return `<div>${parseInline(paragraphText, vfs, basePathArr)}</div>`;
      }
      default:
        return '';
    }
  });

  return renderedBlocks.join('');
}
