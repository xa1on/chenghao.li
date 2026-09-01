import { audio } from '../../audio.js?v=38beffc128';

export const invaders = {
  name: 'invaders',
  description: 'Play a game of Space Invaders.',
  category: 'game',
  lazy: true,
  args: [
    { name: 'difficulty', description: 'Difficulty level (easy, medium, hard).', required: false, suggestions: ['easy', 'medium', 'hard'] }
  ],
  run: async (args, shell) => {
    let diffText = args.length > 0 ? args[0].toLowerCase() : '';

    const highscoreKey = 'invaders_highscore';
    let highscore = parseInt(localStorage.getItem(highscoreKey) || '0', 10);

    // Prompt for difficulty if not provided or invalid
    while (diffText !== 'easy' && diffText !== 'medium' && diffText !== 'hard' && diffText !== '1' && diffText !== '2' && diffText !== '3') {
      shell.print(`--- SPACE INVADERS ---`);
      shell.print(`Personal High Score: ${highscore}`);
      shell.print(`Select difficulty:\n  [1] Easy\n  [2] Medium\n  [3] Hard`);
      const response = await shell.readInput('Choose difficulty (1-3): ');
      if (response === null) {
        shell.print('Space Invaders cancelled.', 'color-dim');
        return;
      }
      diffText = response.trim().toLowerCase();
      if (diffText === '') {
        shell.print('Space Invaders cancelled.', 'color-dim');
        return;
      }
    }

    let difficulty = 'medium';
    let alienMoveSpeed = 16; // Tick interval divider
    let shootFreq = 0.015;  // Alien fire rate
    if (diffText === '1' || diffText === 'easy') {
      difficulty = 'easy';
      alienMoveSpeed = 24;
      shootFreq = 0.008;
    } else if (diffText === '2' || diffText === 'medium') {
      difficulty = 'medium';
      alienMoveSpeed = 16;
      shootFreq = 0.018;
    } else if (diffText === '3' || diffText === 'hard') {
      difficulty = 'hard';
      alienMoveSpeed = 10;
      shootFreq = 0.035;
    }

    shell.loginState = 'GAME';

    const width = 44;
    const height = 30; // 15 rows of sub-pixel height

    // Game state
    const game = {
      playerX: 20,
      playerY: 28, // base y coordinate for bottom of ship
      bullets: [], // player bullets: {x, y}
      alienBullets: [], // alien bullets: {x, y}
      aliens: [],  // array of {x, y, alive}
      alienDir: 1, // 1 = Right, -1 = Left
      score: 0,
      gameOver: false,
      gameWon: false,
      tickCount: 0,
      bunkers: [] // barrier blocks: {x, y, hp}
    };

    // Create aliens grid
    const alienRows = 3;
    const alienCols = 6;
    for (let r = 0; r < alienRows; r++) {
      for (let c = 0; c < alienCols; c++) {
        game.aliens.push({
          x: c * 6 + 4,
          y: r * 4 + 2,
          alive: true
        });
      }
    }

    // Create destructible bunkers
    // 3 bunkers spaced out across width
    const bunkerPositionsX = [8, 20, 32];
    bunkerPositionsX.forEach(bx => {
      // Create a small arch of blocks at y = 22, 23
      for (let x = bx; x < bx + 5; x++) {
        game.bunkers.push({ x, y: 22, hp: 3 });
        game.bunkers.push({ x, y: 23, hp: 3 });
      }
    });

    const gameContainer = document.createElement('pre');
    gameContainer.style.fontFamily = 'monospace';
    gameContainer.style.lineHeight = '1.15';
    gameContainer.style.color = 'var(--text-color)';
    shell.output.appendChild(gameContainer);

    function drawInvaders() {
      let board = '┌' + '─'.repeat(width) + '┐\n';

      // 1. Create a 2D matrix representing the screen
      const screen = Array.from({ length: height }, () => Array(width).fill(null));

      // 2. Mark player ship (y = 27, 28)
      const px = game.playerX;
      if (px + 2 >= 0 && px + 2 < width) {
        screen[27][px + 2] = 'player';
      }
      for (let x = px; x <= px + 4; x++) {
        if (x >= 0 && x < width) {
          screen[28][x] = 'player';
        }
      }

      // 3. Mark aliens (each alien is 4x2 pixels)
      game.aliens.forEach(al => {
        if (al.alive) {
          for (let dy = 0; dy < 2; dy++) {
            for (let dx = 0; dx < 4; dx++) {
              const ax = al.x + dx;
              const ay = al.y + dy;
              if (ax >= 0 && ax < width && ay >= 0 && ay < height) {
                screen[ay][ax] = 'alien';
              }
            }
          }
        }
      });

      // 4. Mark bunkers
      game.bunkers.forEach(b => {
        if (b.hp > 0) {
          if (b.x >= 0 && b.x < width && b.y >= 0 && b.y < height) {
            screen[b.y][b.x] = 'bunker_' + b.hp;
          }
        }
      });

      // 5. Mark player bullets
      game.bullets.forEach(b => {
        const ry = Math.round(b.y);
        if (b.x >= 0 && b.x < width && ry >= 0 && ry < height) {
          screen[ry][b.x] = 'pbullet';
        }
      });

      // 6. Mark alien bullets
      game.alienBullets.forEach(b => {
        const ry = Math.round(b.y);
        if (b.x >= 0 && b.x < width && ry >= 0 && ry < height) {
          screen[ry][b.x] = 'abullet';
        }
      });

      // Render cells from screen buffer
      for (let r = 0; r < height / 2; r++) {
        let line = '│';
        const topY = 2 * r;
        const bottomY = 2 * r + 1;

        for (let x = 0; x < width; x++) {
          const topType = screen[topY][x];
          const bottomType = screen[bottomY][x];

          // Select matching sub-pixel character representation
          let cellChar = ' ';
          const getCellHTML = (type, char) => {
            if (type === 'player') return `<span class="green">${char}</span>`;
            if (type === 'alien') return `<span class="magenta">${char}</span>`;
            if (type && type.startsWith('bunker')) {
              const hp = type.split('_')[1];
              const opacity = hp === '3' ? '' : hp === '2' ? ' style="opacity:0.65"' : ' style="opacity:0.35"';
              return `<span class="cyan"${opacity}>${char}</span>`;
            }
            if (type === 'pbullet') return `<span class="yellow">${char}</span>`;
            if (type === 'abullet') return `<span class="red">${char}</span>`;
            return char;
          };

          if (topType && bottomType) {
            const char = (topType === 'pbullet' || bottomType === 'pbullet') ? '║' : '█';
            const colorType = (topType === bottomType) ? topType : (topType === 'pbullet' || topType === 'abullet' ? bottomType : topType);
            cellChar = getCellHTML(colorType, char);
          } else if (topType) {
            const char = (topType === 'pbullet' || topType === 'abullet') ? '╨' : '▀';
            cellChar = getCellHTML(topType, char);
          } else if (bottomType) {
            const char = (bottomType === 'pbullet' || bottomType === 'abullet') ? '╥' : '▄';
            cellChar = getCellHTML(bottomType, char);
          }

          line += cellChar;
        }
        line += '│\n';
        board += line;
      }

      board += '└' + '─'.repeat(width) + '┘\n';
      board += ` Score: ${game.score} ║ High Score: ${highscore} ║ Difficulty: ${difficulty.toUpperCase()}\n`;
      board += ` Controls: [A]/[D] or [Arrows] to Move. [Space] to Shoot. [Q] to quit.\n`;

      gameContainer.innerHTML = board;
      shell.body.scrollTop = shell.body.scrollHeight;
    }

    drawInvaders();

    // Event keys handler
    const keyHandler = (e) => {
      if (shell.loginState !== 'GAME') return;
      const key = e.key.toLowerCase();

      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'a', 'd', ' '].includes(key) || e.key === ' ') {
        e.preventDefault();
      }

      if (key === 'q') {
        game.gameOver = true;
        return;
      }

      if (key === 'arrowleft' || key === 'a') {
        game.playerX = Math.max(0, game.playerX - 2);
        drawInvaders();
      } else if (key === 'arrowright' || key === 'd') {
        game.playerX = Math.min(width - 5, game.playerX + 2);
        drawInvaders();
      } else if (e.key === ' ') {
        // Limit active player bullets
        if (game.bullets.length < 3) {
          game.bullets.push({ x: game.playerX + 2, y: game.playerY - 2 });
          audio.playBeep(200, 800, 0.06, 'sawtooth', 0.1);
          drawInvaders();
        }
      }
    };
    document.addEventListener('keydown', keyHandler);

    // Dynamic gameplay interval
    await new Promise((resolve) => {
      const loop = setInterval(() => {
        if (game.gameOver || shell.abortSignal) {
          clearInterval(loop);
          resolve();
          return;
        }

        game.tickCount++;

        // 1. Move Player Bullets
        game.bullets.forEach(b => b.y -= 1);
        game.bullets = game.bullets.filter(b => b.y >= 0);

        // 2. Move Alien Bullets
        game.alienBullets.forEach(b => b.y += 0.8);
        game.alienBullets = game.alienBullets.filter(b => b.y < height);

        // 3. Move Aliens (moves periodically to match retro feel)
        if (game.tickCount % alienMoveSpeed === 0) {
          let hitBorder = false;
          game.aliens.forEach(al => {
            if (!al.alive) return;
            const nextX = al.x + game.alienDir * 2;
            if (nextX < 1 || nextX > width - 5) {
              hitBorder = true;
            }
          });

          if (hitBorder) {
            game.alienDir = -game.alienDir;
            game.aliens.forEach(al => {
              if (al.alive) al.y += 2;
            });
          } else {
            game.aliens.forEach(al => {
              if (al.alive) al.x += game.alienDir * 2;
            });
          }
        }

        // 4. Random Alien shooting
        game.aliens.forEach(al => {
          if (al.alive && Math.random() < shootFreq) {
            // Find if bottom-most alien in its column to avoid self-shooting
            const columnAliens = game.aliens.filter(other => other.alive && other.x === al.x && other.y > al.y);
            if (columnAliens.length === 0) {
              game.alienBullets.push({ x: al.x + 2, y: al.y + 2 });
            }
          }
        });

        // 5. Collisions: Player bullets hitting Aliens (Iterated backwards to prevent index skips)
        for (let i = game.bullets.length - 1; i >= 0; i--) {
          const bullet = game.bullets[i];
          const hitAlien = game.aliens.find(al => al.alive && bullet.x >= al.x && bullet.x < al.x + 4 && Math.round(bullet.y) >= al.y && Math.round(bullet.y) < al.y + 2);
          if (hitAlien) {
            hitAlien.alive = false;
            game.bullets.splice(i, 1);
            game.score += 30;
            audio.playBeep(250, 60, 0.15, 'sawtooth', 0.15);
          }
        }

        // 6. Collisions: Player bullets hitting Bunkers (Iterated backwards to prevent index skips)
        for (let i = game.bullets.length - 1; i >= 0; i--) {
          const bullet = game.bullets[i];
          const hitBunker = game.bunkers.find(b => b.hp > 0 && b.x === bullet.x && b.y === Math.round(bullet.y));
          if (hitBunker) {
            hitBunker.hp--;
            game.bullets.splice(i, 1);
          }
        }

        // 7. Collisions: Alien bullets hitting Bunkers (Iterated backwards to prevent index skips)
        for (let i = game.alienBullets.length - 1; i >= 0; i--) {
          const bullet = game.alienBullets[i];
          const hitBunker = game.bunkers.find(b => b.hp > 0 && b.x === bullet.x && b.y === Math.round(bullet.y));
          if (hitBunker) {
            hitBunker.hp--;
            game.alienBullets.splice(i, 1);
          }
        }

        // 8. Collisions: Alien bullets hitting Player (Iterated backwards to prevent index skips)
        for (let i = game.alienBullets.length - 1; i >= 0; i--) {
          const bullet = game.alienBullets[i];
          const isPlayerHit = (bullet.x >= game.playerX && bullet.x <= game.playerX + 4 && Math.round(bullet.y) === 28) ||
            (bullet.x === game.playerX + 2 && Math.round(bullet.y) === 27);
          if (isPlayerHit) {
            game.alienBullets.splice(i, 1);
            game.gameOver = true;
            audio.playMelody([
              { f: 261.63, dur: 0.18, delay: 0.00 },
              { f: 246.94, dur: 0.18, delay: 0.18 },
              { f: 233.08, dur: 0.18, delay: 0.36 },
              { f: 220.00, endF: 60, dur: 0.60, delay: 0.54 }
            ], 'sawtooth', 0.1);
          }
        }

        // 9. Check Aliens landing
        game.aliens.forEach(al => {
          if (al.alive && al.y >= 26) {
            game.gameOver = true;
            audio.playMelody([
              { f: 261.63, dur: 0.18, delay: 0.00 },
              { f: 246.94, dur: 0.18, delay: 0.18 },
              { f: 233.08, dur: 0.18, delay: 0.36 },
              { f: 220.00, endF: 60, dur: 0.60, delay: 0.54 }
            ], 'sawtooth', 0.1);
          }
        });

        // 10. Check Win Condition
        if (!game.aliens.some(al => al.alive)) {
          game.gameOver = true;
          game.gameWon = true;
          audio.playMelody([
            { f: 523.25, dur: 0.08, delay: 0.00 },
            { f: 659.25, dur: 0.08, delay: 0.08 },
            { f: 783.99, dur: 0.08, delay: 0.16 },
            { f: 1046.50, dur: 0.08, delay: 0.24 },
            { f: 1318.51, dur: 0.40, delay: 0.32 }
          ], 'square', 0.12);
        }

        drawInvaders();
      }, 50);
    });

    // Cleanup
    document.removeEventListener('keydown', keyHandler);
    shell.loginState = 'LOGGED_IN';

    // Print Game Outcome
    if (game.gameWon) {
      shell.print('Congratulations! You saved the terminal from Space Invaders!', 'color-green');
    } else if (shell.abortSignal) {
      shell.print('Space Invaders game interrupted.', 'color-dim');
    } else {
      shell.print('Game Over! The invaders have defeated you.', 'color-error');
    }

    // High Score updating
    if (game.score > highscore) {
      highscore = game.score;
      localStorage.setItem(highscoreKey, highscore.toString());
      shell.print(`NEW HIGH SCORE: ${highscore}!`, 'color-accent');
    } else {
      shell.print(`Final Score: ${game.score}`, 'color-blue');
    }
  }
};
