/**
 * Terminal prompts for setup-server.mjs.
 *
 * Split out from the setup script so the input handling can be tested against
 * plain streams instead of needing a real terminal.
 *
 * Prompts are written to stderr, not stdout. `npm run` pipes stdout, as do
 * redirection and tee, and a prompt written somewhere the person cannot see it
 * is indistinguishable from never asking.
 */

const ENTER = [String.fromCharCode(13), String.fromCharCode(10)];
const CTRL_C = String.fromCharCode(3);
const CTRL_D = String.fromCharCode(4);
const BACKSPACE = [String.fromCharCode(127), String.fromCharCode(8)];

/** Ask for a value, echoing what's typed. */
export async function askVisible(prompt, { input = process.stdin, output = process.stderr } = {}) {
  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input, output });
  try {
    return (await rl.question(prompt)).trim();
  } finally {
    rl.close();
  }
}

/** Ask for a secret. Nothing is echoed, so it never lands in a scrollback. */
export function askHidden(prompt, { input = process.stdin, output = process.stderr } = {}) {
  return new Promise((resolve) => {
    output.write(prompt);
    if (input.setRawMode) input.setRawMode(true);
    input.resume();
    input.setEncoding('utf8');

    let buf = '';
    const finish = () => {
      if (input.setRawMode) input.setRawMode(false);
      input.pause();
      input.removeListener('data', onData);
      output.write('\n');
      resolve(buf.trim());
    };

    const onData = (chunk) => {
      // A paste arrives as a single chunk, so walk it a character at a time.
      for (const ch of chunk) {
        if (ENTER.includes(ch) || ch === CTRL_D) return finish();
        if (ch === CTRL_C) {
          if (input.setRawMode) input.setRawMode(false);
          output.write('\n');
          process.exit(130);
        }
        // Raw mode delivers backspace as a character, not as a correction.
        if (BACKSPACE.includes(ch)) buf = buf.slice(0, -1);
        else if (ch >= ' ') buf += ch;
      }
    };

    input.on('data', onData);
  });
}
