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
  if (command === "config") return parseConfig(argv.slice(1));
  if (command === "verify") return parseVerify(argv.slice(1));
  return { error: `unknown command '${command}': expected 'run' or 'install-skill'` };
}

function parseRun(args) {
  if (args.includes("-h") || args.includes("--help")) return { help: true };
  const opts = {
    command: "run",
    prompt: "",
    promptFile: null,
    model: "ornith-1.0-9b-64k",
    modelExplicit: false,
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
      case "--model": opts.model = next(); opts.modelExplicit = true; break;
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
  const opts = { command: "install-skill", target: "auto", verifier: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const next = () => args[++i];
    switch (a) {
      case "-h": case "--help": return { help: true };
      case "--target": opts.target = next(); break;
      case "--verifier": {
        const v = next();
        if (v === undefined || v.startsWith("--")) return { error: "--verifier needs a <model> value" };
        opts.verifier = v;
        break;
      }
      default: return { error: `unexpected argument '${a}'` };
    }
  }
  if (!INSTALL_TARGETS.has(opts.target))
    return { error: `invalid --target '${opts.target}': one of ${[...INSTALL_TARGETS].join(", ")}` };
  return { options: opts };
}

function parseConfig(args) {
  const sub = args[0];
  if (sub === "-h" || sub === "--help") return { help: true };
  if (sub === "path") return { options: { command: "config", action: "path" } };
  if (sub === "get") return { options: { command: "config", action: "get", key: args[1] ?? null } };
  if (sub === "set") {
    if (args.length < 3) return { error: "config set needs <key> <value>" };
    return { options: { command: "config", action: "set", key: args[1], value: args[2] } };
  }
  return { error: "config: expected 'get', 'set', or 'path'" };
}

function parseVerify(args) {
  const opts = { command: "verify", workdir: null, testCmd: null, model: null, goalFile: null, groundingFile: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const next = () => args[++i];
    switch (a) {
      case "-h": case "--help": return { help: true };
      case "--workdir": opts.workdir = next(); break;
      case "--test-cmd": opts.testCmd = next(); break;
      case "--model": opts.model = next(); break;
      case "--goal-file": opts.goalFile = next(); break;
      case "--grounding-file": opts.groundingFile = next(); break;
      default: return { error: `unexpected argument '${a}'` };
    }
  }
  if (!opts.workdir) return { error: "verify: --workdir <repo> required" };
  if (!opts.testCmd || !opts.testCmd.trim()) return { error: "verify: --test-cmd \"<cmd>\" required" };
  return { options: opts };
}

export const HELP = `orn <command> [options]

Commands:
  run <prompt>       drive a self-scaffolding local model via pi, capturing a run record
  install-skill      install the ornith-loop skill into your coding agent(s)
  config <get|set|path>  read/write ~/.config/ornith-loop/config.json (verifier, executor, rounds)
  verify                 run the configured local verifier over a workdir (prints pass|fail|uncertain)

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

orn verify [options]
  --workdir <repo>       repo to verify (required)
  --test-cmd "<cmd>"     test command, whitespace-split, no shell (required)
  --model <id>           verifier model (default: config verifier.model when enabled)
  --goal-file <path>     goal text to include in the evidence packet (optional)
  --grounding-file <p>   grounding text to include (optional)

orn install-skill [options]
  --target <where>       auto|claude|opencode (default: auto = every detected harness)
  --verifier <model>     one-shot enable + set the local verifier during install
  env: CLAUDE_SKILLS_DIR, OPENCODE_SKILLS_DIR override install locations

  -h, --help             show this help`;
