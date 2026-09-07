export const ln = {
  name: 'ln',
  description: 'Create a symbolic link to a file or directory.',
  category: 'filesystem',
  args: [
    { name: 'flags', description: 'Options: -s for symbolic link.', required: false },
    { name: 'target', description: 'Target file or directory to link to.', required: true },
    { name: 'link_name', description: 'Name of the symlink to create.', required: false }
  ],
  run: async (args, shell) => {
    const nonFlags = [];
    let isSymbolic = false;

    for (const arg of args) {
      if (arg.startsWith('-')) {
        if (arg.includes('s')) {
          isSymbolic = true;
        }
      } else {
        nonFlags.push(arg);
      }
    }

    if (nonFlags.length === 0) {
      shell.print('ln: missing file operand. Usage: ln -s &lt;target&gt; [link_name]', 'color-error');
      return;
    }

    const targetArg = nonFlags[0];
    let linkName = nonFlags[1];

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

    try {
      shell.fileSystem.createSymlink(destPath, targetArg);
    } catch (err) {
      shell.print(`ln: failed to create symbolic link '${linkName}': ${err.message}`, 'color-error');
    }
  }
};
