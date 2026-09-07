export const touch = {
  name: 'touch',
  description: 'Create an empty file.',
  category: 'filesystem',
  args: [
    { name: 'filename', description: 'Name of the empty file to create.', required: true }
  ],
  run: async (args, shell) => {
    const resolved = shell.fileSystem.resolveParentAndName(shell.currentPath, args[0]);
    if (resolved === null) {
      shell.print(`touch: cannot touch '${args[0]}': No such file or directory`, 'color-error');
      return;
    }

    const { resolvedParent, name } = resolved;
    const targetPath = [...resolvedParent, name];

    // Check if target already exists
    const targetNode = shell.fileSystem.getNodeByPath(targetPath);
    if (targetNode !== null) {
      // Node exists, standard touch just updates timestamp (no-op here)
      return;
    }

    try {
      shell.fileSystem.writeFile(targetPath, '');
    } catch (err) {
      shell.print(`touch: cannot touch '${args[0]}': ${err.message}`, 'color-error');
    }
  }
};
