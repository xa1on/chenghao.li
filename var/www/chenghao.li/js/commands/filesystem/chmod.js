export const chmod = {
  name: 'chmod',
  description: 'Change file mode bits (permissions).',
  category: 'filesystem',
  options: [
    { flags: ['-R', '--recursive'], description: 'Change files and directories recursively.' },
    { flags: ['--help'], description: 'Display this help and exit.' }
  ],
  args: [
    { name: 'mode', description: 'Mode specification (e.g. +x, -x, 755, 644).', required: true, suggestions: ['+x', '-x', '755', '644', '600', '777'] },
    { name: 'file', description: 'File or directory to modify.', required: true, variadic: true }
  ],
  run: async (args, shell) => {
    if (args.length < 2) {
      shell.print('chmod: missing operand', 'color-error');
      shell.print('Try \'chmod --help\' for more information.');
      return 1;
    }

    let recursive = false;
    let modeArg = null;
    const fileArgs = [];

    for (const arg of args) {
      if (arg === '-R' || arg === '--recursive') {
        recursive = true;
      } else if (modeArg === null) {
        modeArg = arg;
      } else {
        fileArgs.push(arg);
      }
    }

    if (!modeArg || fileArgs.length === 0) {
      shell.print('chmod: missing operand', 'color-error');
      return 1;
    }

    const applyMode = (currentMode, modeStr) => {
      // Octal mode
      if (/^[0-7]{3,4}$/.test(modeStr)) {
        return parseInt(modeStr, 8) & 0o777;
      }

      // Symbolic mode like +x, -x, u+x, a+x, etc.
      let newMode = currentMode;
      const clauses = modeStr.split(',');

      for (const clause of clauses) {
        const match = clause.match(/^([augo]*)([-+=])([rwxXst]*)$/);
        if (!match) return null;

        const who = match[1] || 'a';
        const op = match[2];
        const perms = match[3];

        let mask = 0;
        if (perms.includes('r')) mask |= 4;
        if (perms.includes('w')) mask |= 2;
        if (perms.includes('x') || perms.includes('X')) mask |= 1;

        let userMask = 0;
        let groupMask = 0;
        let otherMask = 0;

        if (who === 'a' || who === '') {
          userMask = mask;
          groupMask = mask;
          otherMask = mask;
        } else {
          if (who.includes('u')) userMask = mask;
          if (who.includes('g')) groupMask = mask;
          if (who.includes('o')) otherMask = mask;
        }

        const totalBitmask = (userMask << 6) | (groupMask << 3) | otherMask;

        if (op === '+') {
          newMode |= totalBitmask;
        } else if (op === '-') {
          newMode &= ~totalBitmask;
        } else if (op === '=') {
          let clearMask = 0;
          if (who === 'a' || who === '') clearMask = 0o777;
          else {
            if (who.includes('u')) clearMask |= 0o700;
            if (who.includes('g')) clearMask |= 0o070;
            if (who.includes('o')) clearMask |= 0o007;
          }
          newMode = (newMode & ~clearMask) | totalBitmask;
        }
      }

      return newMode;
    };

    let exitCode = 0;

    const processTarget = (pathArr) => {
      const node = shell.fileSystem.getNodeByPath(pathArr);
      if (node === null) {
        shell.print(`chmod: cannot access '${pathArr.join('/')}': No such file or directory`, 'color-error');
        exitCode = 1;
        return;
      }

      const owner = shell.fileSystem.getOwner(pathArr);
      if (owner.user !== 'guest') {
        shell.print(`chmod: changing permissions of '${pathArr.join('/') || '/'}': Operation not permitted`, 'color-error');
        exitCode = 1;
        return;
      }

      const curMode = shell.fileSystem.getMode(pathArr);
      const newMode = applyMode(curMode, modeArg);
      if (newMode === null) {
        shell.print(`chmod: invalid mode: '${modeArg}'`, 'color-error');
        exitCode = 1;
        return;
      }

      shell.fileSystem.setMode(pathArr, newMode);

      if (recursive && typeof node === 'object' && !shell.fileSystem.isSymlink?.(node)) {
        for (const child of Object.keys(node)) {
          processTarget([...pathArr, child]);
        }
      }
    };

    for (const fileArg of fileArgs) {
      const resolved = shell.fileSystem.resolvePath(shell.currentPath, fileArg);
      if (resolved === null) {
        shell.print(`chmod: cannot access '${fileArg}': No such file or directory`, 'color-error');
        exitCode = 1;
        continue;
      }
      processTarget(resolved);
    }

    return exitCode;
  }
};
