/**
 * Terminal SSH Shell Entry Point
 * Re-exports the decoupled modular Shell architecture.
 */

export { Shell } from './shell/shell_core.js';
export {
  findCommentIndex,
  parseArgs,
  expandVariables,
  splitCommandChains,
  splitCommandChainsWithOps
} from './shell/parser.js';
export { LineEditor } from './shell/line_editor.js';
