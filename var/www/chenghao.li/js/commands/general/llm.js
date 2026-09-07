let engine = null;
let chatHistory = [];

const MODEL_ID = "Qwen2.5-0.5B-Instruct-q4f16_1-MLC";
const SYSTEM_PROMPT = "youre just a helpful guy.";

export const llm = {
  name: 'llm',
  description: 'Interact with a local in-browser LLM via WebGPU.',
  category: 'general',
  lazy: true,
  args: [
    { name: 'prompt', description: 'Optional initial prompt for the AI agent.', required: false }
  ],
  run: async (args, shell) => {
    // 1. WebGPU Support Verification
    if (!navigator.gpu) {
      shell.print("Error: WebGPU is not supported by your browser.", "color-error");
      shell.print("Please use a WebGPU-enabled browser like Chrome 113+, Edge 113+, or Firefox Nightly. Visit <a href='https://webgpureport.org/' target='_blank' class='color-link'>webgpureport.org</a> to verify support.", "color-accent");
      return;
    }

    // 2. User Confirmation for Model Download/Loading
    const confirmResponse = await shell.readInput("This command will load a local ~400MB LLM (Qwen 3 0.5B). Proceed? (y/n): ");
    if (confirmResponse === null) {
      shell.print("Operation cancelled.", "color-dim");
      return;
    }
    const confirmVal = confirmResponse.trim().toLowerCase();
    if (confirmVal !== "y" && confirmVal !== "yes") {
      shell.print("Operation cancelled.", "color-dim");
      return;
    }

    // 3. Dynamic import of WebLLM from CDN
    let CreateMLCEngine;
    try {
      shell.print("Importing LLM runtime libraries...", "color-dim");
      const module = await import("https://esm.run/@mlc-ai/web-llm");
      CreateMLCEngine = module.CreateMLCEngine;
    } catch (e) {
      shell.print("Error loading MLC Web-LLM dependency from CDN.", "color-error");
      console.error(e);
      return;
    }

    // 4. Initialize History if empty
    if (chatHistory.length === 0) {
      chatHistory.push({ role: "system", content: SYSTEM_PROMPT });
    }

    // 5. Initialize MLC Engine
    if (!engine) {
      shell.print("Initializing WebGPU LLM engine...", "color-accent");

      let progressLine = null;
      const initProgressCallback = (report) => {
        if (shell.abortSignal) {
          shell.abortSignal = false;
          throw new Error("Initialization aborted by user");
        }

        // Custom Retro ASCII Progress Bar
        const progress = report.progress || 0;
        const barWidth = 25;
        const filled = Math.round(progress * barWidth);
        const empty = barWidth - filled;
        const bar = "█".repeat(filled) + "░".repeat(empty);
        const pct = (progress * 100).toFixed(0);

        const displayText = `[${bar}] ${pct}% - ${report.text}`;
        if (!progressLine) {
          progressLine = shell.print(displayText, "color-dim");
        } else {
          progressLine.innerHTML = displayText;
        }

        shell.body.scrollTop = shell.body.scrollHeight;

        if (progress === 1 || report.text.includes("Finish loading") || report.text.includes("Ready")) {
          progressLine = null; // Reset for future calls
        }
      };

      try {
        engine = await CreateMLCEngine(MODEL_ID, { initProgressCallback });
        shell.print("Connected!", "color-green");
      } catch (error) {
        if (error.message === "Initialization aborted by user") {
          shell.print("Initialization aborted.", "color-yellow");
        } else {
          shell.print(`Error initializing engine: ${error.message}`, "color-error");
          console.error(error);
        }
        engine = null; // Reset so they can retry
        return;
      }
    } else {
      shell.print("Reconnected to session.", "color-accent");
    }

    shell.print("Type 'exit' or 'quit' to close connection, 'reset' to clear chat history, or 'clear' to clear output.\n", "color-dim");

    // 6. Interactive Chat Loop
    let firstPrompt = args.join(" ").trim();
    let promptToProcess = firstPrompt;
    let exitChat = false;

    while (!exitChat) {
      shell.abortSignal = false; // Reset abort signal at start of each iteration
      let userInput = "";
      if (promptToProcess) {
        userInput = promptToProcess;
        promptToProcess = null; // Reset
        // Print it as if user typed it
        shell.print(`<span class="color-accent">user&gt;</span> ${userInput}`);
      } else {
        const rawInput = await shell.readInput(`<span class="color-accent">user&gt;</span> `);

        // Ctrl+C pressed — exit chat loop
        if (rawInput === null) {
          break;
        }

        userInput = rawInput.trim();

        if (userInput === "") {
          continue;
        }

        if (userInput.toLowerCase() === "exit" || userInput.toLowerCase() === "quit") {
          shell.print("Closing connection.", "color-dim");
          exitChat = true;
          break;
        }

        if (userInput.toLowerCase() === "clear") {
          shell.clear();
          continue;
        }

        if (userInput.toLowerCase() === "reset") {
          chatHistory = [{ role: "system", content: SYSTEM_PROMPT }];
          shell.print("Chat history reset successfully.", "color-yellow");
          continue;
        }
      }

      // Add to conversation history
      chatHistory.push({ role: "user", content: userInput });

      // Run inference and stream results
      const thinkingLine = shell.print("Working...", "color-dim");
      const responseLine = shell.print("", "color-text");

      try {
        const chunks = await engine.chat.completions.create({
          messages: chatHistory,
          stream: true
        });

        let fullResponse = "";
        let started = false;
        let aborted = false;

        for await (const chunk of chunks) {
          // If already aborted, just drain remaining chunks without processing
          if (aborted) continue;

          if (shell.abortSignal) {
            aborted = true;
            exitChat = true;
            // Signal the engine to stop generating — then keep draining
            // so the iterator completes naturally and the engine lock is released
            try { engine.interruptGenerate(); } catch (_) { /* best effort */ }
            shell.print("<span class=\"red\"> [GENERATION ABORTED]</span>", "color-red");
            continue; // Don't break — let the iterator drain
          }

          const text = chunk.choices[0]?.delta?.content || "";
          if (text) {
            if (!started) {
              thinkingLine.style.display = "none";
              started = true;
            }
            fullResponse += text;
            responseLine.innerHTML = shell.parseMarkdown(fullResponse);
            shell.body.scrollTop = shell.body.scrollHeight;
          }
        }

        if (!started && !aborted) {
          thinkingLine.style.display = "none";
        }

        if (fullResponse) {
          chatHistory.push({ role: "assistant", content: fullResponse });
        }
      } catch (err) {
        thinkingLine.style.display = "none";
        // Don't print error if this was caused by an interrupt
        if (!shell.abortSignal) {
          shell.print(`Communication error: ${err.message}`, "color-error");
          console.error(err);
        }
      } finally {
        shell.abortSignal = false;
      }
    }
  }
};
