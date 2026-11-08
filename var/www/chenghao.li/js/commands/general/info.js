import { TerminalPager, generateManLines } from './man.js';

const INFO_DIR_LINES = [
  '<span class="color-dim">-*- Text -*-</span>',
  '<span class="blue" style="font-weight: bold;">This is the Top node of the INFO tree.</span>',
  'This (the Directory node) gives a menu of major topics.',
  'Typing "q" exits, "h" toggles help.',
  '',
  '<span class="blue" style="font-weight: bold;">* Menu:</span>',
  '',
  '<span class="color-accent">Basics</span>',
  '* bash: (bash).                     The GNU Bourne Again SHell.',
  '* help: (help).                     Shell builtin command reference.',
  '* man: (man).                       System manual page interface.',
  '',
  '<span class="color-accent">File Utilities</span>',
  '* ls: (ls).                         List directory contents.',
  '* cat: (cat).                       Concatenate and print files.',
  '* cd: (cd).                         Change the shell working directory.',
  '* pwd: (pwd).                       Print name of current/working directory.',
  '* mkdir: (mkdir).                   Create directories.',
  '* rm: (rm).                         Remove files or directories.',
  '* touch: (touch).                   Change file timestamps / create files.',
  '* ln: (ln).                         Make links between files.',
  '',
  '<span class="color-accent">Editors</span>',
  '* nano: (nano).                     Small, friendly text editor.',
  '* vim: (vim).                       Vi IMproved text editor.',
  '* paint: (paint).                   ASCII and ANSI art canvas editor.',
  '',
  '<span class="color-accent">System & Tools</span>',
  '* neofetch: (neofetch).             System information display tool.',
  '* sudo: (sudo).                     Execute a command as another user.',
  '* date: (date).                     Print or set system date and time.',
  '* ping: (ping).                     Send ICMP ECHO_REQUEST to network hosts.',
  '* whoami: (whoami).                 Print effective userid.',
  '* clear: (clear).                   Clear the terminal screen buffer.',
  '* llm: (llm).                       Local in-browser WebGPU AI assistant.',
  '',
  '<span class="color-accent">Games & Entertainment</span>',
  '* snake: (snake).                   Classic arcade snake game.',
  '* tetris: (tetris).                 Falling blocks puzzle game.',
  '* minesweeper: (minesweeper).       Classic grid mine-clearing game.',
  '* invaders: (invaders).             Space Invaders arcade shooter.',
  '* pong: (pong).                     Classic 2-player paddle ball game.',
  '* sokoban: (sokoban).               Warehouse crate-pushing puzzle game.',
  '* dvd: (dvd).                       Bouncing DVD logo screensaver.',
  '',
  '<span class="color-accent">Audio</span>',
  '* sound: (sound).                   Play sound effects and retro chiptunes.',
  '* mute: (mute).                     Mute all audio output.',
  '* unmute: (unmute).                 Unmute audio output.',
  ''
];

const INFO_BASH_LINES = [
  '<span class="color-dim">File: bash.info,  Node: Top,  Next: Introduction,  Up: (dir)</span>',
  '',
  '<span class="blue" style="font-weight: bold;">Bash Reference Manual</span>',
  '<span class="color-dim">*********************</span>',
  '',
  'This document describes GNU Bash, the Bourne Again SHell (version 5.2).',
  '',
  '<span class="color-accent">1 Introduction</span>',
  '<span class="color-dim">**************</span>',
  'Bash is an sh-compatible command language interpreter that executes',
  'commands read from the standard input or from a file. Bash also',
  'incorporates useful features from the Korn and C shells (ksh and csh).',
  '',
  '<span class="color-accent">2 Shell Builtin Commands</span>',
  '<span class="color-dim">************************</span>',
  'Builtin commands are contained within the shell itself. When the name',
  'of a builtin command is used as the first word of a simple command, the',
  'shell executes the command directly, without creating a new process.',
  '',
  'Commands built into this shell include:',
  '  <span class="color-green">cd</span>, <span class="color-green">clear</span>, <span class="color-green">echo</span>, <span class="color-green">exit</span>, <span class="color-green">help</span>, <span class="color-green">history</span>, <span class="color-green">logout</span>, <span class="color-green">pwd</span>.',
  '',
  "Type 'help' in the terminal for a quick synopsis of shell builtins.",
  "Type 'help &lt;builtin&gt;' for detailed usage on any builtin command.",
  '',
  '<span class="color-accent">3 Command Execution & Manual Pages</span>',
  '<span class="color-dim">**********************************</span>',
  'External utilities, games, and programs are invoked by typing their',
  'command name along with any arguments. Reference documentation for all',
  "commands is available using the 'man' pager (e.g. 'man ls', 'man snake').",
  '',
  '<span class="color-accent">4 Readline & Interactive Line Editing</span>',
  '<span class="color-dim">************************************</span>',
  'This shell features an Emacs-style GNU Readline editor with cursor',
  'movement (Ctrl+A, Ctrl+E, Alt+B, Alt+F), kill-ring cut/yank (Ctrl+U,',
  'Ctrl+K, Ctrl+W, Ctrl+Y), and reverse history search (Ctrl+R).',
  ''
];

export const info = {
  name: 'info',
  description: 'Read documentation in Info format.',
  category: 'general',
  args: [
    { name: 'menu-item', description: 'The Info node or command to view.', required: false }
  ],
  man: {
    description: 'GNU Info is a hypertext reader for software documentation formatted in Texinfo format.',
    synopsis: 'info [topic]',
    examples: [
      { cmd: 'info', desc: 'Open the top-level Info Directory menu.' },
      { cmd: 'info bash', desc: 'Read the GNU Bash reference manual node.' },
      { cmd: 'info ls', desc: 'View documentation for the ls utility.' }
    ],
    seeAlso: 'man(1), help(1)'
  },
  run: async (args, shell) => {
    if (args.length === 0 || args[0] === 'dir') {
      const pager = new TerminalPager(shell, 'dir', INFO_DIR_LINES);
      await pager.start();
      return 0;
    }

    const topic = args[0].toLowerCase();

    if (topic === 'bash') {
      const pager = new TerminalPager(shell, 'bash', INFO_BASH_LINES);
      await pager.start();
      return 0;
    }

    let cmd = shell.commands[topic];
    if (!cmd) {
      shell.print(`info: No menu item '${topic}' in node '(dir)Top'.`, 'color-error');
      return 1;
    }

    // Resolve lazy command if needed
    if (cmd.lazy && typeof cmd.import === 'function') {
      try {
        const module = await cmd.import();
        const loadedCmd = module[topic];
        if (loadedCmd) {
          Object.assign(cmd, loadedCmd);
          cmd.lazy = false;
        }
      } catch (err) {
        shell.print(`Failed to load info for '${topic}': ${err.message}`, 'color-error');
        return 1;
      }
    }

    const manLines = generateManLines(cmd, shell);
    const pager = new TerminalPager(shell, topic, manLines, true);
    await pager.start();
    return 0;
  }
};
