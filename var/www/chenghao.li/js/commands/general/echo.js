export const echo = {
  name: 'echo',
  description: 'Print the input arguments to the terminal.',
  category: 'general',
  disableHelp: true,
  allowUnknownOptions: true,
  options: [
    { name: 'escapes', flags: ['-e'], value: true, default: false, description: 'Enable interpretation of backslash escapes.' },
    { name: 'escapes', flags: ['-E'], value: false, description: 'Disable interpretation of backslash escapes (default).' }
  ],
  args: [
    { name: 'text', description: 'The text to print.', required: false, variadic: true }
  ],
  run: async (args, shell, flags = {}) => {
    let text = args.join(' ');
    if (flags.escapes) {
      text = text
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\\r/g, '\r')
        .replace(/\\\\/g, '\\');
    }

    shell.print(shell.escapeHTML(text));
    return 0;
  }
};
