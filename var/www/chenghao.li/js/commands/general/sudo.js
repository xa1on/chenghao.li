export const sudo = {
  name: 'sudo',
  description: 'Execute a command as the superuser.',
  category: 'general',
  args: [
    { name: 'command', description: 'The command to execute.', required: false }
  ],
  run: async (args, shell) => {
    shell.print(`${shell.currentUsername} is not in the sudoers file. This incident will be reported.`, 'color-error');
  }
};
