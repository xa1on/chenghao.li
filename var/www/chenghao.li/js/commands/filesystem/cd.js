import { HOME_PATH } from '../../config.js';

export const cd = {
  name: 'cd',
  description: 'Change the current working directory.',
  category: 'filesystem',
  args: [
    { name: 'path', description: 'The directory path to change to.', required: false }
  ],
  run: async (args, shell) => {
    const home = shell.homePath || HOME_PATH;

    if (args.length === 0 || args[0] === '~') {
      shell.previousPath = [...shell.currentPath];
      shell.currentPath = [...home];
      if (!shell.isBooting) shell.updateBrowserUrl('~');
      return;
    }

    const pathArg = args[0];

    // cd - toggles back to previous directory
    if (pathArg === '-') {
      if (!shell.previousPath) {
        shell.print('cd: OLDPWD not set', 'color-error');
        return;
      }
      const target = shell.previousPath;
      shell.previousPath = [...shell.currentPath];
      shell.currentPath = target;
      const display = shell.formatDisplayPath(target);
      shell.print(display);
      if (!shell.isBooting) shell.updateBrowserUrl(display);
      return;
    }

    const resolved = shell.fileSystem.resolvePath(shell.currentPath, pathArg);
    if (resolved === null) {
      shell.print(`cd: no such file or directory: ${pathArg}`, 'color-error');
      return;
    }

    const targetNode = shell.fileSystem.getNodeByPath(resolved);
    if (!targetNode || typeof targetNode !== 'object' || targetNode.symlink !== undefined) {
      shell.print(`cd: not a directory: ${pathArg}`, 'color-error');
    } else {
      shell.previousPath = [...shell.currentPath];
      shell.currentPath = resolved;
      if (!shell.isBooting) shell.updateBrowserUrl(shell.formatDisplayPath(resolved));
    }
  }
};
