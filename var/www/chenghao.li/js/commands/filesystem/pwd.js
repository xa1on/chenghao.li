export const pwd = {
  name: 'pwd',
  description: 'Print the current working directory.',
  category: 'filesystem',
  args: [],
  run: async (args, shell) => {
    const pathStr = shell.currentPath.length === 0 ? '/' : '/' + shell.currentPath.join('/');
    shell.print(pathStr);
  }
};
