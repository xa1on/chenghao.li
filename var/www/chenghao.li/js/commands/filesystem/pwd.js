export const pwd = {
  name: 'pwd',
  description: 'Print the current working directory.',
  category: 'filesystem',
  options: [
    { name: 'mode', flags: ['-L'], value: 'logical', default: 'logical', description: 'Print the value of $PWD if it names the current working directory.' },
    { name: 'mode', flags: ['-P'], value: 'physical', description: 'Print the physical directory, without any symbolic links.' },
    { name: 'help', flags: ['--help'], type: 'boolean', description: 'Display this help and exit.' }
  ],
  args: [],
  run: async (args, shell, flags = {}) => {
    let pathArr = shell.currentPath;
    if (flags.mode === 'physical') {
      const resolved = shell.fileSystem.resolvePath([], '/' + pathArr.join('/'), true);
      if (resolved !== null) pathArr = resolved;
    }
    const pathStr = pathArr.length === 0 ? '/' : '/' + pathArr.join('/');
    shell.print(pathStr);
    return 0;
  }
};
