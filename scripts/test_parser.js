import assert from 'node:assert';
import { parseCommandArgs } from '../var/www/chenghao.li/js/shell/parser.js';
import { chmod } from '../var/www/chenghao.li/js/commands/filesystem/chmod.js';
import { cd } from '../var/www/chenghao.li/js/commands/filesystem/cd.js';
import { rm } from '../var/www/chenghao.li/js/commands/filesystem/rm.js';
import { cat } from '../var/www/chenghao.li/js/commands/filesystem/cat.js';
import { echo } from '../var/www/chenghao.li/js/commands/general/echo.js';
import { ping } from '../var/www/chenghao.li/js/commands/general/ping.js';
import { minesweeper } from '../var/www/chenghao.li/js/commands/games/minesweeper.js';
import { tetris } from '../var/www/chenghao.li/js/commands/games/tetris.js';

console.log('Running CLI parser test suite...');

// 1. Short flag bundling (rm -rf /path)
{
  const res = parseCommandArgs(['-rf', '/var/log'], rm);
  assert.strictEqual(res.error, null);
  assert.strictEqual(res.flags.recursive, true);
  assert.strictEqual(res.flags.force, true);
  assert.strictEqual(res.flags.r, true);
  assert.strictEqual(res.flags.f, true);
  assert.deepStrictEqual([...res], ['/var/log']);
}

// 2. Short flag separated value (ping -c 5 google.com)
{
  const res = parseCommandArgs(['-c', '5', 'google.com'], ping);
  assert.strictEqual(res.error, null);
  assert.strictEqual(res.flags.count, 5);
  assert.strictEqual(res.flags.c, 5);
  assert.deepStrictEqual([...res], ['google.com']);
}

// 3. Short flag inline value (ping -c5 google.com)
{
  const res = parseCommandArgs(['-c5', 'google.com'], ping);
  assert.strictEqual(res.error, null);
  assert.strictEqual(res.flags.count, 5);
  assert.strictEqual(res.flags.c, 5);
  assert.deepStrictEqual([...res], ['google.com']);
}

// 4. Long flag with equals (--count=8)
{
  const res = parseCommandArgs(['--count=8', 'example.org'], ping);
  assert.strictEqual(res.error, null);
  assert.strictEqual(res.flags.count, 8);
  assert.deepStrictEqual([...res], ['example.org']);
}

// 5. Numerical validation - NaN rejection
{
  const res = parseCommandArgs(['-c', 'abc', 'google.com'], ping);
  assert.ok(res.error && res.error.includes('requires a numerical value'));
}

// 6. Range validation - Max constraint (ping max is 20)
{
  const res = parseCommandArgs(['-c', '99', 'google.com'], ping);
  assert.ok(res.error && res.error.includes('exceeds maximum allowed 20'));
}

// 7. Range validation - Min constraint (tetris cols min is 4)
{
  const res = parseCommandArgs(['-c', '2'], tetris);
  assert.ok(res.error && res.error.includes('below minimum allowed 4'));
}

// 8. Choices enum validation (minesweeper -d invalid)
{
  const res = parseCommandArgs(['-d', 'impossible'], minesweeper);
  assert.ok(res.error && res.error.includes('invalid argument'));
}

// 9. Choices enum valid value (minesweeper -d hard)
{
  const res = parseCommandArgs(['-d', 'hard'], minesweeper);
  assert.strictEqual(res.error, null);
  assert.strictEqual(res.flags.difficulty, 'hard');
}

// 10. Option termination with --
{
  const res = parseCommandArgs(['--', '-special-dir'], cd);
  assert.strictEqual(res.error, null);
  assert.deepStrictEqual([...res], ['-special-dir']);
}

// 11. Stdin single hyphen - preserved as positional operand
{
  const res = parseCommandArgs(['-'], cat);
  assert.strictEqual(res.error, null);
  assert.deepStrictEqual([...res], ['-']);
}

// 12. chmod -x mode operand pass-through
{
  const res = parseCommandArgs(['-x', 'script.sh'], chmod);
  assert.strictEqual(res.error, null);
  assert.deepStrictEqual([...res], ['-x', 'script.sh']);
}

// 13. cd -P -L precedence (last flag wins)
{
  const res = parseCommandArgs(['-P', '-L', '/tmp'], cd);
  assert.strictEqual(res.error, null);
  assert.strictEqual(res.flags.mode, 'logical');
  assert.deepStrictEqual([...res], ['/tmp']);
}

// 14. cd -L -P precedence (last flag wins)
{
  const res = parseCommandArgs(['-L', '-P', '/tmp'], cd);
  assert.strictEqual(res.error, null);
  assert.strictEqual(res.flags.mode, 'physical');
  assert.deepStrictEqual([...res], ['/tmp']);
}

// 15. echo --help passthrough (disableHelp: true, allowUnknownOptions: true)
{
  const res = parseCommandArgs(['--help'], echo);
  assert.strictEqual(res.error, null);
  assert.deepStrictEqual([...res], ['--help']);
}

// 16. Missing required argument error
{
  const res = parseCommandArgs(['-c'], ping);
  assert.ok(res.error && res.error.includes('requires an argument'));
}

console.log('All 16 CLI parser tests passed successfully! 100% Correctness Verified.');

