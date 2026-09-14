/**
 * Command parsing, tokenization, variable expansion, and chaining tree
 * for Linux Bash / SSH emulation.
 */

/**
 * Finds the index of a '#' comment indicator outside quotes.
 * A comment must start at the beginning of a line or be preceded by whitespace.
 */
export function findCommentIndex(str) {
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

/**
 * Parses arguments respecting quotes and escape sequences.
 * Preserves empty quoted tokens (e.g. `echo ""` -> ['echo', '']).
 */
export function parseArgs(cmdStr) {
  const args = [];
  let current = '';
  let inDoubleQuote = false;
  let inSingleQuote = false;
  let escaped = false;
  let hasToken = false;

  for (let i = 0; i < cmdStr.length; i++) {
    const char = cmdStr[i];
    if (escaped) {
      current += char;
      hasToken = true;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      hasToken = true;
      continue;
    }
    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      hasToken = true;
      continue;
    }
    if (/\s/.test(char) && !inDoubleQuote && !inSingleQuote) {
      if (hasToken) {
        args.push(current);
        current = '';
        hasToken = false;
      }
    } else {
      current += char;
      hasToken = true;
    }
  }
  if (hasToken) {
    args.push(current);
  }
  return args;
}

/**
 * Expands environment variables ($VAR, $?, $USER, $PWD, etc.)
 * Variables inside single quotes are ignored according to POSIX rules.
 */
export function expandVariables(str, env = {}) {
  let result = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaped = false;

  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (escaped) {
      result += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      result += char;
      continue;
    }
    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      result += char;
      continue;
    }
    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      result += char;
      continue;
    }

    if (char === '$' && !inSingleQuote) {
      // Check for $?
      if (str[i + 1] === '?') {
        result += env['?'] !== undefined ? String(env['?']) : '0';
        i++;
        continue;
      }
      // Check for ${VAR}
      if (str[i + 1] === '{') {
        const closeIdx = str.indexOf('}', i + 2);
        if (closeIdx !== -1) {
          const varName = str.slice(i + 2, closeIdx);
          result += env[varName] !== undefined ? String(env[varName]) : '';
          i = closeIdx;
          continue;
        }
      }
      // Standard $VAR (alphanumeric + underscore)
      let varName = '';
      let j = i + 1;
      while (j < str.length && /[a-zA-Z0-9_]/.test(str[j])) {
        varName += str[j];
        j++;
      }
      if (varName.length > 0) {
        result += env[varName] !== undefined ? String(env[varName]) : '';
        i = j - 1;
        continue;
      }
    }

    result += char;
  }
  return result;
}

/**
 * Splits command line strings into a chain with operator awareness (;, &&, ||).
 * Returns an array of objects: [ { cmd: string, op: '&&' | '||' | ';' | null } ]
 */
export function splitCommandChainsWithOps(str) {
  const chains = [];
  let current = '';
  let inDoubleQuote = false;
  let inSingleQuote = false;
  let escaped = false;

  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      current += char;
      escaped = true;
      continue;
    }
    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      current += char;
      continue;
    }
    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      current += char;
      continue;
    }

    if (!inDoubleQuote && !inSingleQuote) {
      // Check for &&
      if (char === '&' && str[i + 1] === '&') {
        if (current.trim()) {
          chains.push({ cmd: current.trim(), op: '&&' });
        }
        current = '';
        i++;
        continue;
      }
      // Check for ||
      if (char === '|' && str[i + 1] === '|') {
        if (current.trim()) {
          chains.push({ cmd: current.trim(), op: '||' });
        }
        current = '';
        i++;
        continue;
      }
      // Check for ;
      if (char === ';') {
        if (current.trim()) {
          chains.push({ cmd: current.trim(), op: ';' });
        }
        current = '';
        continue;
      }
    }
    current += char;
  }

  if (current.trim()) {
    chains.push({ cmd: current.trim(), op: null });
  }

  return chains;
}

/**
 * Legacy compatibility wrapper for splitCommandChains.
 */
export function splitCommandChains(str) {
  return splitCommandChainsWithOps(str).map(entry => entry.cmd);
}
