export const clear = {
  name: 'clear',
  description: 'Clear the terminal screen.',
  category: 'general',
  args: [],
  run: async (args, shell) => {
    shell.clear();
  }
};
