export const mkdir = {
  name: 'mkdir',
  description: 'Create a new directory.',
  category: 'filesystem',
  args: [
    { name: 'directory_name', description: 'Name of the new directory to create.', required: true }
  ],
  run: async (args, shell) => {
    const resolved = shell.fileSystem.resolveParentAndName(shell.currentPath, args[0]);
    if (resolved === null) {
      shell.print(`mkdir: cannot create directory '${args[0]}': No such file or directory`, 'color-error');
      return;
    }

    const { resolvedParent, name } = resolved;
    const targetPath = [...resolvedParent, name];

    try {
      shell.fileSystem.createDirectory(targetPath);
    } catch (err) {
      shell.print(`mkdir: cannot create directory '${args[0]}': ${err.message}`, 'color-error');
    }
  }
};
