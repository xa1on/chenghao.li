export const date = {
  name: 'date',
  description: 'Display the current system date and time.',
  category: 'general',
  options: [
    { flags: ['-u', '--utc'], description: 'Display Coordinated Universal Time (UTC).' },
    { flags: ['--help'], description: 'Display this help and exit.' }
  ],
  args: [],
  run: async (args, shell) => {
    const isUTC = args.includes('-u') || args.includes('--utc');
    shell.print(isUTC ? new Date().toUTCString() : new Date().toString());
    return 0;
  }
};
