export const help = {
  name: 'help',
  description: 'List available commands or show detailed help for a specific command.',
  category: 'general',
  args: [
    { name: 'command', description: 'Show detailed usage instructions for a specific command.', required: false }
  ],
  run: async (args, shell) => {
    if (args.length > 0) {
      const targetCmdName = args[0].toLowerCase();
      const cmd = shell.commands[targetCmdName];
      if (!cmd) {
        shell.print(`help: command not found: ${targetCmdName}`, 'color-error');
        return;
      }

      let helpText = `<span class="blue" style="font-weight: bold;">Command:</span> <span class="color-accent">${cmd.name}</span>\n`;
      const desc = cmd.description || cmd.helpText || '';
      helpText += `<span class="blue" style="font-weight: bold;">Description:</span> ${desc}\n`;

      // Usage
      let usage = cmd.name;
      if (cmd.args && cmd.args.length > 0) {
        const argUsageStrings = cmd.args.map(a => a.required ? `&lt;${a.name}&gt;` : `[${a.name}]`);
        usage += ' ' + argUsageStrings.join(' ');
      }
      helpText += `<span class="blue" style="font-weight: bold;">Usage:</span> <span class="color-green">${usage}</span>\n`;

      // Arguments
      if (cmd.args && cmd.args.length > 0) {
        helpText += `\n<span class="blue" style="font-weight: bold;">Arguments:</span>`;
        for (const arg of cmd.args) {
          const rawArgName = arg.required ? `<${arg.name}>` : `[${arg.name}]`;
          const escapedArgName = arg.required ? `&lt;${arg.name}&gt;` : `[${arg.name}]`;
          const paddedArgName = rawArgName.padEnd(16);
          const styledArgName = paddedArgName.replace(rawArgName, `<span class="color-accent">${escapedArgName}</span>`);

          const reqText = arg.required ? '(Required)' : '(Optional)';
          const reqSpan = arg.required ? `<span class="red">${reqText}</span>` : `<span class="color-dim">${reqText}</span>`;
          const paddedReqText = reqText.padEnd(12);
          const styledReqText = paddedReqText.replace(reqText, reqSpan);

          helpText += `\n  ${styledArgName} ${styledReqText} ${arg.description}`;
        }
      }
      shell.print(helpText);
      return;
    }

    // Default categorized list view
    const categories = {
      general: { label: 'General Commands', cmds: [] },
      filesystem: { label: 'File System Commands', cmds: [] },
      audio: { label: 'Audio Commands', cmds: [] },
      game: { label: 'Game Commands', cmds: [] }
    };

    const sortedCommands = Object.entries(shell.commands).sort((a, b) => a[0].localeCompare(b[0]));
    for (const [name, cmd] of sortedCommands) {
      const cat = cmd.category || 'general';
      if (categories[cat]) {
        categories[cat].cmds.push({ name, cmd });
      } else {
        categories.general.cmds.push({ name, cmd });
      }
    }

    let output = '';
    for (const [catKey, catInfo] of Object.entries(categories)) {
      if (catInfo.cmds.length > 0) {
        if (output) output += '\n';
        output += `<span class="color-accent">${catInfo.label}:</span>`;
        for (const { name, cmd } of catInfo.cmds) {
          const desc = cmd.description || cmd.helpText || '';
          output += `\n  <span class="blue cmd-link color-accent" data-cmd="${name}">${name.padEnd(14)}</span> ${desc}`;
        }
        output += '\n';
      }
    }
    shell.print(output);
  }
};
