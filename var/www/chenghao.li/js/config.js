// System Configuration & Constants
// Single source of truth for browser runtime and build tooling.

// 1. System Identity
export const HOSTNAME = 'chenghao.li';
export const DEFAULT_USERNAME = 'guest';
export const HOME_PATH = ['home', 'guest'];
export const WEB_ROOT = 'var/www/chenghao.li';
export const VFS_INDEX_PATH = 'var/www/chenghao.li/index.html';

// 2. Terminal & Prompt UI
export const SHOW_FPS_COUNTER = false;
export const PROMPT_SYMBOL = '$';
export const LOCAL_BOOT_PROMPT = 'C:\\Users\\cli&gt;';
export const BOOT_SSH_COMMAND = `ssh ${DEFAULT_USERNAME}@${HOSTNAME}`;
export const MAX_TERMINAL_OUTPUT_LINES = 150;
export const TYPEWRITER_DEFAULT_DELAY = 50;
export const ENABLE_LINE_ANIMATION = true;
export const ENABLE_LINE_FADE = true;
export const ENABLE_LINE_BLUR = true;
export const LINE_RENDER_DELAY = 16;
export const LINE_RENDER_EASING = 'cubic-bezier(0.1, 0.1, 0, 1)';
export const LINE_FADE_DURATION = 200;
export const LINE_BLUR_DURATION = 200;
export const LINE_FADE_BLUR = 20;
export const LINE_FADE_EASING = 'cubic-bezier(0.3, 0.1, 0, 1)';
export const LINE_BLUR_EASING = 'cubic-bezier(0.1, 0.1, 0, 0.8)';
export const SCROLL_SMOOTH_FACTOR = 0.12;
export const SCROLL_SMOOTH_TAU = 0.08;
export const MARKDOWN_WRAP_LIMIT = 120;
export const TAB_DOUBLE_PRESS_INTERVAL = 500;

// 3. Build & Virtual File System Paths
export const GEN_DIR = `${WEB_ROOT}/gen`;
export const FS_MANIFEST_PATH = `${GEN_DIR}/fs_manifest.js`;
export const COMMANDS_INDEX_PATH = `${GEN_DIR}/commands.js`;
export const BUDDIES_PATH = `${GEN_DIR}/buddies.js`;
export const COMMANDS_SRC_DIR = `${WEB_ROOT}/js/commands`;
export const BUDDIES_SRC_DIR = `${WEB_ROOT}/assets/images/buddies`;
