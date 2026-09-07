export const rm = {
  name: 'rm',
  description: 'Remove files or directories.',
  category: 'filesystem',
  args: [
    { name: 'flags', description: 'Options: -rf for recursive force deletion.', required: false },
    { name: 'path', description: 'Path to the file or directory to remove.', required: true }
  ],
  run: async (args, shell) => {
    let recursive = false;
    let force = false;
    const paths = [];

    for (const arg of args) {
      if (arg.startsWith('-')) {
        if (arg.includes('r')) recursive = true;
        if (arg.includes('f')) force = true;
      } else {
        paths.push(arg);
      }
    }

    if (paths.length === 0) {
      shell.print('rm: missing operand. Usage: rm [-rf] [path]', 'color-error');
      return;
    }

    for (const pathArg of paths) {
      const resolved = shell.fileSystem.resolvePath(shell.currentPath, pathArg, false);

      if (resolved === null) {
        if (!force) {
          shell.print(`rm: cannot remove '${pathArg}': No such file or directory`, 'color-error');
        }
        continue;
      }

      const node = shell.fileSystem.getNodeByPath(resolved, false);
      const isLink = node !== null && typeof node === 'object' && typeof node.symlink === 'string';

      if (node && typeof node === 'object' && !isLink) {
        if (!recursive) {
          shell.print(`rm: cannot remove '${pathArg}': Is a directory`, 'color-error');
          continue;
        }
      }

      try {
        shell.fileSystem.deleteNode(resolved);
      } catch (err) {
        shell.print(`rm: cannot remove '${pathArg}': ${err.message}`, 'color-error');
      }
    }
  }
};
