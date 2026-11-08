export const ln = {
  name: 'ln',
  description: 'Create a symbolic link to a file or directory.',
  category: 'filesystem',
  options: [
    { name: 'symbolic', flags: ['-s', '--symbolic'], type: 'boolean', description: 'Make symbolic links instead of hard links.' },
    { name: 'force', flags: ['-f', '--force'], type: 'boolean', description: 'Remove existing destination files.' },
    { name: 'help', flags: ['--help'], type: 'boolean', description: 'Display this help and exit.' }
  ],
  args: [
    { name: 'target', description: 'Target file or directory to link to.', required: true },
    { name: 'link_name', description: 'Name of the symlink to create.', required: false }
  ],
  run: async (args, shell, flags = {}) => {
    const isSymbolic = Boolean(flags.symbolic || flags.s);
    const force = Boolean(flags.force || flags.f);

    if (args.length === 0) {
      shell.print('ln: missing file operand. Usage: ln -s &lt;target&gt; [link_name]', 'color-error');
      return;
    }

    const targetArg = args[0];
    let linkName = args[1];

    if (!linkName) {
      // Default link name to basename of target
      const cleanTarget = targetArg.replace(/\/+$/, '');
      const slashIdx = cleanTarget.lastIndexOf('/');
      linkName = slashIdx !== -1 ? cleanTarget.slice(slashIdx + 1) : cleanTarget;
    }

    const resolved = shell.fileSystem.resolveParentAndName(shell.currentPath, linkName);
    if (resolved === null) {
      shell.print(`ln: cannot create link '${linkName}': No such file or directory`, 'color-error');
      return;
    }

    const { resolvedParent, name } = resolved;
    const destPath = [...resolvedParent, name];

    if (force) {
      try {
        shell.fileSystem.deleteNode(destPath);
      } catch (_) { }
    }

    try {
      shell.fileSystem.createSymlink(destPath, targetArg);
    } catch (err) {
      shell.print(`ln: failed to create symbolic link '${linkName}': ${err.message}`, 'color-error');
    }
  }
};
