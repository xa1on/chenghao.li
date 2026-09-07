export const echo = {
  name: 'echo',
  description: 'Print the input arguments to the terminal.',
  category: 'general',
  args: [
    { name: 'text', description: 'The text to print.', required: false }
  ],
  run: async (args, shell) => {
    const text = args.join(' ');
    shell.print(shell.escapeHTML(text));
  }
};
