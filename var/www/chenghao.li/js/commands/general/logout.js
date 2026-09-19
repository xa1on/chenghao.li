export const logout = {
  name: 'logout',
  description: 'Logout of the terminal session.',
  category: 'general',
  args: [],
  run: async (args, shell) => {
    shell.print('logout: not permitted in this session (session is persistent).', 'color-yellow');
    shell.print("Type '<span class=\"blue cmd-link\" data-cmd=\"man\">man</span>' or '<span class=\"blue cmd-link\" data-cmd=\"help\">help</span>' to explore available terminal commands.");
  }
};
