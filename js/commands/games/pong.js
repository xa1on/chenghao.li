import { audio } from '../../audio.js?v=38beffc128';

export const pong = {
  name: 'pong',
  description: 'Play a game of Pong.',
  category: 'game',
  lazy: true,
  args: [
    { name: 'difficulty', description: 'Difficulty level (easy, medium, hard).', required: false, suggestions: ['easy', 'medium', 'hard'] }
  ],
  run: async (args, shell) => {
    let diffText = args.length > 0 ? args[0].toLowerCase() : '';

    // Choose difficulty if none specified or invalid
    while (diffText !== 'easy' && diffText !== 'medium' && diffText !== 'hard' && diffText !== '1' && diffText !== '2' && diffText !== '3') {
      shell.print('Select difficulty:\n  [1] Easy\n  [2] Medium\n  [3] Hard');
      const response = await shell.readInput('Choose difficulty (1-3): ');
      if (response === null) {
        shell.print('Pong cancelled.', 'color-dim');
        return;
      }
      diffText = response.trim().toLowerCase();
      if (diffText === '') {
        shell.print('Pong cancelled.', 'color-dim');
        return;
      }
    }

    let difficulty = 'easy';
    if (diffText === '2' || diffText === 'medium') difficulty = 'medium';
    if (diffText === '3' || diffText === 'hard') difficulty = 'hard';

    // Enter generic gameplay state
    shell.loginState = 'GAME';

    // Scoped game state variables (Scaled speeds for 40ms intervals)
    const pongGame = {
      playerY: 4,
      cpuY: 4,
      ballX: 22,
      ballY: 5,
      ballDx: Math.random() > 0.5 ? 0.5 : -0.5,
      ballDy: Math.random() > 0.5 ? 0.25 : -0.25,
      playerScore: 0,
      cpuScore: 0,
      boardWidth: 44,
      boardHeight: 12,
      paddleHeight: 3,
      difficulty: difficulty,
      gameOver: false
    };

    const gameContainer = document.createElement('pre');
    gameContainer.style.fontFamily = 'monospace';
    gameContainer.style.lineHeight = '1.15';
    gameContainer.style.color = 'var(--text-color)';
    shell.output.appendChild(gameContainer);

    function drawPong() {
      let board = '';
      const width = pongGame.boardWidth;
      const height = pongGame.boardHeight;

      board += '┌' + '─'.repeat(width) + '┐\n';

      for (let y = 0; y < height; y++) {
        let line = '<span class="color-dim">│</span>';
        for (let x = 0; x < width; x++) {
          const topY = y + 0.25;
          const bottomY = y + 0.75;

          // Left paddle occupancy
          const leftTop = (x === 1) && (topY >= pongGame.playerY && topY < pongGame.playerY + pongGame.paddleHeight);
          const leftBottom = (x === 1) && (bottomY >= pongGame.playerY && bottomY < pongGame.playerY + pongGame.paddleHeight);

          // Right paddle occupancy
          const rightTop = (x === width - 2) && (topY >= pongGame.cpuY && topY < pongGame.cpuY + pongGame.paddleHeight);
          const rightBottom = (x === width - 2) && (bottomY >= pongGame.cpuY && bottomY < pongGame.cpuY + pongGame.paddleHeight);

          // Ball occupancy (rounded to nearest half-row index to prevent flashing)
          const ballXMatch = (x === Math.round(pongGame.ballX));
          const ballRoundHalfY = Math.round(pongGame.ballY * 2);
          const ballTop = ballXMatch && (ballRoundHalfY === y * 2);
          const ballBottom = ballXMatch && (ballRoundHalfY === y * 2 + 1);

          let topType = null;
          if (leftTop || rightTop) topType = 'paddle';
          else if (ballTop) topType = 'ball';

          let bottomType = null;
          if (leftBottom || rightBottom) bottomType = 'paddle';
          else if (ballBottom) bottomType = 'ball';

          let cellChar = ' ';
          if (topType && bottomType) {
            const type = (topType === 'ball' || bottomType === 'ball') ? 'ball' : 'paddle';
            cellChar = type === 'ball' ? '<span class="red">█</span>' : '<span class="blue">█</span>';
          } else if (topType) {
            cellChar = topType === 'ball' ? '<span class="red">▀</span>' : '<span class="blue">▀</span>';
          } else if (bottomType) {
            cellChar = bottomType === 'ball' ? '<span class="red">▄</span>' : '<span class="blue">▄</span>';
          }
          line += cellChar;
        }
        line += '<span class="color-dim">│</span>\n';
        board += line;
      }

      board += '└' + '─'.repeat(width) + '┘\n';
      board += ` Score: Player ${pongGame.playerScore} ║ CPU ${pongGame.cpuScore}   (Difficulty: ${pongGame.difficulty.toUpperCase()})\n`;
      board += ` Controls: [ArrowUp]/[ArrowDown] to move. Press [Q] to quit.\n`;

      gameContainer.innerHTML = board;
      shell.body.scrollTop = shell.body.scrollHeight;
    }

    drawPong();

    function resetBall(direction) {
      pongGame.ballX = Math.floor(pongGame.boardWidth / 2);
      pongGame.ballY = Math.floor(pongGame.boardHeight / 2);
      pongGame.ballDx = direction * 0.5;
      pongGame.ballDy = Math.random() > 0.5 ? 0.25 : -0.25;
    }

    // Attach key listener globally during gameplay
    const keyHandler = (e) => {
      if (shell.loginState === 'GAME') {
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          pongGame.playerY = Math.max(0, pongGame.playerY - 0.5);
          drawPong();
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          pongGame.playerY = Math.min(pongGame.boardHeight - pongGame.paddleHeight, pongGame.playerY + 0.5);
          drawPong();
        } else if (e.key === 'q' || e.key === 'Q') {
          e.preventDefault();
          pongGame.gameOver = true;
        }
      }
    };
    document.addEventListener('keydown', keyHandler);

    await new Promise((resolve) => {
      const gameInterval = setInterval(() => {
        if (pongGame.gameOver || shell.abortSignal) {
          clearInterval(gameInterval);
          resolve();
          return;
        }

        // Move Ball
        pongGame.ballX += pongGame.ballDx;
        pongGame.ballY += pongGame.ballDy;

        // Bounce top/bottom
        if (pongGame.ballY <= 0) {
          pongGame.ballY = 0;
          pongGame.ballDy = -pongGame.ballDy;
          audio.playBeep(450, 250, 0.06, 'square', 0.12);
        } else if (pongGame.ballY >= pongGame.boardHeight - 1) {
          pongGame.ballY = pongGame.boardHeight - 1;
          pongGame.ballDy = -pongGame.ballDy;
          audio.playBeep(450, 250, 0.06, 'square', 0.12);
        }

        // Left paddle collision
        if (pongGame.ballX <= 2 && pongGame.ballDx < 0) {
          if (pongGame.ballY >= pongGame.playerY && pongGame.ballY < pongGame.playerY + pongGame.paddleHeight) {
            pongGame.ballX = 2;
            pongGame.ballDx = 0.5;
            const hitPos = pongGame.ballY - pongGame.playerY;
            if (hitPos < 1.0) pongGame.ballDy = -0.4;
            else if (hitPos >= 2.0) pongGame.ballDy = 0.4;
            else pongGame.ballDy = (Math.random() > 0.5 ? 0.2 : -0.2);
            audio.playBeep(600, 300, 0.08, 'square', 0.15);
          }
        }

        // Right paddle collision
        if (pongGame.ballX >= pongGame.boardWidth - 3 && pongGame.ballDx > 0) {
          if (pongGame.ballY >= pongGame.cpuY && pongGame.ballY < pongGame.cpuY + pongGame.paddleHeight) {
            pongGame.ballX = pongGame.boardWidth - 3;
            pongGame.ballDx = -0.5;
            const hitPos = pongGame.ballY - pongGame.cpuY;
            if (hitPos < 1.0) pongGame.ballDy = -0.4;
            else if (hitPos >= 2.0) pongGame.ballDy = 0.4;
            else pongGame.ballDy = (Math.random() > 0.5 ? 0.2 : -0.2);
            audio.playBeep(600, 300, 0.08, 'square', 0.15);
          }
        }

        // CPU AI movement (Granular tracking)
        const ballTarget = pongGame.ballY;
        const cpuCenter = pongGame.cpuY + 1.5; // Center of 3-tall paddle
        let moveProbability = 0.45;
        if (pongGame.difficulty === 'medium') moveProbability = 0.70;
        if (pongGame.difficulty === 'hard') moveProbability = 0.92;

        if (Math.random() < moveProbability) {
          if (cpuCenter < ballTarget) {
            pongGame.cpuY = Math.min(pongGame.boardHeight - pongGame.paddleHeight, pongGame.cpuY + 0.25);
          } else if (cpuCenter > ballTarget) {
            pongGame.cpuY = Math.max(0, pongGame.cpuY - 0.25);
          }
        }

        // Point scoring
        if (pongGame.ballX < 0) {
          pongGame.cpuScore++;
          if (pongGame.cpuScore >= 5) {
            pongGame.gameOver = true;
          } else {
            audio.playBeep(220, 80, 0.35, 'sawtooth', 0.12);
            resetBall(1);
          }
        } else if (pongGame.ballX >= pongGame.boardWidth) {
          pongGame.playerScore++;
          if (pongGame.playerScore >= 5) {
            pongGame.gameOver = true;
          } else {
            audio.playMelody([
              { f: 523.25, dur: 0.06, delay: 0.00 },
              { f: 659.25, dur: 0.06, delay: 0.05 },
              { f: 783.99, dur: 0.06, delay: 0.10 },
              { f: 1046.50, dur: 0.06, delay: 0.15 }
            ], 'square', 0.1);
            resetBall(-1);
          }
        }

        drawPong();
      }, 40);
    });

    // Cleanup listeners and restore state
    document.removeEventListener('keydown', keyHandler);
    shell.loginState = 'LOGGED_IN';

    if (pongGame.playerScore >= 5) {
      audio.playMelody([
        { f: 523.25, dur: 0.08, delay: 0.00 },
        { f: 659.25, dur: 0.08, delay: 0.08 },
        { f: 783.99, dur: 0.08, delay: 0.16 },
        { f: 1046.50, dur: 0.08, delay: 0.24 },
        { f: 1318.51, dur: 0.40, delay: 0.32 }
      ], 'square', 0.12); // Victory chime
      shell.print('Congratulations! You won the match!', 'color-green');
    } else if (pongGame.cpuScore >= 5) {
      audio.playMelody([
        { f: 261.63, dur: 0.18, delay: 0.00 },
        { f: 246.94, dur: 0.18, delay: 0.18 },
        { f: 233.08, dur: 0.18, delay: 0.36 },
        { f: 220.00, endF: 60, dur: 0.60, delay: 0.54 }
      ], 'sawtooth', 0.1); // Loss chime
      shell.print('Game Over! The CPU won the match.', 'color-error');
    } else if (shell.abortSignal) {
      shell.print('Pong game interrupted.', 'color-dim');
    } else {
      shell.print('Pong game terminated.', 'color-dim');
    }
  }
};
