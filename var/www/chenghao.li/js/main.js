import { FileSystem } from './fs.js';
import { Shell } from './shell.js';
import { commands } from '../gen/commands.js';
import { HOSTNAME, DEFAULT_USERNAME, HOME_PATH, SHOW_FPS_COUNTER } from './config.js';

// Instantiate FileSystem and Shell contexts
const fileSystem = new FileSystem();

const shell = new Shell({
  fileSystem,
  commands,
  hostname: HOSTNAME,
  username: DEFAULT_USERNAME,
  homePath: HOME_PATH,
  onConnect: async (shell) => {
    const now = new Date();
    const currentTimestamp = now.toString();
    const asciiArt = `<span class="color-dim red">

       ░░░░    ░  ░░ ░░░░   ░░░                ░░                             </span><span class="red">
      ░░░     ░  ░░░░░                    <span class="color-dim red">▄</span>         ░░                        
     ░░░<span class="color-dim red"> ░</span>   ▒  ▒  ▒▒                               ░  ░                      
    ▒▒▒▒       ▒▒▒▒                   </span>▓█</span><span class="red">          ▒                           
    ▒▒▒<span class="color-dim red">  ▒</span>          <span class="color-dim red">▄▄</span>               </span>█  █</span><span class="red">               ▒                     
   ▒ ▒<span class="color-dim red"> ▒▒▒▒</span>        ▒▒               </span>█    █</span><span class="red">        ▄                           
   ▓▓▓  ▓          ▄            </span>   █ ▓▓▓  █</span><span class="color-dim red">█▓             ▓  ▓                
  ▓ ▓ ▓  ▓  ▓▓  ▓▓    <span class="color-dim red">▒</span>   ▓</span>█<span class="red">█ ▓</span> ▓▞▀▀▀▀▀▀▀▀▀█▀▀▀▀▀▀▀▀▛▀</span><span class="red">                        
  ▓ ▓            ▓       ██ ▓ ▓</span>██     ▓█ ▓▓ █ ▓     ▓</span><span class="red">                         
  ▓▓▓            ▓  <span class="color-dim red">▒</span>   █ ▓  </span>█<span class="red">█</span>██   ▄▞██▓█   ████▓ █</span><span class="red">                          
   ▓▓   ░          <span class="color-dim red">▒ ▒</span> </span>█<span class="red">▓ ▓▓▓</span>  ▓   ▟     ▚     ██████</span><span class="red">        <span class="color-dim red">▒</span>          </span> | <span class="blue">arch</span>4ic</span><span class="red">
  ▓▓▓   ░      ▓▒    <span class="color-dim red">▒</span></span>█▓<span class="red">  █▓</span> ▓█  ▓▄█      ██▓  ██ ████</span><span class="red">▒                       
  ▓▓▓   ░       ▓░    ██ ▓</span> █ █ █▀  ▓█▓ ▄<span class="red">▓</span>██ ███▓█ █  <span class="red">▓</span> █</span><span class="red">                      
  ▓ ▓           ▓░      </span>█ ▓ <span class="red">█</span>█ <span class="red">▄</span>    ▄   ▚   █  <span class="red">▓</span> █    <span class="red">▓</span>█</span><span class="red">                      
  ▓ ▓▓▓▓▓      ▓▒    ▞▀ </span>█<span class="red">█▓</span>█ ▄▄▄▄▄▓▓▄▄▓▄▄▓▓▓▓▄▄▄▄<span class="red">▓</span>███<span class="red">▓                        
    ▓▓  ▓       ▓░ <span class="color-dim red">░</span>      </span>█   <span class="red">▓</span>█    ▀▀▀▀▀▀    ██   █<span class="red">   ▓  <span class="color-dim red">▄</span>          ▓  ▓     
   ▒ ▒ ▒▒▒▒▒   ░  <span class="color-dim red">▒▒▒</span>    </span>█    █                █ <span class="red">▓</span>  █<span class="red">     ▒        ▒▒▒  ▒     
    ▒▒▒  ▒ ▒      <span class="color-dim red">▒▒▒▒</span>  </span>█    █               <span class="red">   █▓  ▄</span>█<span class="red">  ▒▒          ▒  ▒      
    ▒ ▒▒    ▒          </span>█▄▄▄▄▞               <span class="red">░</span>    ▚▄▄▄█<span class="red">               ▒▒       
     ░ ░ ░   ░   ░    <span class="color-dim red">▄</span >                                         ░     ░       
      ░ ░     ░         ░                                      ░     ░ ░      </span><span class="color-dim red">
       ░ ░░    ░            ░░░                ░░░           ░░    ░░         </span>

`;

    shell.print(`Archaic Linux 6.9.3-arch4ic1-1 (tty1)`, 'color-dim');
    shell.print(`\n  >>> <span class="blue">Welcome, ${shell.currentUsername}@${shell.hostname}!</span> <<<`, 'color-accent');
    shell.print(asciiArt, 'color-accent motd-ascii-art');

    // Print buddy box using decoupled command
    if (shell.commands.buddies) {
      await shell.commands.buddies.run([], shell);
    }

    shell.print(`
System information at ${currentTimestamp}:
  System load:  0.15               Processes:             108
  Usage of /:   38.4% of 50GB      Users logged in:       2
  Memory usage: 12%                IPv4 address for eth0: 192.168.1.104
`, 'color-dim');
    shell.print(` `);
  }
});

// Initialize event listeners and start shell lifecycle
shell.mount();
shell.startConnection();

// Tiny Green FPS Counter (number only)
if (SHOW_FPS_COUNTER) {
  let fpsEl = document.getElementById('fps-counter');
  if (!fpsEl) {
    fpsEl = document.createElement('div');
    fpsEl.id = 'fps-counter';
    fpsEl.className = 'fps-counter';
    fpsEl.setAttribute('aria-hidden', 'true');
    document.body.appendChild(fpsEl);
  }
  let frameCount = 0;
  let lastTime = performance.now();
  const updateFps = (now) => {
    frameCount++;
    if (now - lastTime >= 500) {
      fpsEl.textContent = Math.round((frameCount * 1000) / (now - lastTime));
      frameCount = 0;
      lastTime = now;
    }
    requestAnimationFrame(updateFps);
  };
  requestAnimationFrame(updateFps);
}
