// System Configuration & Constants
// Single source of truth for browser runtime and build tooling.

// 1. System Identity
export const HOSTNAME = 'chenghao.li';
export const DEFAULT_USERNAME = 'guest';
export const HOME_PATH = ['home', 'guest'];
export const WEB_ROOT = 'var/www/chenghao.li';
export const VFS_INDEX_PATH = 'var/www/chenghao.li/index.html';

// 2. Terminal & Prompt UI
export const PROMPT_SYMBOL = '$';
export const LOCAL_BOOT_PROMPT = 'C:\\Users\\cli&gt;';
export const BOOT_SSH_COMMAND = `ssh ${DEFAULT_USERNAME}@${HOSTNAME}`;
export const MAX_TERMINAL_OUTPUT_LINES = 150;
export const TYPEWRITER_DEFAULT_DELAY = 50;

// 3. Build & Virtual File System Paths
export const GEN_DIR = `${WEB_ROOT}/gen`;
export const FS_MANIFEST_PATH = `${GEN_DIR}/fs_manifest.js`;
export const COMMANDS_INDEX_PATH = `${GEN_DIR}/commands.js`;
export const BUDDIES_PATH = `${GEN_DIR}/buddies.js`;
export const COMMANDS_SRC_DIR = `${WEB_ROOT}/js/commands`;
export const BUDDIES_SRC_DIR = `${WEB_ROOT}/assets/images/buddies`;
