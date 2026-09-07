import { audio } from '../../audio.js';

export const minesweeper = {
  name: 'minesweeper',
  description: 'Play a game of Minesweeper.',
  category: 'game',
  lazy: true,
  args: [
    { name: 'difficulty', description: 'Difficulty level (easy, medium, hard, or custom <cols> <rows> <mines>).', required: false, suggestions: ['easy', 'medium', 'hard', 'custom'] }
  ],
  run: async (args, shell) => {
    let cols = 0, rows = 0, mineCount = 0;
    let difficultyPreset = '';

    // Parse CLI arguments
    if (args.length > 0) {
      const mode = args[0].toLowerCase();
      if (mode === 'easy') {
        cols = 9; rows = 9; mineCount = 10;
        difficultyPreset = 'easy';
      } else if (mode === 'medium') {
        cols = 16; rows = 16; mineCount = 40;
        difficultyPreset = 'medium';
      } else if (mode === 'hard') {
        cols = 30; rows = 16; mineCount = 99;
        difficultyPreset = 'hard';
      } else if (mode === 'custom') {
        cols = parseInt(args[1], 10);
        rows = parseInt(args[2], 10);
        mineCount = parseInt(args[3], 10);
        const totalCells = cols * rows;
        const maxMines = totalCells > 9 ? totalCells - 9 : totalCells - 1;
        if (mineCount > maxMines) {
          shell.print(`Too many mines for a ${cols}x${rows} board. Max allowed: ${maxMines}`, 'color-error');
          return;
        }
        difficultyPreset = 'custom';
      }
    }

    // Fallback to menu prompt if invalid/missing
    while (!cols) {
      shell.print(`--- MINESWEEPER ---`);
      shell.print(`Best Times:`);
      shell.print(`  Easy:   ${localStorage.getItem('minesweeper_best_easy') || 'N/A'}s`);
      shell.print(`  Medium: ${localStorage.getItem('minesweeper_best_medium') || 'N/A'}s`);
      shell.print(`  Hard:   ${localStorage.getItem('minesweeper_best_hard') || 'N/A'}s`);
      shell.print(`Select difficulty:\n  [1] Easy (9x9, 10 mines)\n  [2] Medium (16x16, 40 mines)\n  [3] Hard (30x16, 99 mines)`);
      const response = await shell.readInput('Choose difficulty (1-3): ');
      if (response === null) {
        shell.print('Minesweeper cancelled.', 'color-dim');
        return;
      }
      const choice = response.trim().toLowerCase();
      if (choice === '1' || choice === 'easy') {
        cols = 9; rows = 9; mineCount = 10;
        difficultyPreset = 'easy';
      } else if (choice === '2' || choice === 'medium') {
        cols = 16; rows = 16; mineCount = 40;
        difficultyPreset = 'medium';
      } else if (choice === '3' || choice === 'hard') {
        cols = 30; rows = 16; mineCount = 99;
        difficultyPreset = 'hard';
      } else if (choice === '') {
        shell.print('Minesweeper cancelled.', 'color-dim');
        return;
      }
    }

    shell.loginState = 'GAME';

    return new Promise((resolve) => {
      // Game state
      const grid = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ({
        isMine: false,
        isRevealed: false,
        isFlagged: false,
        neighborMines: 0
      })));

      let firstClick = true;
      let gameOver = false;
      let gameWon = false;
      let cursorX = 0;
      let cursorY = 0;
      let startTime = null;
      let elapsedSeconds = 0;
      let flagsCount = 0;
      let touchFlagMode = false; // Toggle for touch screen dig/flag mode

      // Create containers
      const gameWrapper = document.createElement('div');
      gameWrapper.style.userSelect = 'none';

      // Event delegation on gameWrapper for the Mode toggle button
      gameWrapper.addEventListener('click', (e) => {
        const modeBtn = e.target.closest('#ms-mode-toggle');
        if (modeBtn) {
          e.preventDefault();
          e.stopPropagation();
          if (gameOver) return; // Disable changing mode after Game Over
          touchFlagMode = !touchFlagMode;
          audio.playLinkClick();
          drawBoard();
        }
      });

      const headerContainer = document.createElement('div');
      headerContainer.style.fontFamily = 'monospace';
      headerContainer.style.marginBottom = '6px';
      gameWrapper.appendChild(headerContainer);

      const boardContainer = document.createElement('pre');
      boardContainer.style.fontFamily = 'monospace';
      boardContainer.style.lineHeight = '1.15';
      boardContainer.style.cursor = 'default';
      boardContainer.style.display = 'block';
      gameWrapper.appendChild(boardContainer);

      const controlContainer = document.createElement('div');
      controlContainer.style.fontFamily = 'monospace';
      controlContainer.style.marginTop = '6px';
      gameWrapper.appendChild(controlContainer);

      shell.output.appendChild(gameWrapper);

      // Color definitions for cell numbers
      const numberColors = {
        1: 'blue',
        2: 'green',
        3: 'red',
        4: 'magenta',
        5: 'yellow',
        6: 'cyan',
        7: 'white',
        8: 'color-dim'
      };

      function initMines(safeX, safeY) {
        let minesPlaced = 0;
        const totalCells = cols * rows;
        const useReducedSafeZone = totalCells <= 9;

        while (minesPlaced < mineCount) {
          const x = Math.floor(Math.random() * cols);
          const y = Math.floor(Math.random() * rows);

          // Safe zone constraint: 3x3 unless board is too small, in which case just the clicked cell is safe
          const isSafe = useReducedSafeZone
            ? (x === safeX && y === safeY)
            : (Math.abs(x - safeX) <= 1 && Math.abs(y - safeY) <= 1);

          if (!grid[y][x].isMine && !isSafe) {
            grid[y][x].isMine = true;
            minesPlaced++;
          }
        }

        // Compute neighbor counts
        for (let y = 0; y < rows; y++) {
          for (let x = 0; x < cols; x++) {
            if (grid[y][x].isMine) continue;
            let count = 0;
            for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                const ny = y + dy;
                const nx = x + dx;
                if (ny >= 0 && ny < rows && nx >= 0 && nx < cols && grid[ny][nx].isMine) {
                  count++;
                }
              }
            }
            grid[y][x].neighborMines = count;
          }
        }
      }

      function checkWinCondition() {
        for (let y = 0; y < rows; y++) {
          for (let x = 0; x < cols; x++) {
            if (!grid[y][x].isMine && !grid[y][x].isRevealed) {
              return false;
            }
          }
        }
        return true;
      }

      const cleanup = () => {
        clearInterval(timerInterval);
        document.removeEventListener('keydown', keyHandler);
        boardContainer.removeEventListener('click', handleMouseClick);
        boardContainer.removeEventListener('contextmenu', handleMouseRightClick);
        shell.loginState = 'LOGGED_IN';
      };

      const finishGame = () => {
        cleanup();

        // Print final score/outcome
        if (gameWon) {
          shell.print(`Victory! Board cleared in ${elapsedSeconds} seconds.`, 'color-green');

          if (difficultyPreset && difficultyPreset !== 'custom') {
            const bestTimeKey = `minesweeper_best_${difficultyPreset}`;
            const previousBest = localStorage.getItem(bestTimeKey);
            if (!previousBest || elapsedSeconds < parseInt(previousBest, 10)) {
              localStorage.setItem(bestTimeKey, elapsedSeconds.toString());
              shell.print(`NEW BEST TIME for ${difficultyPreset.toUpperCase()}: ${elapsedSeconds} seconds!`, 'color-accent');
            }
          }
        } else if (shell.abortSignal) {
          shell.print('Minesweeper interrupted.', 'color-dim');
        } else {
          shell.print('Game Over! You triggered a mine.', 'color-error');
        }

        resolve();
      };

      function revealCell(x, y) {
        if (x < 0 || x >= cols || y < 0 || y >= rows) return;
        const cell = grid[y][x];
        if (cell.isRevealed || cell.isFlagged) return;

        if (firstClick) {
          firstClick = false;
          initMines(x, y);
          startTime = Date.now();
        }

        cell.isRevealed = true;

        if (cell.isMine) {
          gameOver = true;
          audio.playBeep(150, 30, 0.5, 'sawtooth', 0.25);
          // Reveal all mines
          for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
              if (grid[r][c].isMine) grid[r][c].isRevealed = true;
            }
          }
          drawBoard();
          finishGame();
          return;
        }

        audio.playBeep(600, 300, 0.08, 'square', 0.15);

        // Zero propagation (Iterative to avoid stack overflow)
        if (cell.neighborMines === 0) {
          const queue = [{ x, y }];
          while (queue.length > 0) {
            const current = queue.shift();
            for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                const nx = current.x + dx;
                const ny = current.y + dy;
                if (nx >= 0 && nx < cols && ny >= 0 && ny < rows) {
                  const neighbor = grid[ny][nx];
                  if (!neighbor.isRevealed && !neighbor.isFlagged && !neighbor.isMine) {
                    neighbor.isRevealed = true;
                    if (neighbor.neighborMines === 0) {
                      queue.push({ x: nx, y: ny });
                    }
                  }
                }
              }
            }
          }
        }

        if (checkWinCondition()) {
          gameWon = true;
          gameOver = true;
          audio.playMelody([
            { f: 523.25, dur: 0.06, delay: 0.00 },
            { f: 659.25, dur: 0.06, delay: 0.05 },
            { f: 783.99, dur: 0.06, delay: 0.10 },
            { f: 1046.50, dur: 0.06, delay: 0.15 }
          ], 'square', 0.1);
          drawBoard();
          finishGame();
        }
      }

      function toggleFlag(x, y) {
        if (x < 0 || x >= cols || y < 0 || y >= rows) return;
        const cell = grid[y][x];
        if (cell.isRevealed) return;

        cell.isFlagged = !cell.isFlagged;
        flagsCount += cell.isFlagged ? 1 : -1;
        audio.playBeep(880, 880, 0.08, 'sine', 0.15);
      }

      function drawBoard() {
        // Draw Header
        const minesLeft = Math.max(0, mineCount - flagsCount);
        headerContainer.innerHTML = ` Mines: <span class="red">${minesLeft}</span> ║ Time: <span class="yellow">${elapsedSeconds}</span>s\n`;

        // Draw Grid
        let boardText = '┌' + '──'.repeat(cols) + '─┐\n';
        for (let y = 0; y < rows; y++) {
          let line = '│ ';
          for (let x = 0; x < cols; x++) {
            const cell = grid[y][x];
            const isCursor = (x === cursorX && y === cursorY);
            let cellHTML = '';

            if (cell.isRevealed) {
              if (cell.isMine) {
                cellHTML = '<span class="red">*</span> ';
              } else if (cell.neighborMines > 0) {
                const colorClass = numberColors[cell.neighborMines] || 'white';
                cellHTML = `<span class="${colorClass}">${cell.neighborMines}</span> `;
              } else {
                cellHTML = '<span class="color-dim">.</span> ';
              }
            } else if (cell.isFlagged) {
              cellHTML = '<span class="red">F</span> ';
            } else {
              cellHTML = '# ';
            }

            // Add cell container with interaction details
            const highlightClass = isCursor ? ' style="background-color: rgba(255,255,255,0.2); font-weight: bold;"' : '';
            line += `<span class="ms-cell" data-x="${x}" data-y="${y}"${highlightClass} style="cursor: pointer;">${cellHTML}</span>`;
          }
          line += '│\n';
          boardText += line;
        }
        boardText += '└' + '──'.repeat(cols) + '─┘\n';
        boardContainer.innerHTML = boardText;

        // Draw interactive bottom toolbar for Touch/Mobile
        let controlsHTML = '';
        const modeColorClass = touchFlagMode ? 'red' : 'blue';
        const modeText = touchFlagMode ? 'FLAG (F)' : 'DIG (reveal)';
        controlsHTML += `MODE: <span id="ms-mode-toggle" class="cmd-link ${modeColorClass}" style="text-decoration: underline; font-weight: bold; cursor: pointer;">${modeText}</span>  `;
        controlsHTML += `<span class="color-dim">(Taps perform active mode)</span>\n\n`;
        controlsHTML += ` Controls: [Arrows]/[WASD] to move, [Enter]/[Space] to Dig, [F]/[M] to Flag. [Q] to quit.\n`;
        controlContainer.innerHTML = controlsHTML;

        shell.body.scrollTop = shell.body.scrollHeight;
      }

      drawBoard();

      // Timer Interval that also checks cancellation
      const timerInterval = setInterval(() => {
        if (shell.abortSignal) {
          finishGame();
          return;
        }
        if (startTime && !gameOver) {
          elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
          drawBoard();
        }
      }, 500);

      // Keyboard handlers
      const keyHandler = (e) => {
        if (shell.loginState !== 'GAME' || gameOver) return;
        const key = e.key.toLowerCase();

        if (key === 'q') {
          e.preventDefault();
          gameOver = true;
          drawBoard();
          finishGame();
          return;
        }

        let moved = false;
        if (key === 'arrowup' || key === 'w') {
          e.preventDefault();
          if (cursorY > 0) { cursorY--; moved = true; }
        } else if (key === 'arrowdown' || key === 's') {
          e.preventDefault();
          if (cursorY < rows - 1) { cursorY++; moved = true; }
        } else if (key === 'arrowleft' || key === 'a') {
          e.preventDefault();
          if (cursorX > 0) { cursorX--; moved = true; }
        } else if (key === 'arrowright' || key === 'd') {
          e.preventDefault();
          if (cursorX < cols - 1) { cursorX++; moved = true; }
        } else if (e.key === ' ' || key === 'enter') {
          e.preventDefault();
          revealCell(cursorX, cursorY);
          moved = true;
        } else if (key === 'f' || key === 'm') {
          e.preventDefault();
          toggleFlag(cursorX, cursorY);
          moved = true;
        }

        if (moved) {
          drawBoard();
        }
      };
      document.addEventListener('keydown', keyHandler);

      // Mouse handlers (Event Delegation on Board Container)
      const handleMouseClick = (e) => {
        if (gameOver) return;
        const cellElement = e.target.closest('.ms-cell');
        if (!cellElement) return;

        const x = parseInt(cellElement.getAttribute('data-x'), 10);
        const y = parseInt(cellElement.getAttribute('data-y'), 10);
        cursorX = x;
        cursorY = y;

        e.preventDefault();

        if (touchFlagMode) {
          toggleFlag(x, y);
        } else {
          revealCell(x, y);
        }
        drawBoard();
      };

      const handleMouseRightClick = (e) => {
        if (gameOver) return;
        const cellElement = e.target.closest('.ms-cell');
        if (!cellElement) return;

        e.preventDefault();
        e.stopPropagation();

        const x = parseInt(cellElement.getAttribute('data-x'), 10);
        const y = parseInt(cellElement.getAttribute('data-y'), 10);
        cursorX = x;
        cursorY = y;

        toggleFlag(x, y);
        drawBoard();
      };

      boardContainer.addEventListener('click', handleMouseClick);
      boardContainer.addEventListener('contextmenu', handleMouseRightClick);
    });
  }
};
