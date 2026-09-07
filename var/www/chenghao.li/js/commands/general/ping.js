export const ping = {
  name: 'ping',
  description: 'Simulate pinging a host. Try it\'s friend, pong!',
  category: 'general',
  args: [
    { name: 'host', description: 'The host name or IP address to ping.', required: false }
  ],
  run: async (args, shell) => {
    const host = args.length > 0 ? args[0] : 'chenghao.li';
    const ip = `${Math.floor(Math.random() * 223) + 1}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 254) + 1}`;

    shell.print(`PING ${host} (${ip}) 56(84) bytes of data.`);

    const times = [];
    for (let i = 1; i <= 4; i++) {
      if (shell.abortSignal) {
        shell.print('ping: interrupted by user', 'color-dim');
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
      if (shell.abortSignal) {
        shell.print('ping: interrupted by user', 'color-dim');
        return;
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
    shell.print(`4 packets transmitted, 4 received, 0% packet loss, time ${Math.floor(totalTime + 1200)}ms`);
    shell.print(`rtt min/avg/max/mdev = ${min}/${avg}/${max}/${mdev} ms`);
  }
};
