import { audio } from '../../audio.js?v=38beffc128';

export const snake = {
  name: 'snake',
  description: 'Play a game of Snake.',
  category: 'game',
  lazy: true,
  args: [
    { name: 'difficulty', description: 'Difficulty level (easy, medium, hard).', required: false, suggestions: ['easy', 'medium', 'hard'] }
  ],
  run: async (args, shell) => {
    let diffText = args.length > 0 ? args[0].toLowerCase() : '';

    const highscoreKey = 'snake_highscore';
    let highscore = parseInt(localStorage.getItem(highscoreKey) || '0', 10);

    // Prompt for difficulty if not provided or invalid
    while (diffText !== 'easy' && diffText !== 'medium' && diffText !== 'hard' && diffText !== '1' && diffText !== '2' && diffText !== '3') {
      shell.print(`--- SNAKE ---`);
      shell.print(`Personal High Score: ${highscore}`);
      shell.print(`Select difficulty:\n  [1] Easy\n  [2] Medium\n  [3] Hard`);
      const response = await shell.readInput('Choose difficulty (1-3): ');
      if (response === null) {
        shell.print('Snake game cancelled.', 'color-dim');
        return;
      }
      diffText = response.trim().toLowerCase();
      if (diffText === '') {
        shell.print('Snake game cancelled.', 'color-dim');
        return;
      }
    }

    let difficulty = 'medium';
    let speed = 100; // interval in ms
    if (diffText === '1' || diffText === 'easy') {
      difficulty = 'easy';
      speed = 150;
    } else if (diffText === '2' || diffText === 'medium') {
      difficulty = 'medium';
      speed = 100;
    } else if (diffText === '3' || diffText === 'hard') {
      difficulty = 'hard';
      speed = 60;
    }

    // Set shell state to game
    shell.loginState = 'GAME';

    // Game state
    const width = 40;
    const height = 30; // subpixel height, 15 text characters
    const gameState = {
      snake: [
        { x: 10, y: 14 },
        { x: 9, y: 14 },
        { x: 8, y: 14 }
      ],
      dir: 'RIGHT',
      inputQueue: [],
      food: { x: 25, y: 14 },
      score: 0,
      gameOver: false
    };

    const gameContainer = document.createElement('pre');
    gameContainer.style.fontFamily = 'monospace';
    gameContainer.style.lineHeight = '1.15';
    gameContainer.style.color = 'var(--text-color)';
    shell.output.appendChild(gameContainer);

    function generateFood() {
      while (true) {
        const x = Math.floor(Math.random() * width);
        const y = Math.floor(Math.random() * height);
        // Ensure food is not on snake
        if (!gameState.snake.some(segment => segment.x === x && segment.y === y)) {
          gameState.food = { x, y };
          break;
        }
      }
    }

    function drawSnake() {
      let board = '';
      board += '┌' + '─'.repeat(width) + '┐\n';

      // 1. Create a 2D matrix representing the screen
      const screen = Array.from({ length: height }, () => Array(width).fill(null));

      // 2. Mark food
      if (gameState.food.x >= 0 && gameState.food.x < width && gameState.food.y >= 0 && gameState.food.y < height) {
        screen[gameState.food.y][gameState.food.x] = 'food';
      }

      // 3. Mark body
      for (let i = 1; i < gameState.snake.length; i++) {
        const segment = gameState.snake[i];
        if (segment.x >= 0 && segment.x < width && segment.y >= 0 && segment.y < height) {
          screen[segment.y][segment.x] = 'body';
        }
      }

      // 4. Mark head
      const head = gameState.snake[0];
      if (head.x >= 0 && head.x < width && head.y >= 0 && head.y < height) {
        screen[head.y][head.x] = 'head';
      }

      for (let r = 0; r < height / 2; r++) {
        let line = '│';
        const topY = 2 * r;
        const bottomY = 2 * r + 1;

        for (let x = 0; x < width; x++) {
          const topType = screen[topY][x];
          const bottomType = screen[bottomY][x];

          let cellChar = ' ';
          if (topType && bottomType) {
            if (topType === 'food' || bottomType === 'food') {
              cellChar = '<span class="red">█</span>';
            } else if (topType === 'head' || bottomType === 'head') {
              cellChar = '<span class="green color-dim">█</span>';
            } else {
              cellChar = '<span class="green">█</span>';
            }
          } else if (topType) {
            if (topType === 'food') {
              cellChar = '<span class="red">▀</span>';
            } else if (topType === 'head') {
              cellChar = '<span class="green color-dim">▀</span>';
            } else {
              cellChar = '<span class="green">▀</span>';
            }
          } else if (bottomType) {
            if (bottomType === 'food') {
              cellChar = '<span class="red">▄</span>';
            } else if (bottomType === 'head') {
              cellChar = '<span class="green color-dim">▄</span>';
            } else {
              cellChar = '<span class="green">▄</span>';
            }
          }
          line += cellChar;
        }
        line += '│\n';
        board += line;
      }

      board += '└' + '─'.repeat(width) + '┘\n';
      board += ` Score: ${gameState.score} ║ High Score: ${highscore} ║ Difficulty: ${difficulty.toUpperCase()}\n`;
      board += ` Controls: [ArrowKeys] or [WASD] to turn. Press [Q] to quit.\n`;

      gameContainer.innerHTML = board;
      shell.body.scrollTop = shell.body.scrollHeight;
    }

    drawSnake();

    const keyHandler = (e) => {
      if (shell.loginState === 'GAME') {
        const key = e.key.toLowerCase();

        // Prevent default scrolling for game controls
        if (['arrowup', 'w', 'arrowdown', 's', 'arrowleft', 'a', 'arrowright', 'd', ' '].includes(key)) {
          e.preventDefault();
        }

        if (key === 'q') {
          gameState.gameOver = true;
          return;
        }

        let desiredDir = null;
        if (key === 'arrowup' || key === 'w') {
          desiredDir = 'UP';
        } else if (key === 'arrowdown' || key === 's') {
          desiredDir = 'DOWN';
        } else if (key === 'arrowleft' || key === 'a') {
          desiredDir = 'LEFT';
        } else if (key === 'arrowright' || key === 'd') {
          desiredDir = 'RIGHT';
        }

        if (desiredDir) {
          const lastQueued = gameState.inputQueue.length > 0 ? gameState.inputQueue[gameState.inputQueue.length - 1] : gameState.dir;
          const opposites = { UP: 'DOWN', DOWN: 'UP', LEFT: 'RIGHT', RIGHT: 'LEFT' };

          if (desiredDir !== lastQueued && desiredDir !== opposites[lastQueued]) {
            if (gameState.inputQueue.length < 2) {
              gameState.inputQueue.push(desiredDir);
            }
          }
        }
      }
    };

    document.addEventListener('keydown', keyHandler);

    await new Promise((resolve) => {
      const loop = setInterval(() => {
        if (gameState.gameOver || shell.abortSignal) {
          clearInterval(loop);
          resolve();
          return;
        }

        if (gameState.inputQueue.length > 0) {
          gameState.dir = gameState.inputQueue.shift();
        }

        const head = { ...gameState.snake[0] };

        // Move head
        switch (gameState.dir) {
          case 'UP': head.y--; break;
          case 'DOWN': head.y++; break;
          case 'LEFT': head.x--; break;
          case 'RIGHT': head.x++; break;
        }

        // Collision check - boundary walls
        if (head.x < 0 || head.x >= width || head.y < 0 || head.y >= height) {
          gameState.gameOver = true;
          audio.playBeep(300, 80, 0.25, 'sawtooth', 0.15);
          return;
        }

        const eatsFood = (head.x === gameState.food.x && head.y === gameState.food.y);

        if (!eatsFood) {
          // Remove tail before self-collision check so snake can follow its tail
          gameState.snake.pop();
        }

        // Collision check - self body
        if (gameState.snake.some(segment => segment.x === head.x && segment.y === head.y)) {
          gameState.gameOver = true;
          audio.playBeep(300, 80, 0.25, 'sawtooth', 0.15);
          return;
        }

        // Prepend head
        gameState.snake.unshift(head);

        // Check if food eaten
        if (eatsFood) {
          gameState.score += 10;
          audio.playBeep(523.25, 1046.50, 0.08, 'triangle', 0.15);
          generateFood();
        }

        drawSnake();
      }, speed);
    });

    // Cleanup
    document.removeEventListener('keydown', keyHandler);
    shell.loginState = 'LOGGED_IN';

    // Update high score
    if (gameState.score > highscore) {
      highscore = gameState.score;
      localStorage.setItem(highscoreKey, highscore.toString());
      shell.print(`NEW HIGH SCORE! Score: ${gameState.score}`, 'color-green');
    } else {
      shell.print(`Game Over! Final Score: ${gameState.score}`, 'color-error');
    }
  }
};
