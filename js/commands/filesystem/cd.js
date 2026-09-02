export const cd = {
  name: 'cd',
  description: 'Change the current working directory.',
  category: 'filesystem',
  args: [
    { name: 'path', description: 'The directory path to change to.', required: false }
  ],
  run: async (args, shell) => {
    if (args.length === 0 || args[0] === '~') {
      shell.currentPath = [];
      if (!shell.isBooting) shell.updateBrowserUrl('');
    } else {
      const pathArg = args[0];
      const resolved = shell.fileSystem.resolvePath(shell.currentPath, pathArg);
      if (resolved === null) {
        shell.print(`cd: no such file or directory: ${pathArg}`, 'color-error');
      } else {
        const targetNode = shell.fileSystem.getNodeByPath(resolved);
        if (typeof targetNode !== 'object') {
          shell.print(`cd: not a directory: ${pathArg}`, 'color-error');
        } else {
          shell.currentPath = resolved;
          if (!shell.isBooting) shell.updateBrowserUrl(resolved.join('/'));
        }
      }
    }
  }
};
