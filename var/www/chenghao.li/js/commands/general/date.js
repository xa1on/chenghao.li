export const date = {
  name: 'date',
  description: 'Display the current system date and time.',
  category: 'general',
  options: [
    { name: 'utc', flags: ['-u', '--utc'], type: 'boolean', description: 'Display Coordinated Universal Time (UTC).' },
    { name: 'help', flags: ['--help'], type: 'boolean', description: 'Display this help and exit.' }
  ],
  args: [],
  run: async (args, shell, flags = {}) => {
    const isUTC = Boolean(flags.utc || flags.u);
    shell.print(isUTC ? new Date().toUTCString() : new Date().toString());
    return 0;
  }
};
