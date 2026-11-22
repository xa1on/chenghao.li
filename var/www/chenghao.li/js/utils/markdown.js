import { resolvePath, getNodeByPath } from '../fs.js';
import { MARKDOWN_WRAP_LIMIT } from '../config.js';

export function escapeHTML(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function sanitizeHTML(str) {
  let escaped = escapeHTML(str);

  // Restore span tags with class attributes
  escaped = escaped.replace(/&lt;span class=(?:&quot;|&#039;)([a-zA-Z0-9_\-\s]+)(?:&quot;|&#039;)&gt;/g, '<span class="$1">');
  escaped = escaped.replace(/&lt;\/span&gt;/g, '</span>');

  // Restore line breaks
  escaped = escaped.replace(/&lt;br\s*\/?&gt;/gi, '<br>');

  return escaped;
}

export const getVisibleLength = (htmlStr) => {
  const plainText = htmlStr.replace(/<[^>]*>/g, '');
  const unescaped = plainText
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'");
  return unescaped.length;
};

export const parseInline = (line, vfs = {}, basePathArr = []) => {
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
    if (/^cmd:/i.test(cleanHref)) {
      const cmd = cleanHref.replace(/^cmd:/i, '').trim();
      return `<span class="color-link cmd-link" data-cmd="${escapeHTML(cmd)}">${text}</span>`;
    }

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
    processed = processed.replace(`__CODE_TOKEN_${i}__`, () => codeTokens[i]);
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

  return outputRows.map(r => `<div class="markdown-table-row" style="white-space: pre; font-family: inherit;">${r}</div>`).join('');
}

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

export function wrapHtmlLines(html, limit = MARKDOWN_WRAP_LIMIT) {
  if (!limit || limit <= 0) return `<div>${html}</div>`;
  const segments = html.split(/<br\s*\/?>/i);
  const resultDivs = [];

  for (const segment of segments) {
    if (!segment.trim()) {
      resultDivs.push('<div>&nbsp;</div>');
      continue;
    }

    const tokenRegex = /(<[^>]+>|[^<>\s]+|\s+)/g;
    const tokens = segment.match(tokenRegex) || [segment];

    let currentLineHtml = '';
    let currentLineVisibleLen = 0;
    const openTags = [];

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (!token) continue;

      if (token.startsWith('<') && token.endsWith('>')) {
        currentLineHtml += token;
        const tagMatch = token.match(/^<\/?([a-zA-Z0-9]+)/);
        if (tagMatch) {
          const tagName = tagMatch[1].toLowerCase();
          if (!VOID_TAGS.has(tagName) && !token.endsWith('/>')) {
            if (token.startsWith('</')) {
              for (let j = openTags.length - 1; j >= 0; j--) {
                if (openTags[j].tag === tagName) {
                  openTags.splice(j, 1);
                  break;
                }
              }
            } else {
              openTags.push({ tag: tagName, full: token });
            }
          }
        }
      } else if (/^\s+$/.test(token)) {
        if (currentLineVisibleLen > 0) {
          currentLineHtml += ' ';
          currentLineVisibleLen += 1;
        }
      } else {
        const unescaped = token.replace(/&[#a-zA-Z0-9]+;/g, 'x');
        const wordLen = unescaped.length;
        if (currentLineVisibleLen > 0 && currentLineVisibleLen + wordLen > limit) {
          const closeSuffix = openTags.slice().reverse().map(t => '</' + t.tag + '>').join('');
          resultDivs.push('<div>' + currentLineHtml.trimEnd() + closeSuffix + '</div>');
          const openPrefix = openTags.map(t => t.full).join('');
          currentLineHtml = openPrefix + token;
          currentLineVisibleLen = wordLen;
        } else {
          currentLineHtml += token;
          currentLineVisibleLen += wordLen;
        }
      }
    }

    if (currentLineHtml.trim()) {
      const closeSuffix = openTags.slice().reverse().map(t => '</' + t.tag + '>').join('');
      resultDivs.push('<div>' + currentLineHtml.trimEnd() + closeSuffix + '</div>');
    }
  }

  return resultDivs.join('');
}


export function parseMarkdown(text, vfs = {}, basePathArr = [], wrapLimit = MARKDOWN_WRAP_LIMIT) {
  if (typeof text !== 'string') return '';

  const lines = text.replace(/\r/g, '').split('\n');
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

    // 6. List items (group consecutive list items and indented continuation lines)
    const isListItem = /^\s*([*\-+]|\d+\.)\s+/.test(line);
    const isListContinuation = currentBlock && currentBlock.type === 'list' && /^(\s{2,}|\t)\S/.test(line);
    if (isListItem || isListContinuation) {
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
        return block.lines.map(l => `<div class="markdown-code-line" style="white-space: pre; font-family: inherit;"><code>${escapeHTML(l) || '&nbsp;'}</code></div>`).join('');
      }
      case 'table': {
        return renderTextTable(block.lines, vfs, basePathArr);
      }
      case 'list': {
        return block.lines.map(line => {
          const listMatch = line.match(/^(\s*)([*\-+]|\d+\.)(\s+)(.*)$/);
          if (listMatch) {
            const indentLen = listMatch[1].replace(/\t/g, '  ').length;
            const marker = listMatch[2] + listMatch[3];
            const pad = indentLen + marker.length;
            const parsedContent = parseInline(listMatch[4], vfs, basePathArr);
            const wrapped = wrapHtmlLines(parsedContent, wrapLimit ? Math.max(20, wrapLimit - pad) : 0);
            const divRegex = /<div>(.*?)<\/div>/g;
            let subIdx = 0;
            return wrapped.replace(divRegex, (match, inner) => {
              if (subIdx++ === 0) {
                return `<div style="padding-left: ${pad}ch; text-indent: -${marker.length}ch;">${marker}${inner}</div>`;
              }
              return `<div style="padding-left: ${pad}ch;">${inner}</div>`;
            });
          }
          const leadMatch = line.match(/^(\s+)(.*)$/);
          if (leadMatch) {
            const pad = leadMatch[1].replace(/\t/g, '  ').length;
            return `<div style="padding-left: ${pad}ch;">${parseInline(leadMatch[2], vfs, basePathArr)}</div>`;
          }
          return wrapHtmlLines(parseInline(line, vfs, basePathArr), wrapLimit);
        }).join('');
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
        return wrapHtmlLines(parseInline(paragraphText, vfs, basePathArr), wrapLimit);
      }
      default:
        return '';
    }
  });

  const maxWidthStyle = typeof wrapLimit === 'number' && wrapLimit > 0 ? `max-width: ${wrapLimit}ch; ` : '';
  return `<div class="markdown-body" style="${maxWidthStyle}word-break: normal; overflow-wrap: break-word;">${renderedBlocks.join('')}</div>`;
}
