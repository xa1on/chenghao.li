export const rm = {
  name: 'rm',
  description: 'Remove files or directories.',
  category: 'filesystem',
  options: [
    { name: 'recursive', flags: ['-r', '-R', '--recursive'], type: 'boolean', description: 'Remove directories and their contents recursively.' },
    { name: 'force', flags: ['-f', '--force'], type: 'boolean', description: 'Ignore nonexistent files and arguments, never prompt.' },
    { name: 'help', flags: ['--help'], type: 'boolean', description: 'Display this help and exit.' }
  ],
  args: [
    { name: 'path', description: 'Path to the file or directory to remove.', required: true, variadic: true }
  ],
  run: async (args, shell, flags = {}) => {
    const recursive = Boolean(flags.recursive || flags.r);
    const force = Boolean(flags.force || flags.f);

    if (args.length === 0) {
      if (!force) {
        shell.print('rm: missing operand\nTry \'rm --help\' for more information.', 'color-error');
        return 1;
      }
      return 0;
    }

    for (const pathArg of args) {
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
