# welcome to my personal website!

For this first post, I just wanted to write about my process of creating my website. I've had the idea to do a **terminal style website** forever and had sat on this domain for over a year before I even got started with it. I really do think that what I made is unique and I'm pretty proud of it.

---

## <span class="yellow">#</span> Why a terminal website? Also, why Linux? Don't you use Windows?

I think terminals are cool and I like the <span class="blue">Linux</span> terminal.

I should force myself to become a Linux user but I'm far too lazy, which is why I larp. I like that my boring old Windows setup just works, and I don't really ever feel the need to change anything, for now.

---

## <span class="yellow">#</span> How it works

I wanted everything that a typical Linux shell had, but as a website. I know a lot of other people have likely done similar things, however, I wanted to make mine from <span class="yellow">pure html/css</span> + <span class="cyan">javascript</span> AND be fully modular and minimal.

Basically <span class="green">EVERYTHING</span> on this website, including all the HTML files, JavaScript code, and CSS, is included within the simulated shell. You can, if you want, go to the [root directory /](cmd:ls -la /) and look at the [source code of the website](cmd:ls -la /var/www/chenghao.li).

This website (as of 11/1/2026) is hosted via GitHub Pages, so I have a couple deployment scripts that generate the <span class="green">VFS</span> (Virtual File System) dynamically, so that the files you see while navigating the website are the contents of the actual files being used to serve the website.

The file system and commands are all modular, making it easy to add and remove files and commands at will:
* **Adding posts**: All I had to do was create a `.md` file within [~/blogs](cmd:ls -la ~/blogs). The VFS generator automatically updates the file system, and it shows up as a file in the website.
* **Adding commands**: The commands work in a very similar way under [/var/www/chenghao.li/js/commands](cmd:ls /var/www/chenghao.li/js/commands).

---

## <span class="yellow">#</span> Things to try out

| Feature | Quick Launch | Description |
| :--- | :--- | :--- |
| <span class="cyan">Vim</span> | [vim test.txt](cmd:vim test.txt) | Modal terminal text editor with visual & command modes |
| <span class="green">Nano</span> | [nano test.txt](cmd:nano test.txt) | Familiar modeless editor for quick text files |
| <span class="yellow">Paint</span> | [paint test.art](cmd:paint test.art) | 16-color ANSI / ASCII terminal canvas painter |
| <span class="magenta">Scripts</span> | [~/test.sh](cmd:~/test.sh) | Custom shell script runner with bash syntax parity |
| <span class="blue">Games</span> | [tetris](cmd:tetris) / [invaders](cmd:invaders) | Classic retro arcade mini-games |
| <span class="red">Sysinfo</span> | [neofetch](cmd:neofetch) | System info summary with ASCII distro art |

Try opening stuff up with [vim](cmd:vim test.txt) or [nano](cmd:nano test.txt) as well, I feel like they are well written, missing some small features, but overall faithful to the original terminal experience. You can write your own shell scripts and execute them directly! (Also try out [paint](cmd:paint test.art)!)

I think the fact that you can write bash scripts are cool too. Try making one yourself! It's not 1:1 parity with Linux bash, but it has all of the basics. (Take a [look at test.sh!](cmd:~/test.sh) or inspect it with [cat ~/test.sh](cmd:cat ~/test.sh))

Also, you might have noticed that there's a markdown renderer (which is parsing this exact post! see source here: [~/blogs/1-welcome.md](cmd:vim ~/blogs/1-welcome.md)). It kind of sucks, but I think it's cool too. It supports **bold text**, `inline code`, custom `<span class="green">terminal</span> <span class="cyan">color</span> <span class="magenta">spans</span>`, formatted tables, and interactive command links.

Feel free to create some files! (note: all the repo files are read-only and all the files you make are completely local)

Feel free to try out some of the [games](cmd:tetris) too: including [tetris](cmd:tetris), [invaders](cmd:invaders), [snake](cmd:snake), [minesweeper](cmd:minesweeper), and [sokoban](cmd:sokoban)! I hope to add a lot more in the future.

---

## <span class="yellow">#</span> Final thoughts

I'm very happy with how it turned out and I think it's pretty cool.

