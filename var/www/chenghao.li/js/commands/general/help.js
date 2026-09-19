/**
 * GNU Bash builtin 'help' command.
 * Provides documentation for internal shell builtins, matching GNU Bash format, options, and error messages.
 */

// Backlog of GNU Bash builtins to implement over time (internal reference)
export const UNIMPLEMENTED_BASH_BUILTINS = [
  'alias', 'bg', 'bind', 'break', 'builtin', 'caller', 'command', 'compgen',
  'complete', 'compopt', 'continue', 'coproc', 'dirs', 'disown', 'enable',
  'eval', 'exec', 'export', 'false', 'fc', 'fg', 'getopts', 'hash', 'jobs',
  'kill', 'let', 'local', 'popd', 'pushd', 'read', 'readarray', 'readonly',
  'return', 'select', 'set', 'shift', 'shopt', 'source', 'suspend', 'test',
  'times', 'trap', 'true', 'type', 'typeset', 'ulimit', 'umask', 'unalias',
  'unset', 'until', 'wait'
];

export const BASH_BUILTINS = {
  cd: {
    name: 'cd',
    synopsis: 'cd [-L|[-P [-e]] [-@]] [dir]',
    shortDesc: 'Change the shell working directory.',
    doc: `cd: cd [-L|[-P [-e]] [-@]] [dir]
    Change the shell working directory.

    Change the current directory to DIR.  The default DIR is the value of the
    HOME shell variable.

    Options:
      -L\tforce symbolic links to be followed: resolve symbolic
\t\tlinks in DIR after processing instances of \`..'
      -P\tuse the physical directory structure without following
\t\tsymbolic links: resolve symbolic links in DIR before
\t\tprocessing instances of \`..'

    Exit Status:
    Returns 0 if the directory is changed, and non-zero otherwise.`
  },
  clear: {
    name: 'clear',
    synopsis: 'clear',
    shortDesc: 'Clear the terminal screen buffer.',
    doc: `clear: clear
    Clear the terminal screen buffer.

    Clears the visible scrollback and positions the cursor at top-left.

    Exit Status:
    Returns 0.`
  },
  echo: {
    name: 'echo',
    synopsis: 'echo [-neE] [arg ...]',
    shortDesc: 'Write arguments to the standard output.',
    doc: `echo: echo [-neE] [arg ...]
    Write arguments to the standard output.

    Display the ARGs, separated by a single space character and followed by a
    newline, on the standard output.

    Options:
      -n\tdo not append a newline
      -e\tenable interpretation of backslash escapes
      -E\tcannot interpret backslash escapes

    Exit Status:
    Returns success unless a write error occurs.`
  },
  exit: {
    name: 'exit',
    synopsis: 'exit [n]',
    shortDesc: 'Exit the shell.',
    doc: `exit: exit [n]
    Exit the shell.

    Exits the shell with a status of N.  If N is omitted, the exit status
    is that of the last command executed.`
  },
  help: {
    name: 'help',
    synopsis: 'help [-dms] [pattern ...]',
    shortDesc: 'Display information about builtin commands.',
    doc: `help: help [-dms] [pattern ...]
    Display information about builtin commands.

    Displays brief summaries of builtin commands.  If PATTERN is
    specified, gives detailed help on all commands matching PATTERN,
    otherwise the list of help topics is printed.

    Options:
      -d\toutput short description for each topic
      -m\tdisplay usage in pseudo-manpage format
      -s\toutput only a short usage synopsis for each topic matching
\t\tPATTERN

    Arguments:
      PATTERN\tPattern specifying a help topic

    Exit Status:
    Returns success unless PATTERN is not found or an invalid option is given.`
  },
  history: {
    name: 'history',
    synopsis: 'history [-c] [-d offset] [n]',
    shortDesc: 'Display or manipulate the history list.',
    doc: `history: history [-c] [-d offset] [n]
    Display or manipulate the history list.

    Display the history list with line numbers.  Lines modified with an
    asterisk have been altered.  An argument of N lists only the last
    N lines.

    Options:
      -c\tclear the history list by deleting all of the entries
      -d offset\tdelete the history entry at position OFFSET.

    Exit Status:
    Returns success unless an invalid option is given or an error occurs.`
  },
  logout: {
    name: 'logout',
    synopsis: 'logout [n]',
    shortDesc: 'Exit a login shell.',
    doc: `logout: logout [n]
    Exit a login shell.

    Exits a login shell with exit status N.  Returns an error if not executed in
    a login shell.`
  },
  pwd: {
    name: 'pwd',
    synopsis: 'pwd [-LP]',
    shortDesc: 'Print the name of the current working directory.',
    doc: `pwd: pwd [-LP]
    Print the name of the current working directory.

    Options:
      -L\tprint the value of $PWD if it names the current working
\t\tdirectory
      -P\tprint the physical directory, without any symbolic links

    Exit Status:
    Returns 0 unless an invalid option is given or the current directory
    cannot be read.`
  }
};

export const help = {
  name: 'help',
  description: 'Display information about builtin commands.',
  category: 'general',
  args: [
    { name: 'pattern', description: 'Pattern or name of builtin command.', required: false }
  ],
  run: async (args, shell) => {
    let mode = 'normal'; // 'normal', 'synopsis' (-s), 'description' (-d)
    let pattern = '';

    // Parse options
    const filteredArgs = [];
    for (const arg of args) {
      if (arg === '-s') {
        mode = 'synopsis';
      } else if (arg === '-d') {
        mode = 'description';
      } else if (arg === '-m') {
        mode = 'normal';
      } else if (arg.startsWith('-')) {
        shell.print(`bash: help: ${arg}: invalid option\nhelp: usage: help [-dms] [pattern ...]`, 'color-error');
        return 2;
      } else {
        filteredArgs.push(arg);
      }
    }

    if (filteredArgs.length > 0) {
      pattern = filteredArgs[0].toLowerCase();
    }

    // When querying a specific topic or pattern
    if (pattern) {
      const matched = Object.keys(BASH_BUILTINS).filter(k => k.toLowerCase() === pattern || k.toLowerCase().startsWith(pattern));

      if (matched.length === 0) {
        shell.print(`-bash: help: no help topics match \`${pattern}'.  Try \`help help' or 'man -k ${pattern}' or 'info ${pattern}'.`, 'color-error');
        return 1;
      }

      for (const key of matched) {
        const item = BASH_BUILTINS[key];
        if (mode === 'synopsis') {
          shell.print(`${item.name}: ${item.synopsis}`);
        } else if (mode === 'description') {
          shell.print(`${item.name} - ${item.shortDesc}`);
        } else {
          shell.print(item.doc);
        }
      }
      return 0;
    }

    // Default listing (bare 'help')
    if (mode === 'synopsis') {
      for (const item of Object.values(BASH_BUILTINS)) {
        shell.print(`${item.name}: ${item.synopsis}`);
      }
      return 0;
    }

    if (mode === 'description') {
      for (const item of Object.values(BASH_BUILTINS)) {
        shell.print(`${item.name} - ${item.shortDesc}`);
      }
      return 0;
    }

    const header = `GNU bash, version 5.2.15(1)-release (x86_64-pc-linux-gnu)
These shell commands are defined internally.  Type \`help' to see this list.
Type \`help name' to find out more about the function \`name'.
Use \`info bash' to find out more about the shell in general.
Use \`man -k' or \`info' to find out more about commands not in this list.

A star (*) next to a name means that the command is disabled.
`;

    const builtinKeys = Object.keys(BASH_BUILTINS).sort();
    const half = Math.ceil(builtinKeys.length / 2);
    const colWidth = 38;

    let columnsText = '';
    for (let i = 0; i < half; i++) {
      const leftKey = builtinKeys[i];
      const rightKey = builtinKeys[i + half];

      const leftSynopsis = ` ${BASH_BUILTINS[leftKey].synopsis}`;
      const paddedLeft = leftSynopsis.padEnd(colWidth);

      let line = paddedLeft;
      if (rightKey) {
        line += ` ${BASH_BUILTINS[rightKey].synopsis}`;
      }
      columnsText += `\n${line}`;
    }

    const tip = `\n<span class="color-dim">Tip: Run '</span><span class="blue cmd-link" data-cmd="man -k .">man -k .</span><span class="color-dim">' to list all available commands, or '</span><span class="blue cmd-link" data-cmd="man">man &lt;command&gt;</span><span class="color-dim">' to view specific manual pages.</span>`;

    shell.print(`${header}${columnsText}${tip}`);
    return 0;
  }
};
