import { audio } from '../../audio.js';

export const sokoban = {
  name: 'sokoban',
  description: 'Play a game of Sokoban.',
  category: 'game',
  lazy: true,
  args: [
    { name: 'level_path', description: 'Path to custom level file.', required: false }
  ],
  run: async (args, shell) => {
    let customPathStr = args.length > 0 ? args[0] : '';
    let levelText = '';
    let isCustom = false;
    let currentLevelIndex = 1;
    const maxBuiltinLevels = 3;

    // Helper to parse map from string content
    function parseMap(mapStr) {
      const lines = mapStr.split(/\r?\n/).filter(line => line.trim().length > 0);
      if (lines.length === 0) throw new Error('Empty map file');

      const height = lines.length;
      const width = Math.max(...lines.map(line => line.length));

      // Grid layers
      const staticGrid = Array.from({ length: height }, () => Array(width).fill(' '));
      const boxGrid = Array.from({ length: height }, () => Array(width).fill(false));
      let playerPos = { x: -1, y: -1 };

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < lines[y].length; x++) {
          const char = lines[y][x];
          if (char === '#') {
            staticGrid[y][x] = '#';
          } else if (char === '.') {
            staticGrid[y][x] = '.';
          } else if (char === '$') {
            boxGrid[y][x] = true;
          } else if (char === '*') {
            staticGrid[y][x] = '.';
            boxGrid[y][x] = true;
          } else if (char === '@') {
            playerPos = { x, y };
          } else if (char === '+') {
            staticGrid[y][x] = '.';
            playerPos = { x, y };
          }
        }
      }

      if (playerPos.x === -1) throw new Error('Player not found in map (@)');
      return { staticGrid, boxGrid, playerPos, width, height };
    }

    // Fallback builtin levels in case file reading fails or is empty
    const builtinFallbackLevels = {
      1: `
    #####
    #@  #
    # $ #
    # . #
    #####
`,
      2: `
  #####
  #   #
  #$#$#
  #.@.#
  # . #
  #####
`,
      3: `
  ######
###  @ #
# . $$ #
#  .   #
########
`
    };

    async function loadLevel(indexOrPath) {
      if (typeof indexOrPath === 'string') {
        // Load custom level
        const targetPath = shell.fileSystem.resolvePath(shell.currentPath, indexOrPath);
        if (!targetPath) {
          throw new Error(`File not found: ${indexOrPath}`);
        }
        const text = await shell.fileSystem.readFile(targetPath);
        isCustom = true;
        return parseMap(text);
      } else {
        // Load builtin level
        try {
          const pathArr = ['sokoban', `level${indexOrPath}.txt`];
          const text = await shell.fileSystem.readFile(pathArr);
          isCustom = false;
          return parseMap(text);
        } catch (e) {
          // Use fallback levels
          isCustom = false;
          const fallback = builtinFallbackLevels[indexOrPath];
          if (!fallback) throw new Error(`Fallback level ${indexOrPath} not found`);
          return parseMap(fallback);
        }
      }
    }

    // Load initial map state
    let mapState = null;
    let initialMapStr = ''; // Used for resetting level

    if (customPathStr) {
      try {
        mapState = await loadLevel(customPathStr);
        initialMapStr = await shell.fileSystem.readFile(shell.fileSystem.resolvePath(shell.currentPath, customPathStr));
      } catch (err) {
        shell.print(`Error starting custom Sokoban level: ${err.message}`, 'color-error');
        return;
      }
    } else {
      try {
        mapState = await loadLevel(currentLevelIndex);
      } catch (err) {
        shell.print(`Error starting Sokoban: ${err.message}`, 'color-error');
        return;
      }
    }

    shell.loginState = 'GAME';

    return new Promise((resolve) => {
      let moveCount = 0;
      let pushCount = 0;
      let quitGame = false;
      let abortCheckInterval = null;

      const gameContainer = document.createElement('pre');
      gameContainer.style.fontFamily = 'monospace';
      gameContainer.style.lineHeight = '1.15';
      gameContainer.style.color = 'var(--text-color)';
      shell.output.appendChild(gameContainer);

      function checkWin() {
        // Game won when all targets have boxes
        for (let y = 0; y < mapState.height; y++) {
          for (let x = 0; x < mapState.width; x++) {
            if (mapState.staticGrid[y][x] === '.' && !mapState.boxGrid[y][x]) {
              return false;
            }
          }
        }
        return true;
      }

      function drawSokoban() {
        let board = `--- SOKOBAN ---`;
        if (isCustom) {
          board += ` (Custom Level: ${customPathStr})\n`;
        } else {
          board += ` (Level ${currentLevelIndex}/${maxBuiltinLevels})\n`;
        }

        const bestMovesKey = isCustom ? `sokoban_best_moves_custom_${customPathStr}` : `sokoban_best_moves_level_${currentLevelIndex}`;
        const bestMoves = localStorage.getItem(bestMovesKey) || 'N/A';
        board += ` Best Moves: ${bestMoves}\n\n`;

        for (let y = 0; y < mapState.height; y++) {
          let line = ' ';
          for (let x = 0; x < mapState.width; x++) {
            const isPlayer = (mapState.playerPos.x === x && mapState.playerPos.y === y);
            const isBox = mapState.boxGrid[y][x];
            const isTarget = mapState.staticGrid[y][x] === '.';
            const isWall = mapState.staticGrid[y][x] === '#';

            if (isWall) {
              line += '<span class="color-dim">#</span>';
            } else if (isPlayer) {
              line += isTarget ? '<span class="blue">+</span>' : '<span class="blue">@</span>';
            } else if (isBox) {
              line += isTarget ? '<span class="green">*</span>' : '<span class="yellow">$</span>';
            } else if (isTarget) {
              line += '<span class="cyan">.</span>';
            } else {
              line += ' ';
            }
          }
          board += line + '\n';
        }

        board += `\n Moves: ${moveCount} ║ Pushes: ${pushCount}\n`;
        board += ` Controls: [Arrows]/[WASD] to Move. [R] to Restart. [Q] to quit.\n`;
        gameContainer.innerHTML = board;
        shell.body.scrollTop = shell.body.scrollHeight;
      }

      const cleanup = () => {
        document.removeEventListener('keydown', keyHandler);
        if (abortCheckInterval) {
          clearInterval(abortCheckInterval);
        }
        shell.loginState = 'LOGGED_IN';
      };

      const finishGame = () => {
        cleanup();
        if (quitGame || shell.abortSignal) {
          shell.print('Sokoban game exited.', 'color-dim');
        } else {
          shell.print('Sokoban victory! All levels complete.', 'color-green');
        }
        resolve();
      };

      const handleLevelComplete = async () => {
        audio.playMelody([
          { f: 523.25, dur: 0.08, delay: 0.00 },
          { f: 659.25, dur: 0.08, delay: 0.08 },
          { f: 783.99, dur: 0.08, delay: 0.16 },
          { f: 1046.50, dur: 0.08, delay: 0.24 },
          { f: 1318.51, dur: 0.40, delay: 0.32 }
        ], 'square', 0.12); // victory sound
        shell.print(`Level complete! Total Moves: ${moveCount}, Pushes: ${pushCount}`, 'color-green');

        // Record high score moves
        const bestMovesKey = isCustom ? `sokoban_best_moves_custom_${customPathStr}` : `sokoban_best_moves_level_${currentLevelIndex}`;
        const previousBest = localStorage.getItem(bestMovesKey);
        if (!previousBest || moveCount < parseInt(previousBest, 10)) {
          localStorage.setItem(bestMovesKey, moveCount.toString());
          shell.print(`NEW BEST RECORD! Moves: ${moveCount}`, 'color-accent');
        }

        // If not custom level, transition to next level
        if (!isCustom && currentLevelIndex < maxBuiltinLevels) {
          shell.print(`Loading Level ${currentLevelIndex + 1}...`, 'color-blue');

          // Disable keys temporarily during transition
          document.removeEventListener('keydown', keyHandler);

          await new Promise(r => setTimeout(r, 1200));

          if (shell.abortSignal || quitGame) {
            finishGame();
            return;
          }

          // Re-enable key listener
          document.addEventListener('keydown', keyHandler);

          currentLevelIndex++;
          moveCount = 0;
          pushCount = 0;
          try {
            mapState = await loadLevel(currentLevelIndex);
            drawSokoban();
          } catch (err) {
            shell.print(`Error loading level: ${err.message}`, 'color-error');
            finishGame();
          }
        } else {
          finishGame();
        }
      };

      const handlePlayerMove = (dx, dy) => {
        const nextX = mapState.playerPos.x + dx;
        const nextY = mapState.playerPos.y + dy;

        if (nextX < 0 || nextX >= mapState.width || nextY < 0 || nextY >= mapState.height) return;

        const nextStatic = mapState.staticGrid[nextY][nextX];
        const hasBox = mapState.boxGrid[nextY][nextX];

        if (nextStatic === '#') {
          // Wall, blocked
          return;
        }

        if (hasBox) {
          // Try pushing box
          const boxNextX = nextX + dx;
          const boxNextY = nextY + dy;

          if (boxNextX < 0 || boxNextX >= mapState.width || boxNextY < 0 || boxNextY >= mapState.height) return;

          const boxNextStatic = mapState.staticGrid[boxNextY][boxNextX];
          const boxNextHasBox = mapState.boxGrid[boxNextY][boxNextX];

          if (boxNextStatic === '#' || boxNextHasBox) {
            // Box blocked by wall or another box
            return;
          }

          // Move box
          mapState.boxGrid[nextY][nextX] = false;
          mapState.boxGrid[boxNextY][boxNextX] = true;
          pushCount++;
          audio.playBeep(80, 40, 0.15, 'triangle', 0.2);

          // If target filled
          if (boxNextStatic === '.') {
            audio.playMelody([
              { f: 587.33, dur: 0.08, delay: 0.00 },
              { f: 880.00, dur: 0.15, delay: 0.08 }
            ], 'triangle', 0.12);
          }
        }

        // Move player
        mapState.playerPos.x = nextX;
        mapState.playerPos.y = nextY;
        moveCount++;

        // Trigger redraw
        drawSokoban();

        // Check win
        if (checkWin()) {
          handleLevelComplete();
        }
      };

      const keyHandler = (e) => {
        if (shell.loginState !== 'GAME') return;
        const key = e.key.toLowerCase();

        // Prevent default browser scrolling
        if (['arrowup', 'w', 'arrowdown', 's', 'arrowleft', 'a', 'arrowright', 'd'].includes(key)) {
          e.preventDefault();
        }

        if (key === 'q') {
          e.preventDefault();
          quitGame = true;
          finishGame();
          return;
        }

        if (key === 'r') {
          e.preventDefault();
          // Reset level
          moveCount = 0;
          pushCount = 0;
          if (isCustom) {
            mapState = parseMap(initialMapStr);
            drawSokoban();
          } else {
            // reload built-in fallback/file map
            loadLevel(currentLevelIndex).then(parsed => {
              mapState = parsed;
              drawSokoban();
            });
          }
          return;
        }

        if (key === 'arrowup' || key === 'w') {
          handlePlayerMove(0, -1);
        } else if (key === 'arrowdown' || key === 's') {
          handlePlayerMove(0, 1);
        } else if (key === 'arrowleft' || key === 'a') {
          handlePlayerMove(-1, 0);
        } else if (key === 'arrowright' || key === 'd') {
          handlePlayerMove(1, 0);
        }
      };

      document.addEventListener('keydown', keyHandler);

      // Setup lightweight 200ms check for Ctrl+C / abortSignal
      abortCheckInterval = setInterval(() => {
        if (shell.abortSignal) {
          finishGame();
        }
      }, 200);

      drawSokoban();
    });
  }
};
