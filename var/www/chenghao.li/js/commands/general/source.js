import { runScript } from '../../shell/script_runner.js';

async function handleSource(args, shell, isDot = false) {
  const cmdName = isDot ? '.' : 'source';
  if (args.length === 0) {
    shell.print(`-bash: ${cmdName}: filename argument required`, 'color-error');
    shell.print(`${cmdName}: usage: ${cmdName} filename [arguments]`);
    return 2;
  }

  const scriptFile = args[0];
  const scriptArgs = args.slice(1);

  const resolved = shell.fileSystem.resolvePath(shell.currentPath, scriptFile);
  if (resolved === null) {
    shell.print(`-bash: ${cmdName}: ${scriptFile}: No such file or directory`, 'color-error');
    return 1;
  }

  const node = shell.fileSystem.getNodeByPath(resolved);
  if (node === null) {
    shell.print(`-bash: ${cmdName}: ${scriptFile}: No such file or directory`, 'color-error');
    return 1;
  }

  if (typeof node === 'object' && !shell.fileSystem.isSymlink?.(node)) {
    shell.print(`-bash: ${cmdName}: ${scriptFile}: Is a directory`, 'color-error');
    return 1;
  }

  try {
    const content = await shell.fileSystem.readFile(resolved);
    return await runScript(content, shell, scriptFile, scriptArgs, false);
  } catch (err) {
    shell.print(`-bash: ${cmdName}: ${scriptFile}: ${err.message}`, 'color-error');
    return 1;
  }
}

export const source = {
  name: 'source',
  description: 'Execute commands from a file in the current shell.',
  category: 'general',
  args: [
    { name: 'filename', description: 'File containing shell commands.', required: true }
  ],
  run: async (args, shell) => {
    return await handleSource(args, shell, false);
  }
};

export const dot = {
  name: '.',
  description: 'Execute commands from a file in the current shell.',
  category: 'general',
  args: [
    { name: 'filename', description: 'File containing shell commands.', required: true }
  ],
  run: async (args, shell) => {
    return await handleSource(args, shell, true);
  }
};
