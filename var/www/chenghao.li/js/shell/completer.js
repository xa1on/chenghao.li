/**
 * Tab Autocompletion Engine for Linux/Bash Parity.
 * Decoupled, zero-dependency, modular, schema-driven implementation.
 */

export function getLongestCommonPrefix(words) {
  if (!words || words.length === 0) return '';
  let prefix = words[0];
  for (let i = 1; i < words.length; i++) {
    let j = 0;
    while (j < prefix.length && j < words[i].length && prefix[j] === words[i][j]) {
      j++;
    }
    prefix = prefix.slice(0, j);
    if (!prefix) return '';
  }
  return prefix;
}

export function findActiveCommandStart(str) {
  let inDQuote = false;
  let inSQuote = false;
  let esc = false;
  let boundary = 0;

  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (c === '\\' && !inSQuote) {
      esc = true;
      continue;
    }
    if (c === '"' && !inSQuote) {
      inDQuote = !inDQuote;
      continue;
    }
    if (c === "'" && !inDQuote) {
      inSQuote = !inSQuote;
      continue;
    }
    if (!inDQuote && !inSQuote) {
      if ((c === '&' && str[i + 1] === '&') || (c === '|' && str[i + 1] === '|')) {
        boundary = i + 2;
        i++;
      } else if (c === ';' || c === '|') {
        boundary = i + 1;
      }
    }
  }
  return boundary;
}

export function extractCompletionContext(input, cursorPos) {
  const safeCursor = Math.max(0, Math.min(input.length, cursorPos ?? input.length));
  const activeStart = findActiveCommandStart(input.slice(0, safeCursor));
  const segment = input.slice(activeStart);
  const relCursor = safeCursor - activeStart;

  // Scan the segment strictly up to relCursor to capture active tokens, cursor quote state, and offsets
  let inDouble = false;
  let inSingle = false;
  let isEsc = false;
  let lastTokenStart = -1;
  let currentTokenText = '';
  const rawTokens = [];

  for (let i = 0; i < relCursor; i++) {
    const c = segment[i];
    if (isEsc) {
      currentTokenText += c;
      isEsc = false;
      continue;
    }
    if (c === '\\' && !inSingle) {
      isEsc = true;
      continue;
    }
    if (c === '"' && !inSingle) {
      inDouble = !inDouble;
      if (lastTokenStart === -1) {
        lastTokenStart = i + 1;
      }
      continue;
    }
    if (c === "'" && !inDouble) {
      inSingle = !inSingle;
      if (lastTokenStart === -1) {
        lastTokenStart = i + 1;
      }
      continue;
    }
    if (/\s/.test(c) && !inDouble && !inSingle) {
      if (lastTokenStart !== -1) {
        rawTokens.push(currentTokenText);
        currentTokenText = '';
        lastTokenStart = -1;
      }
    } else {
      if (lastTokenStart === -1) {
        lastTokenStart = i;
      }
      currentTokenText += c;
    }
  }

  const isQuoted = inDouble || inSingle;
  const quoteChar = inDouble ? '"' : (inSingle ? "'" : '');
  const tokenStart = lastTokenStart === -1 ? (activeStart + relCursor) : (activeStart + lastTokenStart);
  const tokenIndex = rawTokens.length;

  return {
    rawTokens,
    tokenIndex,
    currentToken: currentTokenText,
    tokenStart,
    isQuoted,
    quoteChar,
    preTokenPrefix: input.slice(0, tokenStart),
    postTokenSuffix: input.slice(safeCursor)
  };
}

function wrapResult(matches, { isDir = false, type = 'file' } = {}) {
  const lcp = getLongestCommonPrefix(matches);
  const formattedMatches = matches.map(m => {
    if (type === 'flag') return `<span class="color-accent">${m}</span>`;
    if (type === 'cmd') return `<span class="color-green">${m}*</span>`;
    if (isDir || m.endsWith('/')) return `<span class="color-dir">${m.endsWith('/') ? m : m + '/'}</span>`;
    return `<span class="color-file">${m}</span>`;
  });
  return { matches, formattedMatches, lcp, isDir };
}

export function completeCommand(prefix, shell) {
  if (prefix.startsWith('./') || prefix.startsWith('../') || prefix.startsWith('/')) {
    return completePath(prefix, shell, { onlyExecutables: true });
  }
  const cmds = Object.keys(shell.commands || {}).filter(c => c.toLowerCase().startsWith(prefix.toLowerCase())).sort();
  return wrapResult(cmds, { type: 'cmd' });
}

export function getCommandOptions(cmd) {
  if (!cmd || !Array.isArray(cmd.options)) return [];
  const opts = [];
  for (const o of cmd.options) {
    if (Array.isArray(o.flags)) {
      for (const f of o.flags) {
        opts.push({
          flag: f,
          takesValue: Boolean(o.takesValue || o.suggestions || o.type),
          type: o.type,
          suggestions: o.suggestions,
          description: o.description || o.desc || ''
        });
      }
    } else if (o.flag) {
      opts.push({
        flag: o.flag,
        takesValue: Boolean(o.takesValue || o.suggestions || o.type),
        type: o.type,
        suggestions: o.suggestions,
        description: o.description || o.desc || ''
      });
    }
  }
  return opts;
}

export function completeFlags(cmd, prefix) {
  const flags = getCommandOptions(cmd).map(o => o.flag);
  const matches = flags.filter(f => f.toLowerCase().startsWith(prefix.toLowerCase())).sort();
  return wrapResult(matches, { type: 'flag' });
}

export function completeFlagValue(cmd, flag, prefix, shell) {
  const opt = getCommandOptions(cmd).find(o => o.flag === flag.split('=')[0]);
  let suggestions = [];
  if (opt?.suggestions) {
    suggestions = typeof opt.suggestions === 'function' ? opt.suggestions(shell) : opt.suggestions;
  }
  if (!Array.isArray(suggestions)) suggestions = [];
  const matches = suggestions.filter(s => String(s).toLowerCase().startsWith(prefix.toLowerCase())).sort();
  return wrapResult(matches);
}

export function completePath(prefix, shell, options = {}) {
  const { onlyDirs = false, onlyExecutables = false } = options;
  const isTilde = prefix === '~' || prefix.startsWith('~/');
  const home = shell.homePath || ['home', 'guest'];

  let basePath = isTilde ? [...home] : [...shell.currentPath];
  let sub = isTilde ? (prefix === '~' ? '' : prefix.slice(2)) : prefix;
  let pathPrefixStr = isTilde ? '~/' : '';

  const slashIdx = sub.lastIndexOf('/');
  if (slashIdx !== -1) {
    const dirPart = sub.slice(0, slashIdx);
    pathPrefixStr += sub.slice(0, slashIdx + 1);
    sub = sub.slice(slashIdx + 1);
    const resolved = shell.fileSystem.resolvePath(basePath, dirPart || '/', true);
    if (!resolved) return wrapResult([]);
    basePath = resolved;
  }

  const node = shell.fileSystem.getNodeByPath(basePath, true);
  if (!node || typeof node !== 'object') return wrapResult([]);

  let keys = Object.keys(node);
  if (sub.startsWith('.')) {
    if (basePath.length > 0) keys.push('..');
    keys.push('.');
  } else {
    keys = keys.filter(k => !k.startsWith('.'));
  }

  const matched = keys.filter(k => k.toLowerCase().startsWith(sub.toLowerCase())).sort();
  const candidates = [];

  for (const name of matched) {
    const item = node[name];
    const isLink = item && typeof item === 'object' && typeof item.symlink === 'string';
    let isDir = name === '..' || name === '.' || (item && typeof item === 'object');
    if (isLink) {
      const res = shell.fileSystem.resolvePath(basePath, item.symlink, true);
      isDir = res !== null && typeof shell.fileSystem.getNodeByPath(res, true) === 'object';
    }
    if (onlyDirs && !isDir) continue;
    const isExec = !isDir && typeof shell.fileSystem.isExecutable === 'function' && shell.fileSystem.isExecutable([...basePath, name]);
    if (onlyExecutables && !isExec && !isDir) continue;
    candidates.push({ name, isDir, isLink, isExec });
  }

  candidates.sort((a, b) => a.name.localeCompare(b.name));
  const matches = candidates.map(c => `${pathPrefixStr}${c.name}`);
  const isSingleDir = candidates.length === 1 && candidates[0].isDir;

  const formattedMatches = candidates.map(c => {
    if (c.isLink) return `<span class="cyan">${c.name}@</span>`;
    if (c.isDir) return `<span class="color-dir">${c.name}/</span>`;
    if (c.isExec) return `<span class="color-green">${c.name}*</span>`;
    return `<span class="color-file">${c.name}</span>`;
  });

  return { matches, formattedMatches, lcp: getLongestCommonPrefix(matches), isDir: isSingleDir };
}

function finalize(res, currentToken, preTokenPrefix, postTokenSuffix, isQuoted, quoteChar) {
  let replacement = null;
  let newCursorPos = null;
  let lcpReplacement = null;
  let newLcpCursorPos = null;

  const formatCompletion = (rawVal, isDir) => {
    let val = rawVal;
    if (isQuoted) {
      if (isDir) {
        return val.endsWith('/') ? val : `${val}/`;
      } else {
        return `${val}${quoteChar} `;
      }
    } else {
      // Unquoted: escape spaces with backslash
      val = val.replace(/ /g, '\\ ');
      if (isDir) {
        return val.endsWith('/') ? val : `${val}/`;
      } else {
        return `${val} `;
      }
    }
  };

  if (res.matches.length === 1) {
    const completed = formatCompletion(res.matches[0], res.isDir);
    replacement = `${preTokenPrefix}${completed}${postTokenSuffix}`;
    newCursorPos = preTokenPrefix.length + completed.length;
  } else if (res.matches.length > 1 && res.lcp) {
    let lcpVal = res.lcp;
    if (!isQuoted) {
      lcpVal = lcpVal.replace(/ /g, '\\ ');
    }
    lcpReplacement = `${preTokenPrefix}${lcpVal}${postTokenSuffix}`;
    newLcpCursorPos = preTokenPrefix.length + lcpVal.length;
  }

  return {
    ...res,
    currentToken,
    preTokenPrefix,
    postTokenSuffix,
    replacement,
    newCursorPos,
    lcpReplacement,
    newLcpCursorPos
  };
}

export function getCompletions({ input, cursorPos, shell }) {
  const {
    rawTokens,
    tokenIndex,
    currentToken,
    isQuoted,
    quoteChar,
    preTokenPrefix,
    postTokenSuffix: rawPostSuffix
  } = extractCompletionContext(input, cursorPos);

  let postTokenSuffix = rawPostSuffix;
  if (isQuoted && quoteChar && postTokenSuffix.startsWith(quoteChar)) {
    postTokenSuffix = postTokenSuffix.slice(quoteChar.length);
  }
  if (!isQuoted && postTokenSuffix.startsWith(' ')) {
    postTokenSuffix = postTokenSuffix.slice(1);
  }

  let res = null;

  const prevToken = tokenIndex > 0 ? rawTokens[tokenIndex - 1] : null;
  const isRedirOp = (t) => t === '>' || t === '>>' || t === '<' || t === '1>' || t === '2>' || t === '2>>';

  if (isRedirOp(prevToken)) {
    res = completePath(currentToken, shell);
  } else if (currentToken.startsWith('>>') || currentToken.startsWith('2>>')) {
    const op = currentToken.startsWith('2>>') ? '2>>' : '>>';
    const subPrefix = currentToken.slice(op.length);
    const pathRes = completePath(subPrefix, shell);
    res = {
      ...pathRes,
      matches: pathRes.matches.map(m => `${op}${m}`),
      lcp: pathRes.lcp ? `${op}${pathRes.lcp}` : ''
    };
  } else if (currentToken.startsWith('>') || currentToken.startsWith('<')) {
    const op = currentToken[0];
    const subPrefix = currentToken.slice(1);
    const pathRes = completePath(subPrefix, shell);
    res = {
      ...pathRes,
      matches: pathRes.matches.map(m => `${op}${m}`),
      lcp: pathRes.lcp ? `${op}${pathRes.lcp}` : ''
    };
  } else if (tokenIndex === 0) {
    res = completeCommand(currentToken, shell);
  } else {
    const cmdName = rawTokens[0]?.toLowerCase() || '';
    const cmd = shell.commands?.[cmdName];

    if (currentToken.includes('=')) {
      const [flag, val] = currentToken.split('=');
      const valRes = completeFlagValue(cmd, flag, val, shell);
      res = {
        matches: valRes.matches.map(m => `${flag}=${m}`),
        formattedMatches: valRes.formattedMatches,
        lcp: valRes.lcp ? `${flag}=${valRes.lcp}` : '',
        isDir: false
      };
    } else if (currentToken.startsWith('-')) {
      res = completeFlags(cmd, currentToken);
    } else if (tokenIndex > 1 && rawTokens[tokenIndex - 1]?.startsWith('-')) {
      const prevFlag = rawTokens[tokenIndex - 1];
      const valRes = completeFlagValue(cmd, prevFlag, currentToken, shell);
      if (valRes.matches.length) res = valRes;
    }

    if (!res) {
      // Calculate positional argument index by skipping flags and their value arguments,
      // as well as redirection operators and their target filenames
      let posIdx = 0;
      const optMap = new Map();
      for (const opt of getCommandOptions(cmd)) {
        optMap.set(opt.flag, opt);
      }

      for (let i = 1; i < tokenIndex; i++) {
        const tok = rawTokens[i];
        if (isRedirOp(tok)) {
          i++; // skip next token as redirection target
        } else if (tok?.startsWith('-')) {
          const flagName = tok.split('=')[0];
          const opt = optMap.get(flagName);
          if (opt?.takesValue && !tok.includes('=')) {
            i++; // skip next token as value
          }
        } else {
          posIdx++;
        }
      }

      if (typeof cmd?.complete === 'function') {
        const custom = cmd.complete({ tokens: rawTokens, tokenIndex, currentToken, posArgIndex: posIdx, shell });
        if (Array.isArray(custom)) {
          const m = custom.filter(s => s.toLowerCase().startsWith(currentToken.toLowerCase()));
          res = wrapResult(m);
        } else if (custom?.matches) {
          res = custom;
        }
      }

      if (!res) {
        if (cmd && Array.isArray(cmd.args)) {
          const arg = cmd.args[posIdx] || (cmd.args.length > 0 && cmd.args[cmd.args.length - 1].variadic ? cmd.args[cmd.args.length - 1] : null);
          if (arg) {
            if (arg.suggestions) {
              const list = typeof arg.suggestions === 'function' ? arg.suggestions(shell) : arg.suggestions;
              const matches = (Array.isArray(list) ? list : []).filter(s => String(s).toLowerCase().startsWith(currentToken.toLowerCase()));
              res = wrapResult(matches);
            } else if (arg.type === 'dir') {
              res = completePath(currentToken, shell, { onlyDirs: true });
            } else if (arg.type === 'command') {
              res = completeCommand(currentToken, shell);
            } else {
              res = completePath(currentToken, shell);
            }
          } else {
            // Command schema specifies no further arguments accepted
            res = wrapResult([]);
          }
        } else {
          // Unknown command or external script fallback
          res = completePath(currentToken, shell);
        }
      }
    }
  }

  return finalize(res, currentToken, preTokenPrefix, postTokenSuffix, isQuoted, quoteChar);
}
