/**
 * POSIX 'test' and '[' builtins.
 */

export function evaluateTest(args, shell) {
  let tokens = [...args];

  // Invert flag if starts with '!'
  let invert = false;
  if (tokens[0] === '!') {
    invert = true;
    tokens.shift();
  }

  let result = false;

  if (tokens.length === 0) {
    result = false;
  } else if (tokens.length === 1) {
    // [ str ]: true if str is not empty
    result = tokens[0].length > 0;
  } else if (tokens.length === 2) {
    const [op, target] = tokens;
    if (op === '-z') {
      result = (target.length === 0);
    } else if (op === '-n') {
      result = (target.length > 0);
    } else if (op === '-f') {
      const resolved = shell.fileSystem.resolvePath(shell.currentPath, target);
      if (resolved !== null) {
        const node = shell.fileSystem.getNodeByPath(resolved);
        result = (node !== null && typeof node !== 'object');
      } else {
        result = false;
      }
    } else if (op === '-d') {
      const resolved = shell.fileSystem.resolvePath(shell.currentPath, target);
      if (resolved !== null) {
        const node = shell.fileSystem.getNodeByPath(resolved);
        result = (node !== null && typeof node === 'object');
      } else {
        result = false;
      }
    } else if (op === '-e') {
      const resolved = shell.fileSystem.resolvePath(shell.currentPath, target);
      if (resolved !== null) {
        const node = shell.fileSystem.getNodeByPath(resolved);
        result = (node !== null);
      } else {
        result = false;
      }
    } else if (op === '-x') {
      const resolved = shell.fileSystem.resolvePath(shell.currentPath, target);
      if (resolved !== null) {
        const node = shell.fileSystem.getNodeByPath(resolved);
        result = (node !== null && shell.fileSystem.isExecutable(resolved));
      } else {
        result = false;
      }
    } else {
      // Unrecognized unary operator
      result = false;
    }
  } else if (tokens.length === 3) {
    const [left, op, right] = tokens;
    if (op === '=' || op === '==') {
      result = (left === right);
    } else if (op === '!=') {
      result = (left !== right);
    } else if (op === '-eq') {
      result = (parseInt(left, 10) === parseInt(right, 10));
    } else if (op === '-ne') {
      result = (parseInt(left, 10) !== parseInt(right, 10));
    } else if (op === '-lt') {
      result = (parseInt(left, 10) < parseInt(right, 10));
    } else if (op === '-le') {
      result = (parseInt(left, 10) <= parseInt(right, 10));
    } else if (op === '-gt') {
      result = (parseInt(left, 10) > parseInt(right, 10));
    } else if (op === '-ge') {
      result = (parseInt(left, 10) >= parseInt(right, 10));
    } else {
      result = false;
    }
  } else {
    result = false;
  }

  if (invert) {
    result = !result;
  }

  return result ? 0 : 1;
}

export const test = {
  name: 'test',
  description: 'Evaluate conditional expression.',
  category: 'general',
  args: [
    { name: 'expression', description: 'Conditional expression to evaluate.', required: false }
  ],
  run: async (args, shell) => {
    return evaluateTest(args, shell);
  }
};
