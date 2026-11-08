import { HOME_PATH } from '../../config.js?v=2c3dbc7cd0';

export const cd = {
  name: 'cd',
  description: 'Change the current working directory.',
  category: 'filesystem',
  options: [
    { flags: ['-L'], description: 'Force symbolic links to be followed.' },
    { flags: ['-P'], description: 'Use physical directory structure without following symbolic links.' },
    { flags: ['--help'], description: 'Display this help and exit.' }
  ],
  args: [
    { name: 'path', description: 'The directory path to change to.', required: false, type: 'dir' }
  ],
  run: async (args, shell) => {
    const home = shell.homePath || HOME_PATH;
    let physical = false;
    const paths = [];

    for (const arg of args) {
      if (arg === '-P') {
        physical = true;
      } else if (arg === '-L') {
        physical = false;
      } else if (!arg.startsWith('-') || arg === '-' || arg === '~') {
        paths.push(arg);
      } else {
        shell.print(`cd: invalid option -- '${arg}'`, 'color-error');
        return 1;
      }
    }

    if (paths.length === 0 || paths[0] === '~') {
      shell.previousPath = [...shell.currentPath];
      shell.currentPath = [...home];
      if (!shell.isBooting && typeof shell.updateBrowserUrl === 'function') shell.updateBrowserUrl('~');
      return 0;
    }

    const pathArg = paths[0];

    // cd - toggles back to previous directory
    if (pathArg === '-') {
      if (!shell.previousPath) {
        shell.print('cd: OLDPWD not set', 'color-error');
        return 1;
      }
      const target = shell.previousPath;
      shell.previousPath = [...shell.currentPath];
      shell.currentPath = target;
      const display = shell.formatDisplayPath(target);
      shell.print(display);
      if (!shell.isBooting && typeof shell.updateBrowserUrl === 'function') shell.updateBrowserUrl(display);
      return 0;
    }

    // For -P (physical), resolve symlinks to canonical destination path
    // For -L (logical, default), resolve without dereferencing final symlink
    const resolved = shell.fileSystem.resolvePath(shell.currentPath, pathArg, physical);
    if (resolved === null) {
      shell.print(`cd: no such file or directory: ${pathArg}`, 'color-error');
      return 1;
    }

    const targetNode = shell.fileSystem.getNodeByPath(resolved, true);
    if (!targetNode || typeof targetNode !== 'object') {
      shell.print(`cd: not a directory: ${pathArg}`, 'color-error');
      return 1;
    }

    shell.previousPath = [...shell.currentPath];
    shell.currentPath = resolved;
    if (!shell.isBooting && typeof shell.updateBrowserUrl === 'function') shell.updateBrowserUrl(shell.formatDisplayPath(resolved));
    return 0;
  }
};
