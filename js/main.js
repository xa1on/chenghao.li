import { FileSystem } from './fs.js?v=0b21cbfb3c';
import { Shell } from './shell.js?v=c4ff3d833f';
import { commands } from './commands/index.js?v=64d77229fd';

// Instantiate FileSystem and Shell contexts
const fileSystem = new FileSystem();

const shell = new Shell({
  fileSystem,
  commands,
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
       ░ ░░    ░            ░░░                ░░░           ░░    ░░ ░       </span>

`;

    shell.print(`Arch Linux 6.9.3-arch1-1 (tty1)`, 'color-dim');
    shell.print(`\n  >>> <span class="blue">Welcome, ${shell.currentUsername}@chenghao.li!</span> <<<`, 'color-accent');
    shell.print(asciiArt, 'color-accent motd-ascii-art');

    // Print buddy box using decoupled command
    await shell.commands.buddies.run([], shell);

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
