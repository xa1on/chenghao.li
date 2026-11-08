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
      // Check for special POSIX single-char variables: $?, $#, $@, $*, $!, $$
      if (['?', '#', '@', '*', '!', '$'].includes(str[i + 1])) {
        const specialChar = str[i + 1];
        result += env[specialChar] !== undefined ? String(env[specialChar]) : '';
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

/**
 * Parses redirection operators (> and >>) outside quotes.
 */
export function parseRedirection(str) {
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
    if (char === '>' && !inSingleQuote && !inDoubleQuote) {
      const isAppend = (str[i + 1] === '>');
      const cmdPart = str.slice(0, i).trim();
      const targetPart = str.slice(i + (isAppend ? 2 : 1)).trim();
      return {
        command: cmdPart,
        target: targetPart,
        op: isAppend ? '>>' : '>'
      };
    }
  }
  return null;
}

/**
 * Modular GNU/POSIX-compatible option and argument parser.
 * Driven by declarative cmd.options schemas with type, range, and choice validation.
 *
 * @param {string[]} rawArgs - Tokenized CLI arguments
 * @param {object} cmd - Command definition with optional 'options' and 'args'
 * @returns {string[] & { flags: object, error: string | null }}
 */
export function parseCommandArgs(rawArgs = [], cmd = {}) {
  const options = Array.isArray(cmd.options) ? cmd.options : [];
  const positional = [];
  const flags = {};
  let error = null;

  // Build lookup map and initialize default values
  const flagMap = new Map();
  for (const opt of options) {
    const flagList = Array.isArray(opt.flags) ? opt.flags : (opt.flag ? [opt.flag] : []);
    let canonical = opt.name;
    if (!canonical) {
      const longFlag = flagList.find(f => f.startsWith('--'));
      if (longFlag) {
        canonical = longFlag.replace(/^--/, '').replace(/-([a-z0-9])/gi, (_, ch) => ch.toUpperCase());
      } else if (flagList[0]) {
        canonical = flagList[0].replace(/^-+/, '');
      } else {
        canonical = 'opt';
      }
    }

    const type = opt.type || (opt.takesValue ? 'string' : 'boolean');
    const takesValue = type === 'string' || type === 'number' || Boolean(opt.takesValue);
    const shortChars = flagList
      .filter(f => f.startsWith('-') && !f.startsWith('--') && f.length === 2)
      .map(f => f[1]);

    const optMeta = { opt, canonical, flagList, type, takesValue, shortChars };

    // Set default value if declared
    if (opt.default !== undefined) {
      flags[canonical] = opt.default;
      for (const ch of shortChars) {
        flags[ch] = opt.default;
      }
    }

    for (const f of flagList) {
      flagMap.set(f, optMeta);
    }
  }

  function validateAndSet(meta, rawVal, flagName) {
    let finalVal = rawVal;
    if (meta.opt.value !== undefined && rawVal === true) {
      finalVal = meta.opt.value;
    }
    if (meta.type === 'number') {
      const num = Number(rawVal);
      if (isNaN(num) || String(rawVal).trim() === '') {
        return `option '${flagName}' requires a numerical value, got '${rawVal}'`;
      }
      if (meta.opt.min !== undefined && num < meta.opt.min) {
        return `option '${flagName}' value ${num} is below minimum allowed ${meta.opt.min}`;
      }
      if (meta.opt.max !== undefined && num > meta.opt.max) {
        return `option '${flagName}' value ${num} exceeds maximum allowed ${meta.opt.max}`;
      }
      finalVal = num;
    } else if (meta.opt.choices && Array.isArray(meta.opt.choices)) {
      if (!meta.opt.choices.includes(rawVal)) {
        return `option '${flagName}' invalid argument '${rawVal}'. Allowed: ${meta.opt.choices.join(', ')}`;
      }
    }

    flags[meta.canonical] = finalVal;
    for (const ch of meta.shortChars) {
      flags[ch] = finalVal;
    }
    return null;
  }

  let stopOptions = false;
  const allowUnknown = Boolean(cmd.allowUnknownOptions || options.length === 0);

  for (let i = 0; i < rawArgs.length; i++) {
    const token = rawArgs[i];

    if (stopOptions || token === '-' || token === '~') {
      positional.push(token);
      continue;
    }

    if (token === '--') {
      stopOptions = true;
      continue;
    }

    // Long flag (--option or --option=value)
    if (token.startsWith('--')) {
      let flagPart = token;
      let inlineVal = null;
      const eqIdx = token.indexOf('=');
      if (eqIdx !== -1) {
        flagPart = token.slice(0, eqIdx);
        inlineVal = token.slice(eqIdx + 1);
      }

      const meta = flagMap.get(flagPart);
      if (!meta) {
        if (allowUnknown) {
          positional.push(token);
        } else {
          error = `invalid option -- '${flagPart}'`;
          break;
        }
        continue;
      }

      if (meta.takesValue) {
        let val = inlineVal;
        if (val === null) {
          if (i + 1 < rawArgs.length) {
            val = rawArgs[++i];
          } else {
            error = `option '${flagPart}' requires an argument`;
            break;
          }
        }
        const valErr = validateAndSet(meta, val, flagPart);
        if (valErr) {
          error = valErr;
          break;
        }
      } else {
        if (inlineVal !== null) {
          error = `option '${flagPart}' doesn't allow an argument`;
          break;
        }
        validateAndSet(meta, true, flagPart);
      }
      continue;
    }

    // Short flag (-f, -rf, -c10, -c=10)
    if (token.startsWith('-') && token.length > 1) {
      // Check for inline equals: e.g. -c=10
      const eqIdx = token.indexOf('=');
      if (eqIdx !== -1) {
        const flagPart = token.slice(0, eqIdx);
        const inlineVal = token.slice(eqIdx + 1);
        const meta = flagMap.get(flagPart);
        if (meta && meta.takesValue) {
          const valErr = validateAndSet(meta, inlineVal, flagPart);
          if (valErr) {
            error = valErr;
            break;
          }
          continue;
        }
      }

      let consumedRemainder = false;
      for (let c = 1; c < token.length; c++) {
        const charFlag = '-' + token[c];
        const meta = flagMap.get(charFlag);

        if (!meta) {
          if (allowUnknown) {
            positional.push(token);
            consumedRemainder = true;
            break;
          } else {
            error = `invalid option -- '${token[c]}'`;
            consumedRemainder = true;
            break;
          }
        }

        if (meta.takesValue) {
          let val = token.slice(c + 1);
          if (val.length > 0) {
            // Inline value from bundle: e.g. -c10
            c = token.length;
          } else if (i + 1 < rawArgs.length) {
            val = rawArgs[++i];
          } else {
            error = `option requires an argument -- '${token[c]}'`;
            consumedRemainder = true;
            break;
          }

          const valErr = validateAndSet(meta, val, charFlag);
          if (valErr) {
            error = valErr;
            consumedRemainder = true;
            break;
          }
          consumedRemainder = true;
          break;
        } else {
          validateAndSet(meta, true, charFlag);
        }
      }

      if (error) break;
      if (consumedRemainder) continue;
      continue;
    }

    // Positional argument
    positional.push(token);
  }

  positional.flags = flags;
  positional.error = error;
  return positional;
}

