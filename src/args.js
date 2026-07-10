const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh"]);
const INSTALL_TARGETS = new Set(["auto", "claude", "opencode"]);

function slugLabel(prompt) {
  const slug = prompt.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").split("-").slice(0, 5).join("-");
  return slug || "run";
}

export function parseArgs(argv) {
  const command = argv[0];
  if (!command || command === "-h" || command === "--help") return { help: true };
  if (command === "run") return parseRun(argv.slice(1));
  if (command === "install-skill") return parseInstall(argv.slice(1));
  return { error: `unknown command '${command}': expected 'run' or 'install-skill'` };
}

function parseRun(args) {
  if (args.includes("-h") || args.includes("--help")) return { help: true };
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
    noTools: false,
    piBin: process.env.ORN_PI_BIN || "pi",
  };
  const positionals = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const next = () => args[++i];
    switch (a) {
      case "--prompt-file": opts.promptFile = next(); break;
      case "--model": opts.model = next(); break;
      case "--provider": opts.provider = next(); break;
      case "--thinking": opts.thinking = next(); break;
      case "--timeout": opts.timeoutSec = Number(next()); break;
      case "--label": case "-n": opts.label = next(); break;
      case "--workdir": opts.workdir = next(); break;
      case "--runs-dir": opts.runsDir = next(); break;
      case "--no-tools": opts.noTools = true; break;
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

function parseInstall(args) {
  const opts = { command: "install-skill", target: "auto" };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const next = () => args[++i];
    switch (a) {
      case "-h": case "--help": return { help: true };
      case "--target": opts.target = next(); break;
      default: return { error: `unexpected argument '${a}'` };
    }
  }
  if (!INSTALL_TARGETS.has(opts.target))
    return { error: `invalid --target '${opts.target}': one of ${[...INSTALL_TARGETS].join(", ")}` };
  return { options: opts };
}

export const HELP = `orn <command> [options]

Commands:
  run <prompt>       drive a self-scaffolding local model via pi, capturing a run record
  install-skill      install the ornith-loop skill into your coding agent(s)

orn run <prompt> [options]
  --prompt-file <path>   read the prompt from a file (instead of a positional)
  --model <id>           default: ornith-1.0-9b-64k
  --provider <name>      default: ollama
  --thinking <level>     off|minimal|low|medium|high|xhigh (default: off)
  --timeout <seconds>    kill pi after N seconds (default: 900)
  --label, -n <name>     session/run label (default: slug of prompt)
  --workdir <path>       git repo to snapshot before/after (claimed-done-no-change flag)
  --runs-dir <path>      where to write run records (default: runs)
  --no-tools             run pi with all tools disabled (read-only adjudication; used
                         for the Layer-1 verifier so it must reply inline, never write files)
  env: ORN_PI_BIN overrides the pi binary path (default: pi)

orn install-skill [options]
  --target <where>       auto|claude|opencode (default: auto = every detected harness)
  env: CLAUDE_SKILLS_DIR, OPENCODE_SKILLS_DIR override install locations

  -h, --help             show this help`;
