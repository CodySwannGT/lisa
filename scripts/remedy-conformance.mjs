#!/usr/bin/env node
/**
 * Every remedy a guard prints must be one this environment permits (#3825).
 *
 * ## The defect
 *
 * A guard refuses correctly and then hands the operator an instruction that
 * cannot work. The guard is fine; its remedy is the defect — and the failure is
 * misattributed by construction, because when an agent follows the printed
 * advice and is refused, the refusal names **the guard it obeyed**, not the
 * advice that sent it there. So the evidence points away from the actual bug.
 *
 * Nothing executed a remedy string, so a remedy rotted exactly like a comment,
 * except an agent will *act* on it. Three guards, three unrelated authors,
 * accumulated broken remedies before anyone named the class.
 *
 * ## Why permission alone is not the check — measured, not assumed
 *
 * The obvious mechanism is "run the remedy through the guard chain, assert
 * permitted". **That mechanism would have passed the instance that motivated
 * the ticket.** Measured on this repository: `git stash push` is PERMITTED by
 * `parity-safety-net.sh` — guard 7 refuses only `stash drop`/`clear`. So when a
 * guard advised "use git stash to preserve work first", a permission check
 * would have gone green while the advice pointed every reader at one stash
 * stack shared by every worktree of the clone, racing concurrent agents.
 *
 * A remedy is therefore conformant only when BOTH hold:
 *
 * 1. the guard chain PERMITS it — nothing refuses the operator who obeys; and
 * 2. it names no FORBIDDEN operation — an operation this repository has ruled
 *    unsafe for reasons no guard enforces at the command level.
 *
 * Check 2 exists precisely because check 1 cannot see hazards that are policy
 * rather than pattern.
 *
 * ## Fail direction
 *
 * **Report-only on its findings, fail-closed on its own blindness.** It gates
 * no commit and no push; a broken remedy is a documentation defect, and a guard
 * that refused a contributor's push because some message was worded badly would
 * be worse than the defect. But a probe whose guard did not refuse produced NO
 * remedy text, and counting that as "no unfollowable remedies" is the reassuring
 * answer for a measurement that never happened. Those become `NOT_EXAMINED`,
 * and any of them makes the sweep `NOT_MEASURED` rather than `CONFORMING`.
 * Exit codes carry the same split: 0 conforming, 1 findings, 2 not measured.
 */

import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Per-remedy verdicts. */
export const REMEDY_VERDICTS = Object.freeze([
  "PERMITTED",
  "REFUSED",
  "FORBIDDEN",
]);

/** Whole-sweep verdicts. */
export const REMEDY_SWEEP_VERDICTS = Object.freeze([
  "CONFORMING",
  "UNFOLLOWABLE_REMEDIES",
  "NOT_MEASURED",
]);

/**
 * Operations no remedy may recommend, whatever the guard chain permits.
 *
 * Each entry is a ruling this repository has already made and written down
 * somewhere other than a command pattern. `git stash` is the founding member:
 * `PRESERVE_GUIDANCE` in `parity-safety-net.sh` says "Do NOT reach for `git
 * stash`. One stash stack is shared by every worktree of a clone, so a
 * concurrently running agent can consume the entry you just pushed" — and yet
 * the guard permits the command, because refusing it outright would break the
 * legitimate single-worktree uses.
 *
 * `advisory` is what separates a recommendation from a prohibition. Guard 7's
 * own message must keep containing the word "stash" while REFUSING it; only
 * text that offers the operation as the way forward is a finding. Keying on the
 * bare token would fail the one message doing the right thing — the mistake
 * `parity-safety-net-no-stash-advice.test.ts` records making.
 */
export const FORBIDDEN_REMEDY_OPERATIONS = Object.freeze([
  Object.freeze({
    id: "shared-stash",
    advisory: /\bgit\s+stash\s+(push|pop|save|apply)\b/i,
    why: "one stash stack is shared by every worktree of a clone, so a concurrent agent can consume the entry",
  }),
]);

/** Command verbs a remedy line may begin with to count as a command. */
const REMEDY_VERBS = /^(git|gh|node|bun|npm|npx|bash|sh|mktemp|jq)\b/;

/**
 * Markers that make a line talk ABOUT a command rather than instruct it.
 *
 * **Measured, not anticipated.** The first live run of this sweep reported six
 * findings, every one of them the same string pulled out of
 * `PRESERVE_GUIDANCE`'s sentence "Untracked files survive, exactly as they
 * survive ...". That is a comparison. The guard is not telling anyone to run
 * that command — it refuses it two guards further up the same file.
 *
 * So the extractor was making exactly the mistake #3815 and this ticket's own
 * second comment describe: treating text ABOUT a thing as the thing. A
 * conformance control that makes it reports its loudest findings against
 * correct prose, and a control whose findings are wrong on day one gets
 * switched off. That outcome matters more here than a missed remedy, because
 * the entire value of this control is that somebody reads its output.
 *
 * The marker is looked for in a WINDOW of text immediately preceding the
 * command, not on its line and not in its paragraph. Both of those were tried
 * and both were measured wrong on this repository's real guard text:
 *
 * - LINE scope missed the founding case outright. The heredoc wraps, so
 *   "exactly as they" ends one line and "survive `git reset --hard`." begins
 *   the next; the marker and the command it qualifies are never on one line.
 * - PARAGRAPH scope demotes correct remedies wholesale. `DESTRUCTIVE_GUIDANCE`
 *   opens a bullet with "Do not try to reword it" and then names three real
 *   remedies in the same bullet, all of which would vanish from the sweep.
 *
 * The window approximates the clause the command sits in, which is the scope
 * the qualifier actually applies to. Mentions are not classified, and they are
 * COUNTED AND REPORTED rather than dropped, so the coverage this rule costs
 * stays visible instead of being silently absorbed.
 */
const MENTION_CONTEXT =
  /\b(do not|don't|never|no longer|used to|as they survive|instead of|rather than|cannot|would|refuses?|blocks?|prohibit)/i;

/** How much text before a command is read for a mention marker. */
const MENTION_WINDOW = 64;

/**
 * Pull the runnable commands out of a guard's refusal text.
 *
 * Two shapes, because guards use both: a backticked span, and an indented line
 * inside a heredoc. Prose is skipped by requiring a known verb at the start —
 * a remedy sentence is advice, and only its commands can be classified.
 *
 * A placeholder like `<path>` is substituted with a plausible path so the
 * command reaches the guard in the shape an operator would actually type;
 * leaving the angle brackets in would feed the guard a redirection.
 *
 * @param {string} text - A guard's refusal output.
 * @returns {{ commands: readonly string[], mentions: readonly string[] }}
 *   Instructions to classify, and commands the text only talks about.
 */
export function extractRemedyCommands(text) {
  const source = typeof text === "string" ? text : "";
  const commands = [];
  const mentions = [];

  // Backticked spans, judged against the clause that precedes each one. The
  // source is flattened so a wrapped qualifier still sits inside the window.
  const flat = source.replace(/\s+/g, " ");
  for (const match of flat.matchAll(/`([^`]+)`/g)) {
    const candidate = match[1].trim();
    if (!REMEDY_VERBS.test(candidate)) continue;
    const before = flat.slice(
      Math.max(0, match.index - MENTION_WINDOW),
      match.index
    );
    (MENTION_CONTEXT.test(before) ? mentions : commands).push(candidate);
  }

  // Indented lines are code blocks, which are instructions by convention even
  // where the surrounding prose is comparative.
  for (const line of source.split("\n")) {
    if (!/^\s{2,}\S/.test(line)) continue;
    const trimmed = line.trim();
    if (REMEDY_VERBS.test(trimmed) || /^[a-z_]+="\$\(/.test(trimmed)) {
      commands.push(trimmed);
    }
  }

  const instructions = new Set(commands.map(substitutePlaceholders));
  return {
    commands: [...instructions],
    // A command that appears BOTH as an instruction and as a mention is an
    // instruction: the code block is the operative text.
    mentions: [...new Set(mentions)].filter(
      mention => !instructions.has(substitutePlaceholders(mention))
    ),
  };
}

/**
 * Replace `<placeholder>` tokens with a plausible concrete path.
 *
 * @param {string} command - A command that may carry placeholders.
 * @returns {string} The command with placeholders made concrete.
 */
function substitutePlaceholders(command) {
  return command.replace(/<[a-z][a-z -]*>/gi, "tmp/remedy-conformance-probe");
}

/**
 * Classify one remedy command.
 *
 * Forbidden beats refused: a remedy naming the shared stash is a finding even
 * where the guard chain waves it through, which is the whole reason check 2
 * exists.
 *
 * @param {string} command - The remedy command as printed.
 * @param {(command: string) => number | null} permits - Guard-chain classifier,
 *   returning the guard's exit status for the command.
 * @returns {{ command: string, verdict: string, reason: string }} The verdict.
 */
export function classifyRemedy(command, permits) {
  const forbidden = FORBIDDEN_REMEDY_OPERATIONS.find(operation =>
    operation.advisory.test(command)
  );
  if (forbidden) {
    return {
      command,
      verdict: "FORBIDDEN",
      reason: `${forbidden.id}: ${forbidden.why}`,
    };
  }

  const status = permits(command);
  return status === 0
    ? { command, verdict: "PERMITTED", reason: "guard-chain-permits" }
    : {
        command,
        verdict: "REFUSED",
        reason: `guard-chain-refuses (exit ${status})`,
      };
}

/**
 * Sweep a set of probes and report every unfollowable remedy.
 *
 * @param {{
 *   readonly probes?: readonly { label: string, refusal: string | null }[]
 *   readonly permits?: (command: string) => number | null
 * }} input - `refusal` is the guard's output, or `null` when the guard did not
 *   refuse and therefore produced no remedy to examine.
 * @returns {{
 *   readonly verdict: string
 *   readonly reasons: readonly string[]
 *   readonly examinedCount: number
 *   readonly commandCount: number
 *   readonly mentionCount: number
 *   readonly findings: readonly {
 *     readonly command: string
 *     readonly verdict: string
 *     readonly reason: string
 *     readonly probe: string
 *   }[]
 *   readonly notExamined: readonly string[]
 *   readonly reportOnly: true
 * }} The sweep result.
 */
export function sweepRemedyConformance(input = {}) {
  const probes = Array.isArray(input.probes) ? input.probes : null;
  const permits = input.permits ?? (() => 0);

  if (probes === null) {
    return emptySweep("NOT_MEASURED", ["probe-list-unavailable"]);
  }

  const notExamined = probes
    .filter(probe => typeof probe?.refusal !== "string")
    .map(probe => String(probe?.label ?? "<unlabelled>"));

  const findings = [];
  let commandCount = 0;
  let mentionCount = 0;
  for (const probe of probes) {
    if (typeof probe?.refusal !== "string") continue;
    const extracted = extractRemedyCommands(probe.refusal);
    mentionCount += extracted.mentions.length;
    for (const command of extracted.commands) {
      commandCount += 1;
      const verdict = classifyRemedy(command, permits);
      if (verdict.verdict !== "PERMITTED") {
        findings.push({ ...verdict, probe: probe.label });
      }
    }
  }

  const examinedCount = probes.length - notExamined.length;

  // Blindness outranks findings: a sweep that read no remedy text from part of
  // the guard set cannot call the rest of it conformant.
  if (notExamined.length > 0) {
    return {
      verdict: "NOT_MEASURED",
      reasons: ["guard-did-not-refuse"],
      examinedCount,
      commandCount,
      mentionCount,
      findings,
      notExamined,
      reportOnly: true,
    };
  }

  return {
    verdict: findings.length > 0 ? "UNFOLLOWABLE_REMEDIES" : "CONFORMING",
    reasons:
      findings.length > 0
        ? ["remedies-the-environment-refuses-or-forbids"]
        : ["every-printed-remedy-permitted-and-allowed"],
    examinedCount,
    commandCount,
    mentionCount,
    findings,
    notExamined,
    reportOnly: true,
  };
}

/**
 * A sweep result carrying nothing, for the paths that measured nothing.
 *
 * @param {string} verdict - The sweep verdict.
 * @param {readonly string[]} reasons - Why.
 * @returns {ReturnType<typeof sweepRemedyConformance>} The empty sweep.
 */
function emptySweep(verdict, reasons) {
  return {
    verdict,
    reasons,
    examinedCount: 0,
    commandCount: 0,
    mentionCount: 0,
    findings: [],
    notExamined: [],
    reportOnly: true,
  };
}

/**
 * The CLI exit status for a sweep.
 *
 * `2` is load-bearing: a sweep that examined nothing must not exit 0 beside an
 * empty finding list, which is indistinguishable from a conformant guard set.
 *
 * @param {{ readonly verdict?: string }} sweep - A sweep result.
 * @returns {0 | 1 | 2} The exit status.
 */
export function remedyConformanceExitCode(sweep) {
  if (sweep?.verdict === "CONFORMING") return 0;
  if (sweep?.verdict === "UNFOLLOWABLE_REMEDIES") return 1;
  return 2;
}

/**
 * Render the sweep for an operator.
 *
 * @param {ReturnType<typeof sweepRemedyConformance>} sweep - A sweep result.
 * @returns {string} A terminal-first report.
 */
export function formatRemedyConformanceReport(sweep) {
  const lines = [`Remedy conformance: ${sweep.verdict}`];

  if (sweep.verdict === "NOT_MEASURED") {
    lines.push(
      `No remedy text was read for ${sweep.notExamined.length} probe(s) (${sweep.reasons.join(", ")}).`,
      "This is not a conformant guard set — it is an unanswered question.",
      ...sweep.notExamined.map(label => `  ? ${label}`)
    );
    return `${lines.join("\n")}\n`;
  }

  lines.push(
    `Examined ${sweep.examinedCount} guard refusal(s) and classified ${sweep.commandCount} printed command(s).`,
    `Not classified: ${sweep.mentionCount} command(s) the text only mentions (comparisons and prohibitions).`
  );

  if (sweep.verdict === "CONFORMING") {
    lines.push(
      "Every command any examined guard prints is permitted here and names no forbidden operation."
    );
    return `${lines.join("\n")}\n`;
  }

  lines.push("These printed remedies cannot be followed as written:");
  for (const finding of sweep.findings) {
    lines.push(`  ! [${finding.probe}] ${finding.command}`);
    lines.push(`      ${finding.verdict}: ${finding.reason}`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Build a guard-chain classifier that runs the real shipped guard.
 *
 * @param {string} guardPath - Path to the shipped guard script.
 * @param {string} cwd - Working directory reported to the guard.
 * @returns {(command: string) => number | null} The classifier.
 */
export function guardChainClassifier(guardPath, cwd) {
  return command =>
    spawnSync("/bin/bash", [guardPath], {
      input: JSON.stringify({
        tool_name: "Bash",
        tool_input: { command },
        cwd,
      }),
      encoding: "utf8",
    }).status;
}

/**
 * True when `moduleUrl` names the module node was asked to run.
 *
 * @param {string} moduleUrl - The caller's own `import.meta.url`.
 * @param {string | undefined} [argv1] - Entry path.
 * @returns {boolean} Whether to run the CLI body.
 */
export function invokedAsScript(moduleUrl, argv1 = process.argv[1]) {
  if (!argv1) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

if (invokedAsScript(import.meta.url)) {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  const sweep = sweepRemedyConformance({
    probes: raw.length === 0 ? null : JSON.parse(raw).probes,
    permits: guardChainClassifier(
      process.argv[2] ?? "plugins/lisa/hooks/parity-safety-net.sh",
      process.cwd()
    ),
  });
  process.stdout.write(formatRemedyConformanceReport(sweep));
  process.exitCode = remedyConformanceExitCode(sweep);
}
