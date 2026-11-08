export const history = {
  name: 'history',
  description: 'Display command history list or clear it.',
  category: 'general',
  options: [
    { flags: ['-c'], description: 'Clear the command history list.' },
    { flags: ['--help'], description: 'Display this help and exit.' }
  ],
  args: [],
  run: async (args, shell) => {
    if (args.length > 0 && args[0] === '-c') {
      shell.commandHistory = [];
      shell.historyIndex = 0;
      shell.print('Command history cleared.');
      return;
    }

    if (!shell.commandHistory || shell.commandHistory.length === 0) {
      shell.print('History is empty.');
      return;
    }

    const lines = shell.commandHistory.map((cmd, idx) => {
      const num = String(idx + 1).padStart(5, ' ');
      return `  <span class="color-dim">${num}</span>  ${shell.escapeHTML(cmd)}`;
    });

    shell.print(lines.join('\n'));
  }
};
