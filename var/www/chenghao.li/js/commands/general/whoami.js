export const whoami = {
  name: 'whoami',
  description: 'Print the current session user name.',
  category: 'general',
  args: [],
  run: async (args, shell) => {
    shell.print(shell.currentUsername);
  }
};
