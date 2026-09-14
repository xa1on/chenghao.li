export const ls = {
  name: 'ls',
  description: 'List contents of a directory with flag support (-a, -l, -h).',
  category: 'filesystem',
  args: [
    { name: 'flags', description: 'Options: -a (all), -l (long listing), -h (human-readable).', required: false },
    { name: 'path', description: 'Optional path to list contents of.', required: false }
  ],
  run: async (args, shell) => {
    let showAll = false;
    let longFormat = false;
    let humanReadable = false;
    const paths = [];

    // Parse options vs paths
    for (const arg of args) {
      if (arg.startsWith('-') && arg.length > 1) {
        if (arg === '--all') {
          showAll = true;
          continue;
        }
        if (arg === '--help') {
          await shell.commands.help.run(['ls'], shell);
          return 0;
        }
        for (let i = 1; i < arg.length; i++) {
          const flag = arg[i];
          if (flag === 'a') showAll = true;
          else if (flag === 'l') longFormat = true;
          else if (flag === 'h') humanReadable = true;
          else {
            shell.print(`ls: invalid option -- '${flag}'`, 'color-error');
            shell.print("Try 'ls --help' for more information.");
            return 1;
          }
        }
      } else {
        paths.push(arg);
      }
    }

    let targetPath = shell.currentPath;
    if (paths.length > 0) {
      const pathArg = paths[0];
      const resolved = shell.fileSystem.resolvePath(shell.currentPath, pathArg);
      if (resolved === null) {
        shell.print(`ls: cannot access '${pathArg}': No such file or directory`, 'color-error');
        return 1;
      }
      targetPath = resolved;
    }

    const targetNode = shell.fileSystem.getNodeByPath(targetPath);
    if (targetNode === null) {
      shell.print('ls: file system error.', 'color-error');
      return 1;
    }

    // Single file target
    if (typeof targetNode !== 'object') {
      const absolutePath = '/' + targetPath.join('/');
      const fileName = targetPath[targetPath.length - 1];
      if (longFormat) {
        const sizeStr = formatSize(estimateSize(targetNode), humanReadable);
        const dateStr = getSimulatedDate();
        shell.print(`-rw-r--r-- 1 guest guest ${sizeStr.padStart(6)} ${dateStr} <span class="color-file ls-item" data-type="file" data-path="${absolutePath}">${fileName}</span>`);
      } else {
        shell.print(`<span class="color-file ls-item" data-type="file" data-path="${absolutePath}">${fileName}</span>`);
      }
      return 0;
    }

    // Directory target
    let items = Object.keys(targetNode);
    if (!showAll) {
      // Hide dotfiles
      items = items.filter(name => !name.startsWith('.'));
    }

    items.sort((a, b) => a.localeCompare(b));

    if (showAll) {
      items.unshift('..');
      items.unshift('.');
    }

    const targetPathStr = targetPath.join('/');

    if (longFormat) {
      let totalBlocks = 0;
      const lines = [];

      for (const name of items) {
        let isDir = false;
        let isLink = false;
        let targetObj = null;
        let linkTarget = null;
        let size = 4096;
        let perms = '-rw-r--r--';
        let linkCount = 1;

        if (name === '.') {
          isDir = true;
          perms = 'drwxr-xr-x';
          linkCount = Object.keys(targetNode).length + 2;
        } else if (name === '..') {
          isDir = true;
          perms = 'drwxr-xr-x';
          linkCount = 2;
        } else {
          const itemNode = targetNode[name];
          isLink = itemNode !== null && typeof itemNode === 'object' && typeof itemNode.symlink === 'string';

          if (isLink) {
            perms = 'lrwxrwxrwx';
            linkTarget = itemNode.symlink;
            const resolvedTarget = shell.fileSystem.resolvePath(targetPath, itemNode.symlink);
            if (resolvedTarget !== null) {
              targetObj = shell.fileSystem.getNodeByPath(resolvedTarget);
              isDir = typeof targetObj === 'object';
            }
          } else {
            isDir = typeof itemNode === 'object';
            if (isDir) {
              perms = 'drwxr-xr-x';
              linkCount = Object.keys(itemNode).length + 2;
            } else {
              size = estimateSize(itemNode);
            }
          }
        }

        totalBlocks += isDir ? 4 : Math.ceil(size / 1024) * 4;

        let linkPath = '';
        if (name === '.') {
          linkPath = '/' + targetPathStr;
        } else if (name === '..') {
          linkPath = '/' + targetPath.slice(0, -1).join('/');
        } else {
          linkPath = '/' + (targetPathStr ? targetPathStr + '/' : '') + name;
        }

        let nameDisplay = '';
        if (isLink) {
          const resolved = shell.fileSystem.resolvePath(targetPath, linkTarget);
          if (resolved === null) {
            nameDisplay = `<span class="red ls-item" data-type="broken" data-path="${linkPath}">${name}</span> -> <span class="red">${linkTarget}</span>`;
          } else {
            nameDisplay = `<span class="cyan ls-item" data-type="${isDir ? 'dir' : 'file'}" data-path="${linkPath}">${name}</span> -> <span class="cyan">${linkTarget}</span>`;
          }
        } else if (isDir) {
          nameDisplay = `<span class="color-dir ls-item" data-type="dir" data-path="${linkPath}">${name}/</span>`;
        } else {
          nameDisplay = `<span class="color-file ls-item" data-type="file" data-path="${linkPath}">${name}</span>`;
        }

        const sizeStr = formatSize(size, humanReadable).padStart(6);
        const dateStr = getSimulatedDate();
        lines.push(`${perms} ${String(linkCount).padStart(2)} guest guest ${sizeStr} ${dateStr} ${nameDisplay}`);
      }

      shell.print(`total ${totalBlocks}`);
      for (const line of lines) {
        shell.print(line);
      }
    } else {
      const formattedItems = items.map(name => {
        let isDir = false;
        let isLink = false;
        let linkTarget = null;

        if (name === '.') {
          return `<span class="color-dir ls-item" data-type="dir" data-path="/${targetPathStr}">./</span>`;
        }
        if (name === '..') {
          const parentPath = '/' + targetPath.slice(0, -1).join('/');
          return `<span class="color-dir ls-item" data-type="dir" data-path="${parentPath}">../</span>`;
        }

        const itemNode = targetNode[name];
        isLink = itemNode !== null && typeof itemNode === 'object' && typeof itemNode.symlink === 'string';
        const absolutePath = '/' + (targetPathStr ? targetPathStr + '/' : '') + name;

        if (isLink) {
          const resolvedTarget = shell.fileSystem.resolvePath(targetPath, itemNode.symlink);
          if (resolvedTarget === null) {
            return `<span class="red ls-item" data-type="broken" data-path="${absolutePath}">${name}@</span>`;
          }
          const targetObj = shell.fileSystem.getNodeByPath(resolvedTarget);
          isDir = typeof targetObj === 'object';
          return `<span class="cyan ls-item" data-type="${isDir ? 'dir' : 'file'}" data-path="${absolutePath}">${name}@</span>`;
        }

        isDir = typeof itemNode === 'object';
        return isDir
          ? `<span class="color-dir ls-item" data-type="dir" data-path="${absolutePath}">${name}/</span>`
          : `<span class="color-file ls-item" data-type="file" data-path="${absolutePath}">${name}</span>`;
      });

      if (formattedItems.length === 0) {
        shell.print('');
      } else {
        shell.print(formattedItems.join('   '));
      }
    }

    return 0;
  }
};

function estimateSize(node) {
  if (typeof node === 'string') {
    return node.length * 28; // estimated bytes
  }
  return 1024;
}

function formatSize(bytes, humanReadable) {
  if (!humanReadable) {
    return String(bytes);
  }
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'K';
  return (bytes / (1024 * 1024)).toFixed(1) + 'M';
}

function getSimulatedDate() {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const now = new Date();
  const m = months[now.getMonth()];
  const d = String(now.getDate()).padStart(2, ' ');
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return `${m} ${d} ${hh}:${mm}`;
}
