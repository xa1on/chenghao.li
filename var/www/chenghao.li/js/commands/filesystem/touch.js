export const touch = {
  name: 'touch',
  description: 'Create an empty file.',
  category: 'filesystem',
  options: [
    { flags: ['--help'], description: 'Display this help and exit.' }
  ],
  args: [
    { name: 'filename', description: 'Name of the empty file to create.', required: true, variadic: true }
  ],
  run: async (args, shell) => {
    const targets = args.filter(a => !a.startsWith('-'));
    if (targets.length === 0) {
      shell.print('touch: missing file operand', 'color-error');
      shell.print("Try 'touch --help' for more information.");
      return 1;
    }

    let status = 0;
    for (const fileArg of targets) {
      const resolved = shell.fileSystem.resolveParentAndName(shell.currentPath, fileArg);
      if (resolved === null) {
        shell.print(`touch: cannot touch '${fileArg}': No such file or directory`, 'color-error');
        status = 1;
        continue;
      }

      const { resolvedParent, name } = resolved;
      const targetPath = [...resolvedParent, name];

      const targetNode = shell.fileSystem.getNodeByPath(targetPath);
      if (targetNode !== null) {
        continue;
      }

      try {
        shell.fileSystem.writeFile(targetPath, '');
      } catch (err) {
        shell.print(`touch: cannot touch '${fileArg}': ${err.message}`, 'color-error');
        status = 1;
      }
    }
    return status;
  }
};
