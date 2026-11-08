export const echo = {
  name: 'echo',
  description: 'Print the input arguments to the terminal.',
  category: 'general',
  options: [
    { flags: ['-e'], description: 'Enable interpretation of backslash escapes.' },
    { flags: ['-E'], description: 'Disable interpretation of backslash escapes (default).' },
    { flags: ['--help'], description: 'Display this help and exit.' }
  ],
  args: [
    { name: 'text', description: 'The text to print.', required: false, variadic: true }
  ],
  run: async (args, shell) => {
    let interpretEscapes = false;
    let i = 0;

    while (i < args.length && args[i].startsWith('-') && args[i].length > 1) {
      const opt = args[i];
      let valid = true;
      let curEsc = interpretEscapes;
      for (let j = 1; j < opt.length; j++) {
        if (opt[j] === 'e') curEsc = true;
        else if (opt[j] === 'E') curEsc = false;
        else { valid = false; break; }
      }
      if (!valid) break;
      interpretEscapes = curEsc;
      i++;
    }

    let text = args.slice(i).join(' ');
    if (interpretEscapes) {
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
