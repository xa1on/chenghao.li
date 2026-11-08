export const ping = {
  name: 'ping',
  description: 'Simulate pinging a host. Try it\'s friend, pong!',
  category: 'general',
  options: [
    { name: 'count', flags: ['-c', '--count'], type: 'number', min: 1, max: 20, default: 4, suggestions: ['4', '5', '10'], description: 'Stop after sending count ECHO_REQUEST packets.' },
    { name: 'help', flags: ['--help'], type: 'boolean', description: 'Display this help and exit.' }
  ],
  args: [
    { name: 'host', description: 'The host name or IP address to ping.', required: false }
  ],
  run: async (args, shell, flags = {}) => {
    const host = args[0] || 'chenghao.li';
    const count = flags.count ?? flags.c ?? 4;

    const ip = `${Math.floor(Math.random() * 223) + 1}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 254) + 1}`;

    shell.print(`PING ${host} (${ip}) 56(84) bytes of data.`);

    const times = [];
    for (let i = 1; i <= count; i++) {
      for (let t = 0; t < 10; t++) {
        if (shell.abortSignal) {
          shell.print('ping: interrupted by user', 'color-dim');
          return;
        }
        await new Promise(r => setTimeout(r, 100));
      }
      const time = (Math.random() * 30 + 5).toFixed(3);
      times.push(parseFloat(time));
      shell.print(`64 bytes from ${ip}: icmp_seq=${i} ttl=64 time=${time} ms`);
    }

    await new Promise(resolve => setTimeout(resolve, 200));
    if (shell.abortSignal) return;

    const totalTime = times.reduce((a, b) => a + b, 0);
    const min = Math.min(...times).toFixed(3);
    const avg = (totalTime / times.length).toFixed(3);
    const max = Math.max(...times).toFixed(3);
    const mdev = Math.sqrt(times.reduce((acc, val) => acc + Math.pow(val - avg, 2), 0) / times.length).toFixed(3);

    shell.print(`\n--- ${host} ping statistics ---`);
    shell.print(`${times.length} packets transmitted, ${times.length} received, 0% packet loss, time ${Math.floor(totalTime + 300 * count)}ms`);
    shell.print(`rtt min/avg/max/mdev = ${min}/${avg}/${max}/${mdev} ms`);
  }
};
