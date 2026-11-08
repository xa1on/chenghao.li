import { runScript } from '../../shell/script_runner.js';

async function handleBash(args, shell, isSh = false, flags = {}) {
  if (flags.c) {
    const cmdStr = typeof flags.c === 'string' ? flags.c : args.join(' ');
    return await runScript(cmdStr, shell, isSh ? 'sh' : 'bash', args, true);
  }

  if (args.length === 0) {
    shell.print(`${isSh ? 'sh' : 'bash'}: interactive subshell not supported. Provide a script or use -c.`, 'color-dim');
    return 0;
  }

  // Handle -c "command string" fallback if not parsed
  if (args[0] === '-c') {
    if (args.length < 2) {
      shell.print(`${isSh ? 'sh' : 'bash'}: -c: option requires an argument`, 'color-error');
      return 2;
    }
    const cmdStr = args[1];
    const scriptArgs = args.slice(2);
    return await runScript(cmdStr, shell, isSh ? 'sh' : 'bash', scriptArgs, true);
  }

  const scriptFile = args[0];
  const scriptArgs = args.slice(1);

  const resolved = shell.fileSystem.resolvePath(shell.currentPath, scriptFile);
  if (resolved === null) {
    shell.print(`${isSh ? 'sh' : 'bash'}: ${scriptFile}: No such file or directory`, 'color-error');
    return 127;
  }

  const node = shell.fileSystem.getNodeByPath(resolved);
  if (node === null) {
    shell.print(`${isSh ? 'sh' : 'bash'}: ${scriptFile}: No such file or directory`, 'color-error');
    return 127;
  }

  if (typeof node === 'object' && !shell.fileSystem.isSymlink?.(node)) {
    shell.print(`${isSh ? 'sh' : 'bash'}: ${scriptFile}: Is a directory`, 'color-error');
    return 126;
  }

  try {
    const content = await shell.fileSystem.readFile(resolved);
    return await runScript(content, shell, scriptFile, scriptArgs, true);
  } catch (err) {
    shell.print(`${isSh ? 'sh' : 'bash'}: ${scriptFile}: ${err.message}`, 'color-error');
    return 1;
  }
}

export const bash = {
  name: 'bash',
  description: 'GNU Bourne-Again SHell script interpreter.',
  category: 'general',
  allowUnknownOptions: true,
  options: [
    { flags: ['-c'], takesValue: true, suggestions: (sh) => Object.keys(sh.commands || {}), description: 'Read and execute commands from string.' },
    { flags: ['--help'], description: 'Display this help and exit.' }
  ],
  args: [
    { name: 'file', description: 'Script file or -c command string.', required: false, variadic: true }
  ],
  run: async (args, shell, flags = {}) => {
    return await handleBash(args, shell, false, flags);
  }
};

export const sh = {
  name: 'sh',
  description: 'POSIX shell script interpreter.',
  category: 'general',
  allowUnknownOptions: true,
  options: [
    { flags: ['-c'], takesValue: true, suggestions: (sh) => Object.keys(sh.commands || {}), description: 'Read and execute commands from string.' },
    { flags: ['--help'], description: 'Display this help and exit.' }
  ],
  args: [
    { name: 'file', description: 'Script file or -c command string.', required: false, variadic: true }
  ],
  run: async (args, shell, flags = {}) => {
    return await handleBash(args, shell, true, flags);
  }
};
