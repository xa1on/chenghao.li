export const date = {
  name: 'date',
  description: 'Display the current system date and time.',
  category: 'general',
  args: [],
  run: async (args, shell) => {
    shell.print(new Date().toString());
  }
};
