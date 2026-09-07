import { audio } from '../../audio.js';

export const tetris = {
  name: 'tetris',
  description: 'Play a game of Tetris.',
  category: 'game',
  lazy: true,
  args: [],
  run: async (args, shell) => {
    // Enter gameplay state
    shell.loginState = 'GAME';

    const highscoreKey = 'tetris_highscore';
    let highscore = parseInt(localStorage.getItem(highscoreKey) || '0', 10);

    return new Promise((resolve) => {

      const COLS = 10;
      const ROWS = 20;

      const SHAPES = {
        I: [
          [0, 0, 0, 0],
          [1, 1, 1, 1],
          [0, 0, 0, 0],
          [0, 0, 0, 0]
        ],
        O: [
          [1, 1],
          [1, 1]
        ],
        T: [
          [0, 1, 0],
          [1, 1, 1],
          [0, 0, 0]
        ],
        S: [
          [0, 1, 1],
          [1, 1, 0],
          [0, 0, 0]
        ],
        Z: [
          [1, 1, 0],
          [0, 1, 1],
          [0, 0, 0]
        ],
        J: [
          [1, 0, 0],
          [1, 1, 1],
          [0, 0, 0]
        ],
        L: [
          [0, 0, 1],
          [1, 1, 1],
          [0, 0, 0]
        ]
      };

      const COLORS = {
        I: '#00f0f0', // Cyan
        O: '#f0f000', // Yellow
        T: '#a000f0', // Purple
        S: '#00f000', // Green
        Z: '#f00000', // Red
        J: '#0000f0', // Blue
        L: '#f0a000'  // Orange
      };

      // Game state parameters
      let board = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
      let score = 0;
      let linesCleared = 0;
      let level = 1;
      let gameOver = false;
      let holdPiece = null;
      let canHold = true;

      // Piece Management
      const pieceTypes = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
      function getRandomPiece() {
        const type = pieceTypes[Math.floor(Math.random() * pieceTypes.length)];
        return {
          type: type,
          matrix: JSON.parse(JSON.stringify(SHAPES[type]))
        };
      }

      let activePiece = getRandomPiece();
      let activePieceX = Math.floor((COLS - activePiece.matrix[0].length) / 2);
      let activePieceY = 0;
      let nextPiece = getRandomPiece();

      const gameContainer = document.createElement('pre');
      gameContainer.style.fontFamily = 'monospace';
      gameContainer.style.lineHeight = '1.15';
      gameContainer.style.color = 'var(--text-color)';
      shell.output.appendChild(gameContainer);

      function drawTetris() {
        let screen = '';

        // Calculate ghost piece Y coordinate (projection)
        let ghostY = Math.floor(activePieceY);
        if (activePiece) {
          while (!checkCollision(activePiece.matrix, activePieceX, ghostY + 1)) {
            ghostY++;
          }
        }

        // Helper to render centered preview row inside an 8-character-wide box
        function getPreviewRow(piece, rowIndex) {
          if (!piece) return '        '; // 8 spaces
          const shapeMatrix = SHAPES[piece.type];
          const size = shapeMatrix.length;

          let targetMatrixRow = -1;
          if (size === 2) {
            // Center vertically: row 0 is empty, row 1 is matrix row 0, row 2 is matrix row 1
            if (rowIndex === 1) targetMatrixRow = 0;
            if (rowIndex === 2) targetMatrixRow = 1;
          } else if (size === 3) {
            targetMatrixRow = rowIndex;
          } else if (size === 4) {
            // I piece: only row 1 has blocks. Put it in rowIndex 1.
            if (rowIndex === 1) targetMatrixRow = 1;
          }

          if (targetMatrixRow === -1 || targetMatrixRow >= size) {
            return '        ';
          }

          let rowStr = '';
          let padding = '';
          if (size === 2) padding = '  '; // (8 - 4) / 2 = 2 spaces
          else if (size === 3) padding = ' '; // (8 - 6) / 2 = 1 space
          else if (size === 4) padding = ''; // (8 - 8) / 2 = 0 spaces

          rowStr += padding;
          for (let c = 0; c < size; c++) {
            if (shapeMatrix[targetMatrixRow][c]) {
              rowStr += `<span style="color: ${COLORS[piece.type]};">██</span>`;
            } else {
              rowStr += '  ';
            }
          }
          rowStr += padding;
          return rowStr;
        }

        // Top boundary line
        screen += '┌' + '──'.repeat(COLS) + '┐  ┌────────┐\n';

        // Main board rows (20 rows)
        for (let y = 0; y < ROWS; y++) {
          let line = '│';
          for (let x = 0; x < COLS; x++) {
            let hasUpper = false;
            let hasLower = false;
            let activeColor = null;

            if (activePiece) {
              for (let pr = 0; pr < activePiece.matrix.length; pr++) {
                for (let pc = 0; pc < activePiece.matrix[pr].length; pc++) {
                  if (activePiece.matrix[pr][pc]) {
                    const targetX = activePieceX + pc;
                    if (targetX === x) {
                      const diff = y - (activePieceY + pr);
                      if (diff === 0) {
                        hasUpper = true;
                        hasLower = true;
                        activeColor = COLORS[activePiece.type];
                      } else if (diff === 0.5) {
                        hasUpper = true;
                        activeColor = COLORS[activePiece.type];
                      } else if (diff === -0.5) {
                        hasLower = true;
                        activeColor = COLORS[activePiece.type];
                      }
                    }
                  }
                }
              }
            }

            // Check if this cell is occupied by the ghost piece projection
            let isGhost = false;
            if (activePiece && !hasUpper && !hasLower) {
              const pr = y - ghostY;
              const pc = x - activePieceX;
              if (pr >= 0 && pr < activePiece.matrix.length && pc >= 0 && pc < activePiece.matrix[pr].length) {
                if (activePiece.matrix[pr][pc]) {
                  isGhost = true;
                }
              }
            }

            if (hasUpper && hasLower) {
              line += `<span style="color: ${activeColor};">██</span>`;
            } else if (hasUpper) {
              line += `<span style="color: ${activeColor};">▀▀</span>`;
            } else if (hasLower) {
              line += `<span style="color: ${activeColor};">▄▄</span>`;
            } else if (isGhost) {
              line += `<span style="color: ${COLORS[activePiece.type]}; opacity: 0.75;">▒▒</span>`;
            } else if (board[y][x]) {
              line += `<span style="color: ${COLORS[board[y][x]]};">██</span>`;
            } else {
              line += '  '; // Empty grid space (double width)
            }
          }
          line += '│';

          // Side preview & score panel
          let sideInfo = '';
          if (y === 0) {
            sideInfo = '  │  NEXT  │';
          } else if (y >= 1 && y <= 3) {
            sideInfo = '  │' + getPreviewRow(nextPiece, y - 1) + '│';
          } else if (y === 4) {
            sideInfo = '  └────────┘';
          } else if (y === 5) {
            sideInfo = '  ┌────────┐';
          } else if (y === 6) {
            sideInfo = '  │  HOLD  │';
          } else if (y >= 7 && y <= 9) {
            sideInfo = '  │' + getPreviewRow(holdPiece, y - 7) + '│';
          } else if (y === 10) {
            sideInfo = '  └────────┘';
          } else if (y === 11) {
            sideInfo = `  SCORE     `;
          } else if (y === 12) {
            sideInfo = `  <span class="color-accent">${String(score).padStart(6, '0')}</span>`;
          } else if (y === 13) {
            sideInfo = `  HI-SCORE  `;
          } else if (y === 14) {
            sideInfo = `  <span class="yellow">${String(highscore).padStart(6, '0')}</span>`;
          } else if (y === 15) {
            sideInfo = `  LINES     `;
          } else if (y === 16) {
            sideInfo = `  <span class="color-accent">${linesCleared}</span>`;
          } else if (y === 17) {
            sideInfo = `  LEVEL     `;
          } else if (y === 18) {
            sideInfo = `  <span class="color-accent">${level}</span>`;
          } else if (y === 19) {
            sideInfo = `  C:Hold/Up:Rot/Space:Drop`;
          }

          line += sideInfo + '\n';
          screen += line;
        }

        // Bottom boundary line
        screen += '└' + '──'.repeat(COLS) + '┘  [Q] to Quit\n';

        gameContainer.innerHTML = screen;
        shell.body.scrollTop = shell.body.scrollHeight;
      }

      drawTetris();

      // Check collision against borders or filled blocks
      function checkCollision(pieceMatrix, xOffset, yOffset) {
        for (let r = 0; r < pieceMatrix.length; r++) {
          for (let c = 0; c < pieceMatrix[r].length; c++) {
            if (pieceMatrix[r][c]) {
              const nextX = xOffset + c;
              if (nextX < 0 || nextX >= COLS) {
                return true;
              }
              const row1 = Math.floor(yOffset) + r;
              const row2 = Math.ceil(yOffset) + r;

              if (row2 >= ROWS) {
                return true;
              }
              if (row1 >= 0 && board[row1][nextX] !== null) {
                return true;
              }
              if (row2 >= 0 && board[row2][nextX] !== null) {
                return true;
              }
            }
          }
        }
        return false;
      }

      // Transpose and reverse matrix to rotate clockwise
      function rotatePiece(pieceMatrix) {
        const n = pieceMatrix.length;
        const rotated = Array.from({ length: n }, () => Array(n).fill(0));
        for (let r = 0; r < n; r++) {
          for (let c = 0; c < n; c++) {
            rotated[c][n - 1 - r] = pieceMatrix[r][c];
          }
        }
        return rotated;
      }

      // Merge piece into board grid
      function mergePiece() {
        for (let r = 0; r < activePiece.matrix.length; r++) {
          for (let c = 0; c < activePiece.matrix[r].length; c++) {
            if (activePiece.matrix[r][c]) {
              const boardY = Math.round(activePieceY) + r;
              const boardX = activePieceX + c;
              if (boardY >= 0 && boardY < ROWS && boardX >= 0 && boardX < COLS) {
                board[boardY][boardX] = activePiece.type;
              }
            }
          }
        }
      }

      // Clear filled rows, increment scores and levels
      function clearRows() {
        let rowsToClear = [];
        for (let y = 0; y < ROWS; y++) {
          if (board[y].every(cell => cell !== null)) {
            rowsToClear.push(y);
          }
        }

        if (rowsToClear.length > 0) {
          // Remove filled rows and insert empty rows at the top
          board = board.filter((_, idx) => !rowsToClear.includes(idx));
          while (board.length < ROWS) {
            board.unshift(Array(COLS).fill(null));
          }

          // Standard Tetris scoring
          const rowScores = [0, 100, 300, 500, 800];
          score += rowScores[rowsToClear.length] * level;
          linesCleared += rowsToClear.length;

          // Level up every 10 lines
          const newLevel = Math.floor(linesCleared / 10) + 1;
          if (newLevel > level) {
            level = newLevel;
            audio.playMelody([
              { f: 523.25, dur: 0.08, delay: 0.00 },
              { f: 659.25, dur: 0.08, delay: 0.08 },
              { f: 783.99, dur: 0.08, delay: 0.16 },
              { f: 1046.50, dur: 0.08, delay: 0.24 },
              { f: 1318.51, dur: 0.40, delay: 0.32 }
            ], 'square', 0.12);
          } else {
            audio.playMelody([
              { f: 523.25, endF: 523.25 * 1.05, dur: 0.05, delay: 0.00 },
              { f: 659.25, endF: 659.25 * 1.05, dur: 0.05, delay: 0.04 },
              { f: 783.99, endF: 783.99 * 1.05, dur: 0.05, delay: 0.08 },
              { f: 1046.50, endF: 1046.50 * 1.05, dur: 0.05, delay: 0.12 },
              { f: 1318.51, endF: 1318.51 * 1.05, dur: 0.05, delay: 0.16 },
              { f: 1567.98, endF: 1567.98 * 1.05, dur: 0.05, delay: 0.20 }
            ], 'square', 0.1);
          }
        }
      }

      // Game loop tick function
      function tick() {
        if (gameOver) return;

        if (!checkCollision(activePiece.matrix, activePieceX, activePieceY + 0.5)) {
          activePieceY += 0.5;
        } else {
          mergePiece();
          audio.playBeep(90, 50, 0.1, 'triangle', 0.2);
          clearRows();

          // Spawn next piece
          activePiece = nextPiece;
          activePieceX = Math.floor((COLS - activePiece.matrix[0].length) / 2);
          activePieceY = 0;
          nextPiece = getRandomPiece();
          canHold = true;

          // Check immediate spawn collision (Game Over)
          if (checkCollision(activePiece.matrix, activePieceX, activePieceY)) {
            gameOver = true;
            audio.playMelody([
              { f: 261.63, dur: 0.18, delay: 0.00 },
              { f: 246.94, dur: 0.18, delay: 0.18 },
              { f: 233.08, dur: 0.18, delay: 0.36 },
              { f: 220.00, endF: 60, dur: 0.60, delay: 0.54 }
            ], 'sawtooth', 0.1);
          }
        }
        drawTetris();
      }

      // Game timer interval details
      let tickInterval = 800;
      let lastTime = Date.now();
      let animationId = null;

      function gameLoop() {
        if (gameOver || shell.abortSignal) {
          cancelAnimationFrame(animationId);
          cleanup();
          return;
        }

        const now = Date.now();
        const speed = Math.max(100, 800 - (level - 1) * 80); // Speed increases with levels
        if (now - lastTime >= speed / 2) {
          tick();
          lastTime = now;
        }
        animationId = requestAnimationFrame(gameLoop);
      }

      // Keyboard controls handler
      const keyHandler = (e) => {
        if (shell.loginState === 'GAME' && !gameOver) {
          if (e.key === 'ArrowLeft') {
            e.preventDefault();
            if (!checkCollision(activePiece.matrix, activePieceX - 1, activePieceY)) {
              activePieceX--;
              audio.playBeep(130, 80, 0.03, 'triangle', 0.15);
              drawTetris();
            }
          } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            if (!checkCollision(activePiece.matrix, activePieceX + 1, activePieceY)) {
              activePieceX++;
              audio.playBeep(130, 80, 0.03, 'triangle', 0.15);
              drawTetris();
            }
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (!checkCollision(activePiece.matrix, activePieceX, activePieceY + 0.5)) {
              activePieceY += 0.5;
              score += 1; // Soft drop points
              audio.playBeep(130, 80, 0.03, 'triangle', 0.15);
              drawTetris();
            }
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            const rotated = rotatePiece(activePiece.matrix);
            // Standard rotation check, with offset check (basic wall kick)
            let rotatedOk = false;
            if (!checkCollision(rotated, activePieceX, activePieceY)) {
              activePiece.matrix = rotated;
              rotatedOk = true;
            } else if (!checkCollision(rotated, activePieceX - 1, activePieceY)) {
              activePieceX--;
              activePiece.matrix = rotated;
              rotatedOk = true;
            } else if (!checkCollision(rotated, activePieceX + 1, activePieceY)) {
              activePieceX++;
              activePiece.matrix = rotated;
              rotatedOk = true;
            }
            if (rotatedOk) {
              audio.playBeep(300, 450, 0.06, 'triangle', 0.15);
              drawTetris();
            }
          } else if (e.key === ' ') {
            e.preventDefault();
            // Hard drop
            let dropHeight = 0;
            let nextY = Math.floor(activePieceY);
            while (!checkCollision(activePiece.matrix, activePieceX, nextY + 1)) {
              nextY++;
              dropHeight++;
            }
            activePieceY = nextY;
            score += dropHeight * 2; // Hard drop points
            tick();
          } else if (e.key === 'c' || e.key === 'C' || e.key === 'Shift') {
            e.preventDefault();
            if (canHold) {
              canHold = false;
              const currentType = activePiece.type;
              if (!holdPiece) {
                holdPiece = {
                  type: currentType,
                  matrix: JSON.parse(JSON.stringify(SHAPES[currentType]))
                };
                activePiece = nextPiece;
                nextPiece = getRandomPiece();
              } else {
                const temp = holdPiece;
                holdPiece = {
                  type: currentType,
                  matrix: JSON.parse(JSON.stringify(SHAPES[currentType]))
                };
                activePiece = temp;
              }
              activePieceX = Math.floor((COLS - activePiece.matrix[0].length) / 2);
              activePieceY = 0;
              audio.playBeep(300, 450, 0.06, 'triangle', 0.15);
              // Check immediate spawn collision (Game Over)
              if (checkCollision(activePiece.matrix, activePieceX, activePieceY)) {
                gameOver = true;
                audio.playMelody([
                  { f: 261.63, dur: 0.18, delay: 0.00 },
                  { f: 246.94, dur: 0.18, delay: 0.18 },
                  { f: 233.08, dur: 0.18, delay: 0.36 },
                  { f: 220.00, endF: 60, dur: 0.60, delay: 0.54 }
                ], 'sawtooth', 0.1);
              }
              drawTetris();
            }
          } else if (e.key === 'q' || e.key === 'Q') {
            e.preventDefault();
            gameOver = true;
          }
        }
      };

      document.addEventListener('keydown', keyHandler);
      animationId = requestAnimationFrame(gameLoop);

      // End game cleanup
      function cleanup() {
        document.removeEventListener('keydown', keyHandler);
        shell.loginState = 'LOGGED_IN';

        if (shell.abortSignal) {
          shell.print('Tetris interrupted.', 'color-dim');
        } else {
          if (score > highscore) {
            localStorage.setItem(highscoreKey, score.toString());
            shell.print('NEW HIGH SCORE!', 'color-green');
          } else {
            shell.print('--- GAME OVER ---', 'color-error');
          }
          shell.print(`Final Score: <span class="color-accent">${score}</span>`);
          shell.print(`Lines Cleared: <span class="color-accent">${linesCleared}</span>`);
        }
        resolve();
      }
    });
  }
};
