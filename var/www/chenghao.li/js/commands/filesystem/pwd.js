export const pwd = {
  name: 'pwd',
  description: 'Print the current working directory.',
  category: 'filesystem',
  options: [
    { flags: ['-L'], description: 'Print the value of $PWD if it names the current working directory.' },
    { flags: ['-P'], description: 'Print the physical directory, without any symbolic links.' },
    { flags: ['--help'], description: 'Display this help and exit.' }
  ],
  args: [],
  run: async (args, shell) => {
    let pathArr = shell.currentPath;
    if (args.includes('-P')) {
      const resolved = shell.fileSystem.resolvePath([], '/' + pathArr.join('/'), true);
      if (resolved !== null) pathArr = resolved;
    }
    const pathStr = pathArr.length === 0 ? '/' : '/' + pathArr.join('/');
    shell.print(pathStr);
    return 0;
  }
};
