/**
 * Lightweight, modular Bash script runner with Linux parity.
 */
import { parseArgs } from './parser.js';

export function splitStatements(scriptText) {
  const statements = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaped = false;

  // Normalize line endings and process line continuations
  const text = scriptText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\\\n/g, '');

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      current += char;
      continue;
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      current += char;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      current += char;
      continue;
    }

    // Comment handling: # outside quotes ignores characters until newline
    if (char === '#' && !inSingleQuote && !inDoubleQuote) {
      while (i < text.length && text[i] !== '\n') {
        i++;
      }
      if (current.trim()) {
        statements.push(current.trim());
        current = '';
      }
      continue;
    }

    // Statement terminators (; or \n outside quotes)
    if ((char === ';' || char === '\n') && !inSingleQuote && !inDoubleQuote) {
      if (current.trim()) {
        statements.push(current.trim());
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    statements.push(current.trim());
  }

  return statements;
}

export class ScriptContext {
  constructor(shell, scriptPath, args = [], isSubshell = true) {
    this.shell = shell;
    this.scriptPath = scriptPath;
    this.args = args;
    this.isSubshell = isSubshell;
    this.isExited = false;
    this.exitCode = 0;

    // Working directory isolation for subshells
    this.savedPath = isSubshell ? [...shell.currentPath] : null;

    // Scope environment
    const parentEnv = shell.getEnv();
    this.env = isSubshell ? { ...parentEnv } : parentEnv;

    // Save existing positional parameters if sourcing so they can be restored
    this.savedPositional = null;
    if (!isSubshell) {
      this.savedPositional = {};
      const posKeys = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '#', '*', '@'];
      for (const k of posKeys) {
        if (parentEnv[k] !== undefined) {
          this.savedPositional[k] = parentEnv[k];
        }
      }
    }

    // Set positional parameters
    if (isSubshell) {
      this.env['0'] = scriptPath;
    }
    for (let i = 0; i < args.length; i++) {
      this.env[String(i + 1)] = args[i];
    }
    this.env['#'] = args.length;
    this.env['*'] = args.join(' ');
    this.env['@'] = args.join(' ');
  }

  getEnv() {
    return this.env;
  }

  setEnv(key, val) {
    this.env[key] = val;
    if (!this.isSubshell) {
      this.shell.env[key] = val;
    }
  }

  async executeCommand(cmdStr) {
    // Preserve environment during execution
    const prevEnv = this.shell.env;
    this.shell.env = this.env;
    try {
      await this.shell.executeCommand(cmdStr, false);
      this.exitCode = (typeof this.shell.lastExitCode === 'number') ? this.shell.lastExitCode : 0;
      this.env['?'] = this.exitCode;
      return this.exitCode;
    } finally {
      this.shell.env = prevEnv;
    }
  }

  cleanup() {
    // Restore working directory if subshell
    if (this.isSubshell && this.savedPath) {
      this.shell.currentPath = this.savedPath;
    }
    // Restore positional parameters if sourced in parent shell
    if (!this.isSubshell && this.savedPositional) {
      const posKeys = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '#', '*', '@'];
      for (const k of posKeys) {
        if (this.savedPositional[k] !== undefined) {
          this.shell.env[k] = this.savedPositional[k];
        } else {
          delete this.shell.env[k];
        }
      }
    }
  }
}

export async function runScript(scriptContent, shell, scriptPath = 'bash', args = [], isSubshell = true) {
  const statements = splitStatements(scriptContent);
  const context = new ScriptContext(shell, scriptPath, args, isSubshell);

  try {
    await executeStatements(statements, context);
    return context.exitCode;
  } finally {
    context.cleanup();
  }
}

export async function executeStatements(statements, context) {
  let i = 0;

  while (i < statements.length) {
    if (context.isExited || context.shell.abortSignal) break;

    let stmt = statements[i].trim();

    // Strip leading inline block connectors if present
    if (stmt === 'then' || stmt === 'do') {
      i++;
      continue;
    }
    if (stmt.startsWith('then ')) {
      stmt = stmt.slice(5).trim();
    } else if (stmt.startsWith('do ')) {
      stmt = stmt.slice(3).trim();
    }

    // 1. Check for 'exit'
    if (stmt === 'exit' || stmt.startsWith('exit ')) {
      const parts = stmt.split(/\s+/);
      const code = parts[1] ? parseInt(parts[1], 10) : context.exitCode;
      context.exitCode = isNaN(code) ? 0 : code;
      context.isExited = true;
      break;
    }

    // 2. Check for 'if' block
    if (stmt.startsWith('if ') || stmt === 'if') {
      let condStr = stmt.slice(2).trim();
      if (condStr.endsWith('; then')) {
        condStr = condStr.slice(0, -6).trim();
      } else if (condStr.endsWith(' then')) {
        condStr = condStr.slice(0, -5).trim();
      }
      i++;
      // Skip optional 'then' token if present as next statement
      if (i < statements.length && statements[i] === 'then') {
        i++;
      }

      // Collect blocks: thenBlocks, elifBlocks: [{cond, stmts}], elseBlock: []
      let currentSection = 'then';
      const thenStmts = [];
      const elifs = [];
      const elseStmts = [];
      let depth = 1;

      while (i < statements.length) {
        const s = statements[i];
        if (s.startsWith('if ') || s === 'if') {
          depth++;
        } else if (s === 'fi') {
          depth--;
          if (depth === 0) {
            i++;
            break;
          }
        } else if (depth === 1) {
          if (s.startsWith('elif ') || s === 'elif') {
            let elifCond = s.slice(4).trim();
            if (elifCond.endsWith('; then')) {
              elifCond = elifCond.slice(0, -6).trim();
            } else if (elifCond.endsWith(' then')) {
              elifCond = elifCond.slice(0, -5).trim();
            }
            elifs.push({ cond: elifCond, stmts: [] });
            currentSection = 'elif';
            i++;
            if (i < statements.length && statements[i] === 'then') {
              i++;
            }
            continue;
          } else if (s === 'else') {
            currentSection = 'else';
            i++;
            continue;
          }
        }

        if (currentSection === 'then') {
          thenStmts.push(s);
        } else if (currentSection === 'elif') {
          elifs[elifs.length - 1].stmts.push(s);
        } else if (currentSection === 'else') {
          elseStmts.push(s);
        }
        i++;
      }

      // Evaluate condition
      const condExit = await context.executeCommand(condStr);
      if (condExit === 0) {
        await executeStatements(thenStmts, context);
      } else {
        let matchedElif = false;
        for (const elif of elifs) {
          const eExit = await context.executeCommand(elif.cond);
          if (eExit === 0) {
            await executeStatements(elif.stmts, context);
            matchedElif = true;
            break;
          }
        }
        if (!matchedElif && elseStmts.length > 0) {
          await executeStatements(elseStmts, context);
        }
      }
      continue;
    }

    // 3. Check for 'for' loop
    if (stmt.startsWith('for ') || stmt === 'for') {
      let forLine = stmt;
      if (forLine.endsWith('; do')) {
        forLine = forLine.slice(0, -4).trim();
      } else if (forLine.endsWith(' do')) {
        forLine = forLine.slice(0, -3).trim();
      }
      const forMatch = forLine.match(/^for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s*(.*)$/);
      if (forMatch) {
        const loopVar = forMatch[1];
        const rawItems = forMatch[2];
        i++;
        if (i < statements.length && statements[i] === 'do') {
          i++;
        }

        // Collect loop body until matching 'done'
        const bodyStmts = [];
        let depth = 1;
        while (i < statements.length) {
          const s = statements[i];
          if (s.startsWith('for ') || s.startsWith('while ') || s.startsWith('until ')) {
            depth++;
          } else if (s === 'done') {
            depth--;
            if (depth === 0) {
              i++;
              break;
            }
          }
          if (depth > 0) {
            bodyStmts.push(s);
          }
          i++;
        }

        // Expand variables in rawItems and parse items respecting quotes
        const expandedItems = context.shell.expandVariables ? context.shell.expandVariables(rawItems, context.getEnv()) : rawItems;
        const items = parseArgs(expandedItems.trim());

        for (const item of items) {
          if (context.isExited || context.shell.abortSignal) break;
          context.setEnv(loopVar, item);
          await executeStatements(bodyStmts, context);
          await new Promise(resolve => setTimeout(resolve, 0));
        }
        continue;
      }
    }

    // 4. Check for 'while' loop
    if (stmt.startsWith('while ') || stmt === 'while') {
      let condStr = stmt.slice(5).trim();
      if (condStr.endsWith('; do')) {
        condStr = condStr.slice(0, -4).trim();
      } else if (condStr.endsWith(' do')) {
        condStr = condStr.slice(0, -3).trim();
      }
      i++;
      if (i < statements.length && statements[i] === 'do') {
        i++;
      }

      const bodyStmts = [];
      let depth = 1;
      while (i < statements.length) {
        const s = statements[i];
        if (s.startsWith('for ') || s.startsWith('while ') || s.startsWith('until ')) {
          depth++;
        } else if (s === 'done') {
          depth--;
          if (depth === 0) {
            i++;
            break;
          }
        }
        if (depth > 0) {
          bodyStmts.push(s);
        }
        i++;
      }

      while (!context.isExited && !context.shell.abortSignal) {
        const condExit = await context.executeCommand(condStr);
        if (condExit !== 0) break;
        await executeStatements(bodyStmts, context);
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      continue;
    }

    // 5. Check for variable assignment: NAME=value or export NAME=value
    let assignCandidate = stmt;
    if (assignCandidate.startsWith('export ')) {
      assignCandidate = assignCandidate.slice(7).trim();
    }
    const assignMatch = assignCandidate.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (assignMatch && !assignMatch[2].startsWith('=')) {
      const varName = assignMatch[1];
      let varValue = assignMatch[2];
      const isSingleQuoted = varValue.startsWith("'") && varValue.endsWith("'");
      if ((varValue.startsWith('"') && varValue.endsWith('"')) || isSingleQuoted) {
        varValue = varValue.slice(1, -1);
      }
      if (!isSingleQuoted && context.shell.expandVariables) {
        varValue = context.shell.expandVariables(varValue, context.getEnv());
      }
      context.setEnv(varName, varValue);
      context.exitCode = 0;
      i++;
      continue;
    }

    // 6. Regular command execution
    await context.executeCommand(stmt);
    i++;
  }
}
