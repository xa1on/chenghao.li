export const mkdir = {
  name: 'mkdir',
  description: 'Create a new directory.',
  category: 'filesystem',
  options: [
    { flags: ['-p', '--parents'], description: 'No error if existing, make parent directories as needed.' },
    { flags: ['-v', '--verbose'], description: 'Print a message for each created directory.' },
    { flags: ['--help'], description: 'Display this help and exit.' }
  ],
  args: [
    { name: 'directory_name', description: 'Name of the new directory to create.', required: true, type: 'dir', variadic: true }
  ],
  run: async (args, shell) => {
    let parents = false;
    let verbose = false;
    const paths = [];

    for (const arg of args) {
      if (arg === '-p' || arg === '--parents') {
        parents = true;
      } else if (arg === '-v' || arg === '--verbose') {
        verbose = true;
      } else if (arg === '-pv' || arg === '-vp') {
        parents = true;
        verbose = true;
      } else if (!arg.startsWith('-')) {
        paths.push(arg);
      } else {
        shell.print(`mkdir: invalid option -- '${arg}'`, 'color-error');
        return 1;
      }
    }

    if (paths.length === 0) {
      shell.print('mkdir: missing operand', 'color-error');
      shell.print("Try 'mkdir --help' for more information.");
      return 1;
    }

    let status = 0;
    for (const pathArg of paths) {
      if (parents) {
        const isAbsolute = pathArg.startsWith('/');
        const isTilde = pathArg === '~' || pathArg.startsWith('~/');
        const startBase = isTilde ? [...(shell.homePath || ['home', 'guest'])] : (isAbsolute ? [] : [...shell.currentPath]);
        const cleanStr = isTilde ? (pathArg === '~' ? '' : pathArg.slice(2)) : (isAbsolute ? pathArg.slice(1) : pathArg);
        const segments = cleanStr.split('/').filter(s => s.length > 0 && s !== '.');

        let current = [...startBase];
        for (const seg of segments) {
          if (seg === '..') {
            if (current.length > 0) current.pop();
            continue;
          }
          const next = [...current, seg];
          const node = shell.fileSystem.getNodeByPath(next, false);
          if (!node) {
            try {
              shell.fileSystem.createDirectory(next);
              if (verbose) {
                shell.print(`mkdir: created directory '${pathArg}'`);
              }
            } catch (err) {
              shell.print(`mkdir: cannot create directory '${pathArg}': ${err.message}`, 'color-error');
              status = 1;
              break;
            }
          } else if (typeof node !== 'object' || (shell.fileSystem.isSymlink && shell.fileSystem.isSymlink(node))) {
            shell.print(`mkdir: cannot create directory '${pathArg}': File exists`, 'color-error');
            status = 1;
            break;
          }
          current = next;
        }
      } else {
        const resolved = shell.fileSystem.resolveParentAndName(shell.currentPath, pathArg);
        if (resolved === null) {
          shell.print(`mkdir: cannot create directory '${pathArg}': No such file or directory`, 'color-error');
          status = 1;
          continue;
        }

        const { resolvedParent, name } = resolved;
        const targetPath = [...resolvedParent, name];

        try {
          shell.fileSystem.createDirectory(targetPath);
          if (verbose) {
            shell.print(`mkdir: created directory '${pathArg}'`);
          }
        } catch (err) {
          shell.print(`mkdir: cannot create directory '${pathArg}': ${err.message}`, 'color-error');
          status = 1;
        }
      }
    }
    return status;
  }
};
