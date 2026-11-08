export const mkdir = {
  name: 'mkdir',
  description: 'Create a new directory.',
  category: 'filesystem',
  options: [
    { name: 'parents', flags: ['-p', '--parents'], type: 'boolean', description: 'No error if existing, make parent directories as needed.' },
    { name: 'verbose', flags: ['-v', '--verbose'], type: 'boolean', description: 'Print a message for each created directory.' },
    { name: 'help', flags: ['--help'], type: 'boolean', description: 'Display this help and exit.' }
  ],
  args: [
    { name: 'directory_name', description: 'Name of the new directory to create.', required: true, type: 'dir', variadic: true }
  ],
  run: async (args, shell, flags = {}) => {
    const parents = Boolean(flags.parents || flags.p);
    const verbose = Boolean(flags.verbose || flags.v);

    if (args.length === 0) {
      shell.print('mkdir: missing operand', 'color-error');
      shell.print("Try 'mkdir --help' for more information.");
      return 1;
    }

    let status = 0;
    for (const pathArg of args) {
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
