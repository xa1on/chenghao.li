# [chenghao.li](https://chenghao.li)

personal website disguised as a ssh terminal simulator

**virtually no dependencies!!!** (except for web-llm, that would be insane to implement on my own)

cool (but optional) local web-llm integration, if you want to chat with a really stupid local llm (embedded in the browser).

### modular design
* commands are separate modules in [var/www/chenghao.li/js/commands](var/www/chenghao.li/js/commands)
* drop in a js file to extend the shell
* interactive features like audio fs and llm (and also [games](var/www/chenghao.li/js/commands/games)!!!!)
* fully-functional (mostly) `vim` and `nano` clones! all the files are stored in localStorage, so anything you create persists only on your device.

### how to use
* use `node scripts/generate_vfs.js` if you want to update the virtual filesystem manifest\

visit the live terminal at [chenghao.li](https://chenghao.li)