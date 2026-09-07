import { HOSTNAME } from '../../config.js';

export const neofetch = {
  name: 'neofetch',
  description: 'Display system and portfolio information in a beautiful layout.',
  category: 'general',
  args: [],
  run: async (args, shell) => {
    // 1. Calculate Uptime
    const totalSeconds = Math.floor(performance.now() / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    let uptimeStr = "";
    if (hours > 0) uptimeStr += `${hours}h `;
    if (minutes > 0 || hours > 0) uptimeStr += `${minutes}m `;
    uptimeStr += `${seconds}s`;

    // 2. Detect Browser
    let browser = "Unknown";
    const ua = navigator.userAgent;
    if (ua.includes("Edg/")) {
      browser = "Edge";
      const match = ua.match(/Edg\/([\d.]+)/);
      if (match) browser += ` ${match[1].split('.')[0]}`;
    } else if (ua.includes("OPR/") || ua.includes("Opera/")) {
      browser = "Opera";
      const match = ua.match(/(?:OPR|Opera)\/([\d.]+)/);
      if (match) browser += ` ${match[1].split('.')[0]}`;
    } else if (ua.includes("Chrome/")) {
      browser = "Chrome";
      const match = ua.match(/Chrome\/([\d.]+)/);
      if (match) browser += ` ${match[1].split('.')[0]}`;
    } else if (ua.includes("Firefox/")) {
      browser = "Firefox";
      const match = ua.match(/Firefox\/([\d.]+)/);
      if (match) browser += ` ${match[1].split('.')[0]}`;
    } else if (ua.includes("Safari/") && !ua.includes("Chrome")) {
      browser = "Safari";
      const versionMatch = ua.match(/Version\/([\d.]+)/) || ua.match(/Safari\/([\d.]+)/);
      if (versionMatch) browser += ` ${versionMatch[1].split('.')[0]}`;
    }

    // 3. Count VFS nodes recursively
    const countNodes = (node) => {
      if (!node || typeof node !== 'object' || node.symlink !== undefined) return 0;
      let count = 0;
      for (const key of Object.keys(node)) {
        count += 1 + countNodes(node[key]);
      }
      return count;
    };
    const totalFiles = countNodes(shell.fileSystem.root);

    // 4. Color Blocks
    const blocks = [
      '<span class="color-red">██</span>',
      '<span class="green">██</span>',
      '<span class="yellow">██</span>',
      '<span class="blue">██</span>',
      '<span class="magenta">██</span>',
      '<span class="cyan">██</span>',
      '<span class="white">██</span>'
    ].join(" ");

    // 5. Logo & Stats Arrays
    const logoLines = [
      "",
      "                     @",
      "                    @@@",
      "                   @@@@@",
      "                  @@@@@@@",
      "                 @@@@@@@@@",
      "                @@@@@@@@@@@",
      "               @@@@@@ @@@@@@",
      "                       @@@@@@",
      "                        @@@@@@",
      "                         @@@@@@",
      "           <span class=\"red\">#########</span>      @@@@@@",
      "          <span class=\"red\">############</span>     @@@@@@",
      "         <span class=\"red\">######</span>             @@@@@@",
      "        <span class=\"red\">######</span>               @@@@@@",
      "       <span class=\"red\">######</span>                 @@@@@@",
      "      <span class=\"red\">######</span>                   @@@@@@",
      "     <span class=\"red\">######</span>                     @@@@@@",
      ""
    ];

    const host = shell.hostname || HOSTNAME;
    const stats = [
      `<span class="color-accent red">${shell.currentUsername}</span>@<span class="color-accent">${host}</span>`,
      "-".repeat(`${shell.currentUsername}@${host}`.length),
      `<span class="red">OS</span>:          Archaic Linux x86_64`,
      `<span class="red">Host</span>:        ${host}`,
      `<span class="red">Kernel</span>:      6.9.3-arch4ic1-1`,
      `<span class="red">Uptime</span>:      ${uptimeStr}`,
      `<span class="red">Shell</span>:       ArchaicSh 1.0`,
      `<span class="red">Resolution</span>:  ${window.screen.width}x${window.screen.height}`,
      `<span class="red">Browser</span>:     ${browser}`,
      `<span class="red">Virtual FS</span>:  ${totalFiles} nodes`,
      `<span class="red">Memory</span>:      12% of ${navigator.deviceMemory || 64}GB`,
      "",
      blocks
    ];

    // Align logo and stats side-by-side
    let output = "\n";
    const maxLines = Math.max(logoLines.length, stats.length);
    for (let i = 0; i < maxLines; i++) {
      const logoLineRaw = logoLines[i] || "";
      const statsLine = stats[i] || "";

      // Strip tags to calculate real text padding size
      const visibleLogoLength = logoLineRaw.replace(/<[^>]*>/g, '').length;
      const padding = " ".repeat(Math.max(0, 45 - visibleLogoLength));

      output += logoLineRaw + padding + statsLine + "\n";
    }

    shell.print(`<pre style="font-family: inherit; line-height: 1.25; margin: 0;">${output}</pre>`, 'color-accent');
  }
};
