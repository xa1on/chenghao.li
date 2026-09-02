import { virtualFS } from './fs_manifest.js?v=2fcbb86979';
export { virtualFS };

function deepMerge(target, source) {
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !isSymlink(source[key])) {
      if (!target[key] || typeof target[key] !== 'object' || isSymlink(target[key])) {
        target[key] = {};
      }
      deepMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

/**
 * Checks if a virtual node is a symlink
 */
export function isSymlink(node) {
  return node !== null && typeof node === 'object' && typeof node.symlink === 'string';
}

/**
 * Resolves path array to corresponding nested object or file contents in virtualFS
 */
export function getNodeByPath(vfs, pathArr, followSymlinks = true, depth = 0) {
  if (depth > 20) return null;
  let node = vfs;
  for (let i = 0; i < pathArr.length; i++) {
    const part = pathArr[i];
    if (node && typeof node === 'object' && Object.hasOwn(node, part)) {
      node = node[part];
      if (isSymlink(node)) {
        if (i < pathArr.length - 1 || followSymlinks) {
          const parentPath = pathArr.slice(0, i);
          const resolvedTarget = resolvePath(vfs, parentPath, node.symlink, true, depth + 1);
          if (resolvedTarget === null) return null;
          const remaining = pathArr.slice(i + 1);
          return getNodeByPath(vfs, [...resolvedTarget, ...remaining], followSymlinks, depth + 1);
        }
      }
    } else {
      return null;
    }
  }
  return node;
}

/**
 * Helper to resolve absolute or relative path strings based on current directory
 */
export function resolvePath(vfs, currentPath, pathStr, followFinalSymlink = true, depth = 0) {
  if (depth > 20) return null;
  let target = [...currentPath];

  if (pathStr.startsWith('/')) {
    target = [];
    pathStr = pathStr.slice(1);
  }

  const segments = pathStr.split('/').filter(s => s.length > 0 && s !== '.');

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg === '..') {
      if (target.length > 0) {
        target.pop();
      }
    } else {
      let directTarget = [...target, seg];
      let directNode = getNodeByPath(vfs, directTarget, false);

      if (directNode === null) {
        return null;
      }

      if (isSymlink(directNode)) {
        const isLast = (i === segments.length - 1);
        if (!isLast || followFinalSymlink) {
          const parentPath = target;
          const resolvedTarget = resolvePath(vfs, parentPath, directNode.symlink, true, depth + 1);
          if (resolvedTarget === null) {
            return null;
          }
          target = resolvedTarget;
          continue;
        }
      }

      target = directTarget;
    }
  }

  return target;
}

/**
 * Computes the relative path from fromPath array to toPath array.
 */
export function getRelativePath(fromPath, toPath) {
  let commonCount = 0;
  while (commonCount < fromPath.length && commonCount < toPath.length && fromPath[commonCount] === toPath[commonCount]) {
    commonCount++;
  }

  const upSegments = fromPath.length - commonCount;
  const downSegments = toPath.slice(commonCount);

  const segments = [];
  for (let i = 0; i < upSegments; i++) {
    segments.push('..');
  }
  segments.push(...downSegments);

  if (segments.length === 0) {
    return '.';
  }
  return segments.join('/');
}

export class FileSystem {
  constructor() {
    this.root = JSON.parse(JSON.stringify(virtualFS));
    this.userTree = {};

    // Load user filesystem from localStorage
    try {
      const saved = localStorage.getItem('vfs_user_tree');
      if (saved) {
        this.userTree = JSON.parse(saved);
        deepMerge(this.root, this.userTree);
      }
    } catch (e) {
      console.error('Failed to load user filesystem from localStorage', e);
    }
  }

  isBuiltInPath(pathArr) {
    return getNodeByPath(virtualFS, pathArr, false) !== null;
  }

  async readFile(pathArr) {
    const node = this.getNodeByPath(pathArr);
    if (node === null) {
      throw new Error('No such file or directory');
    }
    if (isSymlink(node)) {
      return node.symlink;
    }
    if (typeof node === 'object') {
      throw new Error('Is a directory');
    }

    if (this.isBuiltInPath(pathArr)) {
      const hash = node;
      const filePath = '/' + pathArr.join('/') + (typeof hash === 'string' && hash && hash !== 'core' ? '?v=' + hash : '');
      const response = await fetch(filePath);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.text();
    } else {
      return node;
    }
  }

  writeFile(pathArr, content) {
    if (pathArr.length === 0) {
      throw new Error('Invalid path');
    }
    if (this.isBuiltInPath(pathArr)) {
      throw new Error('Permission denied: system files are read-only');
    }

    const parentPath = pathArr.slice(0, -1);
    const fileName = pathArr[pathArr.length - 1];

    const rootParent = this.getNodeByPath(parentPath, false);
    if (!rootParent || typeof rootParent !== 'object' || isSymlink(rootParent)) {
      throw new Error('Parent directory does not exist');
    }

    // Check if creating/updating a .symlink file
    if (fileName.endsWith('.symlink')) {
      const linkName = fileName.slice(0, -8);
      const symlinkObj = { symlink: content.trim() };
      rootParent[linkName] = symlinkObj;

      let userParent = this.userTree;
      for (const part of parentPath) {
        if (!userParent[part] || typeof userParent[part] !== 'object') {
          userParent[part] = {};
        }
        userParent = userParent[part];
      }
      userParent[linkName] = symlinkObj;
    } else {
      // Standard file update
      rootParent[fileName] = content;

      let userParent = this.userTree;
      for (const part of parentPath) {
        if (!userParent[part] || typeof userParent[part] !== 'object') {
          userParent[part] = {};
        }
        userParent = userParent[part];
      }
      userParent[fileName] = content;
    }

    this.saveUserFS();
  }

  createSymlink(pathArr, targetStr) {
    if (pathArr.length === 0) {
      throw new Error('Invalid path');
    }
    if (this.isBuiltInPath(pathArr)) {
      throw new Error('Permission denied: cannot overwrite system paths');
    }

    const parentPath = pathArr.slice(0, -1);
    const linkName = pathArr[pathArr.length - 1];

    const rootParent = this.getNodeByPath(parentPath, false);
    if (!rootParent || typeof rootParent !== 'object' || isSymlink(rootParent)) {
      throw new Error('Parent directory does not exist');
    }
    if (rootParent[linkName] !== undefined) {
      throw new Error('File or directory already exists');
    }

    const symlinkObj = { symlink: targetStr };
    rootParent[linkName] = symlinkObj;

    let userParent = this.userTree;
    for (const part of parentPath) {
      if (!userParent[part] || typeof userParent[part] !== 'object') {
        userParent[part] = {};
      }
      userParent = userParent[part];
    }
    userParent[linkName] = symlinkObj;

    this.saveUserFS();
  }

  createDirectory(pathArr) {
    if (pathArr.length === 0) {
      throw new Error('Invalid path');
    }
    if (this.isBuiltInPath(pathArr)) {
      throw new Error('Permission denied: cannot overwrite system paths');
    }

    const parentPath = pathArr.slice(0, -1);
    const dirName = pathArr[pathArr.length - 1];

    const rootParent = this.getNodeByPath(parentPath, false);
    if (!rootParent || typeof rootParent !== 'object' || isSymlink(rootParent)) {
      throw new Error('Parent directory does not exist');
    }
    if (rootParent[dirName] !== undefined) {
      if (typeof rootParent[dirName] === 'object' && !isSymlink(rootParent[dirName])) {
        throw new Error('Directory already exists');
      } else {
        throw new Error('A file with that name already exists');
      }
    }

    // Update in-memory root tree
    rootParent[dirName] = {};

    // Update userTree
    let userParent = this.userTree;
    for (const part of parentPath) {
      if (!userParent[part] || typeof userParent[part] !== 'object') {
        userParent[part] = {};
      }
      userParent = userParent[part];
    }
    userParent[dirName] = {};

    this.saveUserFS();
  }

  deleteNode(pathArr) {
    if (pathArr.length === 0) {
      throw new Error('Cannot delete root directory');
    }
    if (this.isBuiltInPath(pathArr)) {
      throw new Error('Permission denied: system paths are read-only');
    }

    const parentPath = pathArr.slice(0, -1);
    const name = pathArr[pathArr.length - 1];

    // Check recursive nested system files
    const isNestedSystemFile = (node, currentPathArr) => {
      if (!node) return false;
      if (isSymlink(node) || typeof node !== 'object') {
        return this.isBuiltInPath(currentPathArr);
      }
      for (const key of Object.keys(node)) {
        if (isNestedSystemFile(node[key], [...currentPathArr, key])) {
          return true;
        }
      }
      return false;
    };

    const targetNode = this.getNodeByPath(pathArr, false);
    if (isNestedSystemFile(targetNode, pathArr)) {
      throw new Error('Permission denied: cannot delete directory containing system files');
    }

    // Delete from root
    const rootParent = this.getNodeByPath(parentPath, false);
    if (rootParent && typeof rootParent === 'object') {
      delete rootParent[name];
    }

    // Delete from userTree
    let userParent = this.userTree;
    let found = true;
    for (const part of parentPath) {
      if (userParent[part] && typeof userParent[part] === 'object') {
        userParent = userParent[part];
      } else {
        found = false;
        break;
      }
    }
    if (found && userParent && typeof userParent === 'object') {
      delete userParent[name];
    }

    this.saveUserFS();
  }

  saveUserFS() {
    try {
      localStorage.setItem('vfs_user_tree', JSON.stringify(this.userTree));
    } catch (e) {
      console.error('Failed to save user filesystem to localStorage', e);
    }
  }

  resolveParentAndName(currentPath, pathStr) {
    let cleanPathStr = pathStr.trim();
    while (cleanPathStr.endsWith('/') && cleanPathStr.length > 1) {
      cleanPathStr = cleanPathStr.slice(0, -1);
    }

    if (cleanPathStr === '') {
      return null;
    }

    let parentPathStr = '';
    let name = cleanPathStr;
    const lastSlash = cleanPathStr.lastIndexOf('/');
    if (lastSlash !== -1) {
      parentPathStr = cleanPathStr.slice(0, lastSlash);
      name = cleanPathStr.slice(lastSlash + 1);
      if (parentPathStr === '') {
        parentPathStr = '/';
      }
    }

    const resolvedParent = this.resolvePath(currentPath, parentPathStr);
    if (resolvedParent === null) {
      return null;
    }

    return { resolvedParent, name };
  }

  resolvePath(currentPath, pathStr, followFinalSymlink = true) {
    return resolvePath(this.root, currentPath, pathStr, followFinalSymlink);
  }
  getNodeByPath(pathArr, followSymlinks = true) {
    return getNodeByPath(this.root, pathArr, followSymlinks);
  }
  getRelativePath(fromPath, toPath) {
    return getRelativePath(fromPath, toPath);
  }
}
