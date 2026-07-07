const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh"]);

function slugLabel(prompt) {
  const slug = prompt.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").split("-").slice(0, 5).join("-");
  return slug || "run";
}

export function parseArgs(argv) {
  if (argv.includes("-h") || argv.includes("--help")) return { help: true };

  const command = argv[0];
  if (command !== "run") return { error: `unknown command '${command ?? ""}': expected 'run'` };

  const opts = {
    command: "run",
    prompt: "",
    promptFile: null,
    model: "ornith-1.0-9b-64k",
    provider: "ollama",
    thinking: "off",
    timeoutSec: 900,
    label: null,
    workdir: null,
    runsDir: "runs",
    piBin: process.env.ORN_PI_BIN || "pi",
  };
  const positionals = [];

  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--prompt-file": opts.promptFile = next(); break;
      case "--model": opts.model = next(); break;
      case "--provider": opts.provider = next(); break;
      case "--thinking": opts.thinking = next(); break;
      case "--timeout": opts.timeoutSec = Number(next()); break;
      case "--label": case "-n": opts.label = next(); break;
      case "--workdir": opts.workdir = next(); break;
      case "--runs-dir": opts.runsDir = next(); break;
      default:
        if (a.startsWith("-")) return { error: `unknown flag '${a}'` };
        positionals.push(a);
    }
  }

  opts.prompt = positionals.join(" ");
  const hasInline = opts.prompt.length > 0;
  const hasFile = Boolean(opts.promptFile);
  if (hasInline && hasFile) return { error: "provide a prompt via positional OR --prompt-file, not both" };
  if (!hasInline && !hasFile) return { error: "no prompt: pass an inline prompt or --prompt-file <path>" };
  if (!THINKING_LEVELS.has(opts.thinking))
    return { error: `invalid --thinking '${opts.thinking}': one of ${[...THINKING_LEVELS].join(", ")}` };
  if (!Number.isInteger(opts.timeoutSec) || opts.timeoutSec <= 0)
    return { error: `invalid --timeout: must be a positive integer number of seconds` };

  if (!opts.label) opts.label = hasFile ? "run" : slugLabel(opts.prompt);
  return { options: opts };
}

export const HELP = `orn run <prompt> [options]
  --prompt-file <path>   read the prompt from a file (instead of a positional)
  --model <id>           default: ornith-1.0-9b-64k
  --provider <name>      default: ollama
  --thinking <level>     off|minimal|low|medium|high|xhigh (default: off)
  --timeout <seconds>    kill pi after N seconds (default: 900)
  --label, -n <name>     session/run label (default: slug of prompt)
  --workdir <path>       git repo to snapshot before/after (claimed-done-no-change flag)
  --runs-dir <path>      where to write run records (default: runs)
  -h, --help             show this help
env: ORN_PI_BIN overrides the pi binary path (default: pi)`;
