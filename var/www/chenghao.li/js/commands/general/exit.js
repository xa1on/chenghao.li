export const exit = {
  name: 'exit',
  description: 'Exit the terminal session.',
  category: 'general',
  args: [],
  run: async (args, shell) => {
    shell.print('logout: not permitted in this session (session is persistent).', 'color-yellow');
    shell.print("Type '<span class=\"blue cmd-link\" data-cmd=\"help\">help</span>' or '<span class=\"blue cmd-link\" data-cmd=\"man -k .\">man -k .</span>' to explore available terminal commands.");
  }
};
