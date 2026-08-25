#!/usr/bin/env node
/**
 * check-pipeline-status-reads — refuse a gate whose result is read through a
 * pipe (CodySwannGT/lisa#3090).
 *
 * ## The defect
 *
 * A shell pipeline's exit status is its LAST stage's. So
 *
 *   node scripts/some-gate.mjs 2>&1 | tail -4; echo "exit=$?"
 *
 * reports whether `tail` succeeded, which it essentially always does. The gate
 * can have failed and the reading says `exit=0`. This is ordinary shell
 * semantics and not a bug in anything Lisa ships — it is filed because of WHERE
 * it bites: piping into `tail`/`head` to keep output short is exactly what one
 * does while checking whether a gate passed, and a quiet gate, or one whose
 * failure line falls outside the window the pipe exists to create, produces
 * `exit=0` plus a plausible-looking tail.
 *
 * It has already bitten this repository in shipped CI. `security-floors.yml`
 * ran `node scripts/check-security-floors.mjs --strict | tee -a
 * "$GITHUB_STEP_SUMMARY"` with no `pipefail`, so every failure `--strict`
 * exists to raise — a dependency floor below a live advisory, a rate-limited
 * inconclusive run, an unresolved `$name` — was discarded and the job went
 * green. That was fixed by hand, and the reasoning was written down as a
 * comment inside the one file that had been fixed, which is why this exists as
 * a control instead.
 *
 * ## What counts as a finding
 *
 * A pipeline is reported when ALL of these hold:
 *
 *  1. Its last stage is a PRESENTATION command (`tail`, `head`, `tee`, `cat`,
 *     `less`, `more`, `nl`, `column`, `fold`). These report on their own
 *     writing, never on the command upstream. Deliberately status-bearing
 *     filters — `grep -q`, `jq -e` — are NOT in the set, because there the
 *     last stage's status is the one you meant to read.
 *  2. Something acts on the pipeline's status: it is an `if`/`elif`/`while`/
 *     `until` condition, it is joined with `&&`/`||`, the very next statement
 *     reads `$?`, `set -e` is in force, or it sits in a workflow `run:` block
 *     (where GitHub makes the step's status the job's).
 *  3. `pipefail` is NOT in force at that line. With `set -o pipefail` the
 *     pipeline reports the first failing stage and the defect cannot occur, so
 *     a protected pipeline is inspected and passed, never reported.
 *
 * ## Why it fails at zero inspected
 *
 * An empty inspection and a clean tree print the same tick. This repository has
 * shipped guards that reported success while inert often enough to have a rule
 * about it (`falsifiable-checks`), so the count of pipelines actually parsed is
 * part of the report and a count of zero is exit 2, not exit 0. A glob that
 * matches nothing, a root that does not exist, and a parser that silently
 * stopped all reach that branch.
 *
 * ## What it reads
 *
 * Shell scripts (`.sh`/`.bash`), workflow `run:` blocks, and FENCED SHELL
 * BLOCKS in markdown. The last of those matters most: a skill document is where
 * an agent reads how to check a gate, so an unsafe spelling there is not one
 * defect, it is one per agent that follows the instruction. Six such copies of
 * `docker compose logs otel-collector 2>/dev/null | tail -20 || echo "No
 * otel-collector service"` shipped — where the `||` fallback can never fire,
 * because `tail` succeeds whether or not the service exists.
 *
 * Determinism: Node built-ins plus `js-yaml`, no network, no clock, no
 * `Math.random`. The scanned root is a parameter so the suite can point it at a
 * fixture tree holding a known offender.
 *
 * CLI:
 *   node scripts/check-pipeline-status-reads.mjs [--json] [root]
 *
 * Exit codes (mirroring the sibling check-* scripts):
 *   0 — pipelines were inspected and none reads a gate through a pipe.
 *   1 — >=1 finding.
 *   2 — operational error: unknown flag, unreadable root, or ZERO pipelines
 *       inspected.
 *
 * @module scripts/check-pipeline-status-reads
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import yaml from "js-yaml";
import { invokedAsScript } from "./lib/invoked-as-script.mjs";

/**
 * Last-stage commands that report on their own writing rather than on the
 * command upstream of them. A pipeline ending in one of these has thrown the
 * interesting status away.
 *
 * `grep`, `jq`, `sed` and `awk` are deliberately absent: each is routinely the
 * stage whose status you actually meant to read (`grep -q`, `jq -e`), so
 * including them would turn a correct idiom into a finding. That is the sweep's
 * declared blind spot — one of them used purely as a pager is not detected.
 */
export const PRESENTATION_COMMANDS = Object.freeze([
  "tail",
  "head",
  "tee",
  "cat",
  "less",
  "more",
  "nl",
  "column",
  "fold",
]);

/**
 * First-stage commands that produce text rather than a verdict. A pipeline
 * starting with one of these is formatting something already in hand, so its
 * discarded exit status is not a gate result and reporting it would bury the
 * findings that are. `{`/`(` open a group or subshell used the same way.
 *
 * This is the sweep's precision boundary, stated rather than hidden: it looks
 * for a PROGRAM whose status was the answer being piped into a pager, which is
 * the shape the ticket describes. `echo "$msg" | head -5` is not that shape.
 */
export const PURE_OUTPUT_COMMANDS = Object.freeze([
  "echo",
  "printf",
  "cat",
  "true",
  "false",
  "yes",
  "seq",
  "{",
  "}",
  "(",
]);

/** Directories whose shell and workflow sources are shipped or run by Lisa. */
export const SCANNED_ROOTS = Object.freeze([
  ".github/workflows",
  "all",
  "cdk",
  "expo",
  "harper-fabric",
  "nestjs",
  "npm-package",
  "phaser",
  "plugins",
  "rails",
  "scripts",
  "typescript",
]);

/**
 * Directory names never descended into. `node_modules` and `dist` are not
 * authored here; the fixture trees exist to hold deliberately broken input and
 * would make every run of the real sweep fail on its own test data.
 */
const SKIPPED_DIRECTORIES = Object.freeze([
  "node_modules",
  "dist",
  "fixtures",
  ".git",
]);

/** Fence languages read as shell. Anything else, including a bare fence, is skipped. */
export const SHELL_FENCE_LANGUAGES = Object.freeze([
  "sh",
  "bash",
  "shell",
  "zsh",
  "console",
]);

/** Keywords whose following pipeline has its status read as a condition. */
const CONDITION_KEYWORDS = Object.freeze(["if", "elif", "while", "until"]);

/** Statement separators, longest first so `&&` is never read as `&`. */
const STATEMENT_OPERATORS = Object.freeze(["&&", "||", ";;", ";", "&"]);

/**
 * Split shell text on operators that are outside quotes, command substitution
 * and subshells.
 *
 * Written as one scanner rather than a regex because the distinction that
 * matters — a `|` that pipes versus a `|` inside `'...'`, `"..."`, `$(...)` or
 * a comment — is exactly the one a regex cannot make.
 * @param {string} text - One logical line of shell.
 * @param {readonly string[]} operators - Separators to split on, longest first.
 * @returns {{ text: string, operator: string }[]} Segments in source order.
 */
export function splitTopLevel(text, operators) {
  const segments = [];
  const state = { buffer: "", quote: "", depth: 0, escaped: false };
  const flush = operator => {
    segments.push({ text: state.buffer, operator });
    state.buffer = "";
  };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (state.escaped) {
      state.buffer += char;
      state.escaped = false;
      continue;
    }
    if (char === "\\") {
      state.buffer += char;
      state.escaped = true;
      continue;
    }
    if (state.quote) {
      state.buffer += char;
      if (char === state.quote) state.quote = "";
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      state.buffer += char;
      state.quote = char;
      continue;
    }
    // A `#` only opens a comment at the start of a word.
    if (char === "#" && (state.buffer === "" || /\s$/.test(state.buffer)))
      break;
    if (char === "(") {
      state.buffer += char;
      state.depth += 1;
      continue;
    }
    if (char === ")") {
      state.buffer += char;
      state.depth = Math.max(0, state.depth - 1);
      continue;
    }
    if (state.depth > 0) {
      state.buffer += char;
      continue;
    }
    const operator = operators.find(
      candidate => text.slice(index, index + candidate.length) === candidate
    );
    // `2>&1`, `>&2`, `<&0` and `&>log` all contain a bare `&` that is part of a
    // REDIRECTION, not a background separator. Splitting there tore
    // `node gate.mjs 2>&1 | tail -4` into `node gate.mjs 2>` and `1 | tail -4`,
    // which lost the leading `if`/`while` keyword the reason-finder reads and
    // made every report name a fragment instead of the pipeline. Caught by
    // running the sweep against a fixture and reading what it printed.
    const redirected =
      operator === "&" &&
      (/[<>]\s*$/.test(state.buffer) || text[index + 1] === ">");
    if (operator && !redirected) {
      flush(operator);
      index += operator.length - 1;
      continue;
    }
    state.buffer += char;
  }
  flush("");
  return segments;
}

/**
 * The command word a pipeline stage runs, with any path and any leading
 * environment assignments or redirections stripped.
 * @param {string} stage - One pipeline stage's source text.
 * @returns {string} The bare command name, or `""` when there is none.
 */
export function stageCommand(stage) {
  const words = stage.trim().split(/\s+/).filter(Boolean);
  for (const word of words) {
    if (/^[A-Za-z_]\w*=/.test(word)) continue;
    if (/^\d*[<>]/.test(word)) continue;
    if (word === "!" || word === "command" || word === "exec") continue;
    return word.replace(/^.*\//, "").replace(/^['"]|['"]$/g, "");
  }
  return "";
}

/**
 * Split one statement into its pipeline stages.
 * @param {string} statement - A statement with no top-level `&&`/`||`/`;`.
 * @returns {string[]} The stages, in source order.
 */
export function pipelineStages(statement) {
  return splitTopLevel(statement, ["|"]).map(segment => segment.text);
}

/**
 * Whether a `set` builtin on this line turns `pipefail` on or off.
 *
 * Word-wise rather than by regex over the whole line, because the overwhelmingly
 * common spelling in this repository is the COMBINED form `set -euo pipefail`.
 * A pattern looking for a literal `-o` does not match it — `-euo` has no `-`
 * immediately before its `o` — so a regex written the obvious way reports every
 * `set -euo pipefail` script as unprotected. Measured while building this
 * sweep: it flagged `security-floors.yml`, whose `run:` block sets
 * `-euo pipefail` on the line directly above the pipeline.
 * @param {string} line - One source line.
 * @returns {boolean | undefined} `true`/`false` when it changes, else undefined.
 */
export function pipefailChange(line) {
  const words = line.trim().split(/\s+/);
  if (words[0] !== "set") return undefined;
  for (let index = 0; index < words.length - 1; index += 1) {
    if (words[index + 1] !== "pipefail") continue;
    if (/^-[a-zA-Z]*o$/.test(words[index])) return true;
    if (/^\+[a-zA-Z]*o$/.test(words[index])) return false;
  }
  return undefined;
}

/**
 * Net change in `$(`/`(` nesting a line makes, ignoring quoted text.
 * @param {string} line - One source line.
 * @returns {number} Opened minus closed, at the top level of the line.
 */
export function netDepth(line) {
  const state = { quote: "", escaped: false, depth: 0 };
  for (const char of line) {
    if (state.escaped) {
      state.escaped = false;
      continue;
    }
    if (char === "\\") {
      state.escaped = true;
      continue;
    }
    if (state.quote) {
      if (char === state.quote) state.quote = "";
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      state.quote = char;
      continue;
    }
    if (char === "#") break;
    if (char === "(") state.depth += 1;
    if (char === ")") state.depth -= 1;
  }
  return state.depth;
}

/** Whether a `set` builtin on this line turns `-e` on. */
const errexitOn = line => /^\s*set\s+-[a-zA-Z]*e/.test(line);

/**
 * Inspect one block of shell source.
 *
 * @param {object} source - The block to inspect.
 * @param {string} source.text - Its shell source.
 * @param {string} source.file - Repository-relative path, for reporting.
 * @param {string} source.location - Where in that file, for reporting.
 * @param {boolean} source.statusAlwaysRead - True for a workflow `run:` block,
 *   where GitHub makes the block's status the step's and the step's the job's,
 *   so every failing statement is acted upon whether or not `-e` is set.
 * @param {boolean} source.pipefail - Whether `pipefail` is already in force
 *   from outside the block (GitHub's `shell: bash` sets `-eo pipefail`).
 * @returns {{ inspected: number, findings: object[] }} Count and findings.
 */
export function inspectShellSource(source) {
  const lines = source.text.split("\n");
  const state = {
    pipefail: source.pipefail,
    errexit: source.statusAlwaysRead,
    inspected: 0,
    // Depth carried over from an unclosed `$(` or `(` on an earlier line. A
    // line-at-a-time scanner otherwise reads the tail of a multi-line command
    // substitution as a statement of its own, and reports a fragment that
    // starts mid-pipeline as though it were a whole one.
    carry: 0,
  };
  const findings = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const opening = state.carry;
    state.carry = Math.max(0, state.carry + netDepth(line));
    if (opening > 0) continue;
    const change = pipefailChange(line);
    if (change !== undefined) state.pipefail = change;
    if (errexitOn(line)) state.errexit = true;
    const statements = splitTopLevel(line, STATEMENT_OPERATORS);
    for (let position = 0; position < statements.length; position += 1) {
      const statement = statements[position];
      const stages = pipelineStages(statement.text);
      if (stages.length < 2) continue;
      state.inspected += 1;
      if (state.pipefail) continue;
      const last = stageCommand(stages[stages.length - 1]);
      if (!PRESENTATION_COMMANDS.includes(last)) continue;
      const first = stageCommand(
        stages[0].replace(/^\s*(if|elif|while|until)\s+/, "")
      );
      if (first === "" || first.startsWith("$")) continue;
      if (PURE_OUTPUT_COMMANDS.includes(first)) continue;
      const reason = statusReadReason({
        statement,
        next: statements[position + 1],
        followingLine: lines[index + 1] ?? "",
        errexit: state.errexit,
        statusAlwaysRead: source.statusAlwaysRead,
      });
      if (!reason) continue;
      findings.push({
        file: source.file,
        location: source.location,
        line: index + 1,
        statement: statement.text.trim(),
        lastStage: last,
        reason,
      });
    }
  }
  return { inspected: state.inspected, findings };
}

/**
 * Why this pipeline's status is acted upon, or `""` when nothing reads it.
 *
 * Ordered from most specific to least so the report names the tightest true
 * reason: an `if` condition is more useful to read than "`set -e` is on".
 * @param {object} context - The statement and its immediate surroundings.
 * @param {{ text: string, operator: string }} context.statement - The pipeline.
 * @param {{ text: string } | undefined} context.next - The next statement on
 *   the same line, if any.
 * @param {string} context.followingLine - The next source line.
 * @param {boolean} context.errexit - Whether `set -e` is in force.
 * @param {boolean} context.statusAlwaysRead - Workflow `run:` block.
 * @returns {string} A reason, or `""`.
 */
export function statusReadReason(context) {
  const leading = context.statement.text.trim().split(/\s+/)[0] ?? "";
  if (CONDITION_KEYWORDS.includes(leading))
    return `\`${leading}\` condition reads the pipeline's status`;
  if (
    context.statement.operator === "&&" ||
    context.statement.operator === "||"
  )
    return `\`${context.statement.operator}\` branches on the pipeline's status`;
  const nextText = context.next?.text ?? context.followingLine;
  if (/\$\?/.test(nextText) && !/PIPESTATUS|pipestatus/.test(nextText))
    return "the next statement reads `$?`";
  if (context.statusAlwaysRead)
    return "a workflow `run:` step's status is the job's result";
  if (context.errexit) return "`set -e` acts on the pipeline's status";
  return "";
}

/**
 * Every workflow `run:` block in a parsed workflow, with the shell resolved.
 *
 * GitHub's default shell for `run:` is `bash -e {0}` — `-e` but NO `pipefail`.
 * Declaring `shell: bash` explicitly changes it to
 * `bash --noprofile --norc -eo pipefail {0}`, which is why the declared shell,
 * and the workflow- and job-level `defaults.run.shell` it inherits, decide
 * whether a block is protected.
 * @param {unknown} document - The parsed workflow.
 * @param {string} file - Repository-relative path, for reporting.
 * @returns {object[]} Sources ready for `inspectShellSource`.
 */
export function workflowRunSources(document, file) {
  if (!document || typeof document !== "object") return [];
  const workflowShell = document.defaults?.run?.shell;
  const jobs = document.jobs ?? {};
  const sources = [];
  for (const [jobId, job] of Object.entries(jobs)) {
    if (!job || typeof job !== "object" || !Array.isArray(job.steps)) continue;
    const jobShell = job.defaults?.run?.shell ?? workflowShell;
    for (let index = 0; index < job.steps.length; index += 1) {
      const step = job.steps[index];
      if (!step || typeof step.run !== "string") continue;
      const shell = step.shell ?? jobShell;
      const named = step.name ? ` (${step.name})` : "";
      sources.push({
        text: step.run,
        file,
        location: `jobs.${jobId}.steps[${index}]${named}`,
        statusAlwaysRead: true,
        // Only the explicit `bash` and `pwsh` spellings get pipefail from
        // GitHub. The DEFAULT (no `shell:` key) does not, which is the whole
        // reason a `run:` block can swallow a gate's failure.
        pipefail: shell === "bash" || shell === "pwsh",
      });
    }
  }
  return sources;
}

/**
 * Walk a directory tree, yielding files the sweep can read.
 * @param {string} root - Absolute directory to walk.
 * @param {string} repoRoot - Absolute repository root, for relative paths.
 * @returns {{ absolute: string, relative: string }[]} Files, sorted.
 */
export function collectFiles(root, repoRoot) {
  const found = [];
  const walk = directory => {
    const entries = readdirSync(directory, { withFileTypes: true });
    for (const entry of [...entries].sort((a, b) =>
      a.name < b.name ? -1 : 1
    )) {
      if (SKIPPED_DIRECTORIES.includes(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!/\.(sh|bash|ya?ml|md)$/.test(entry.name)) continue;
      found.push({ absolute, relative: path.relative(repoRoot, absolute) });
    }
  };
  walk(root);
  return found;
}

/**
 * Every fenced shell block in a markdown document.
 *
 * Skill and rule documents are where an agent READS how to check a gate, so a
 * command spelled unsafely in one is the defect at its source: the pipeline
 * never appears in a script, it appears in the transcript of every agent that
 * followed the instruction. Only `sh`/`bash`/`shell`/`console` fences are read;
 * a fence with no language, or one tagged for another language, is skipped
 * rather than guessed at.
 * @param {string} text - The markdown source.
 * @param {string} file - Repository-relative path, for reporting.
 * @returns {object[]} Sources ready for `inspectShellSource`.
 */
export function markdownShellSources(text, file) {
  const lines = text.split("\n");
  const sources = [];
  const state = { open: false, start: 0, body: [] };
  for (let index = 0; index < lines.length; index += 1) {
    const fence = /^\s*```+\s*([A-Za-z0-9_+-]*)\s*$/.exec(lines[index]);
    if (!fence) {
      if (state.open) state.body.push(lines[index]);
      continue;
    }
    if (state.open) {
      sources.push({
        // Blank-pad so a reported line number is the line in the FILE, not the
        // line in the fence. A finding nobody can jump to is a finding nobody
        // fixes.
        text: [...Array(state.start).fill(""), ...state.body].join("\n"),
        file,
        location: `fenced shell block starting at line ${state.start + 1}`,
        statusAlwaysRead: false,
        pipefail: false,
      });
      state.open = false;
      state.body = [];
      continue;
    }
    if (!SHELL_FENCE_LANGUAGES.includes(fence[1].toLowerCase())) continue;
    state.open = true;
    state.start = index + 1;
    state.body = [];
  }
  return sources;
}

/**
 * Turn one file into the shell blocks the sweep inspects.
 * @param {{ absolute: string, relative: string }} file - The file to read.
 * @returns {object[]} Zero or more sources.
 */
export function fileSources(file) {
  const text = readFileSync(file.absolute, "utf8");
  if (file.absolute.endsWith(".md")) {
    return markdownShellSources(text, file.relative);
  }
  if (/\.(sh|bash)$/.test(file.absolute)) {
    return [
      {
        text,
        file: file.relative,
        location: "script body",
        statusAlwaysRead: false,
        pipefail: false,
      },
    ];
  }
  // A YAML file that is not a workflow parses fine and simply yields no `run:`
  // blocks; one that does not parse is skipped rather than failing the sweep,
  // because a template may deliberately hold non-YAML placeholders.
  try {
    return workflowRunSources(yaml.load(text), file.relative);
  } catch {
    return [];
  }
}

/**
 * Run the sweep over a tree.
 * @param {string} repoRoot - Absolute path of the tree to inspect.
 * @param {readonly string[]} [roots] - Sub-directories to scan.
 * @returns {{ inspected: number, files: number, findings: object[] }} Report.
 */
export function sweep(repoRoot, roots = SCANNED_ROOTS) {
  const report = { inspected: 0, files: 0, findings: [] };
  for (const root of roots) {
    const absolute = path.join(repoRoot, root);
    try {
      if (!statSync(absolute).isDirectory()) continue;
    } catch {
      continue;
    }
    for (const file of collectFiles(absolute, repoRoot)) {
      report.files += 1;
      for (const source of fileSources(file)) {
        const result = inspectShellSource(source);
        report.inspected += result.inspected;
        report.findings.push(...result.findings);
      }
    }
  }
  return report;
}

/**
 * Render the human-readable report.
 * @param {{ inspected: number, files: number, findings: object[] }} report - Result.
 * @returns {string} The report text.
 */
export function formatReport(report) {
  const lines = [
    `check:pipeline-status-reads — inspected ${report.inspected} pipeline(s) across ${report.files} file(s).`,
  ];
  if (report.inspected === 0) {
    lines.push(
      "  ✖ ZERO pipelines inspected. A sweep that parsed nothing cannot report a clean tree; treating this as a failure, not an all-clear."
    );
    return lines.join("\n");
  }
  for (const finding of report.findings) {
    lines.push(
      `  ✖ ${finding.file}:${finding.line} (${finding.location})`,
      `      ${finding.statement}`,
      `      status is \`${finding.lastStage}\`'s, not the command's — ${finding.reason}.`
    );
  }
  if (report.findings.length === 0) {
    lines.push("  ✔ No pipeline hides a command's exit status behind a pager.");
    return lines.join("\n");
  }
  lines.push(
    "",
    "Fix: capture the status before truncating —",
    '  cmd >"$log" 2>&1; status=$?',
    '  tail -20 "$log"; [ "$status" -eq 0 ] || exit "$status"',
    "or put `set -o pipefail` in force where the shell supports it (bash/zsh/ksh, not POSIX `sh`)."
  );
  return lines.join("\n");
}

/**
 * CLI entry point.
 * @returns {void}
 */
export function main() {
  const args = process.argv.slice(2);
  const unknown = args.find(arg => arg.startsWith("--") && arg !== "--json");
  if (unknown) {
    console.error(`check:pipeline-status-reads: unknown flag ${unknown}`);
    process.exitCode = 2;
    return;
  }
  const json = args.includes("--json");
  const repoRoot = path.resolve(args.find(arg => !arg.startsWith("--")) ?? ".");
  const report = sweep(repoRoot);
  console.log(json ? JSON.stringify(report, null, 2) : formatReport(report));
  if (report.inspected === 0) process.exitCode = 2;
  else if (report.findings.length > 0) process.exitCode = 1;
}

if (invokedAsScript(import.meta.url)) {
  main();
}
