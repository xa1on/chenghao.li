export const history = {
  name: 'history',
  description: 'Display command history list or clear it.',
  category: 'general',
  options: [
    { name: 'clear', flags: ['-c'], type: 'boolean', description: 'Clear the command history list.' },
    { name: 'help', flags: ['--help'], type: 'boolean', description: 'Display this help and exit.' }
  ],
  args: [],
  run: async (args, shell, flags = {}) => {
    if (flags.clear || flags.c) {
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
