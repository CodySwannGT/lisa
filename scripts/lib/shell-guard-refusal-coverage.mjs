/**
 * shell-guard-refusal-coverage — the population, the rule, and the verdict for
 * "a shell guard that tests run must be seen REFUSING, not only allowing"
 * (CodySwannGT/lisa#3190).
 *
 * @remarks
 * ## The defect this exists to keep closed
 *
 * CodySwannGT/lisa#3111 established that Stryker cannot instrument shell at
 * all, so a driving test — a payload table asserting blocked and allowed with a
 * control on both sides — is the only bite evidence a shell guard can have.
 * That survey produced two rosters. The one this module governs is the
 * deceptive half: nine guards that WERE executed by passing tests where every
 * case exercised the allow path. Replace any of them with `exit 0` and its
 * suite still passed. A guard with no test is visibly unproven; a guard with a
 * green allows-only suite reads as covered.
 *
 * CodySwannGT/lisa#3054 is why the class is not hypothetical: every verdict
 * site in `parity-safety-net.sh` reached its answer through `printf … | grep -q
 * …`, and a `grep` exiting 2 made the shipped hook ALLOW catastrophic deletes,
 * silently. An allows-only suite cannot detect that by construction.
 *
 * ## Why this reports on observations rather than on assertions
 *
 * The population comes from {@link module:scripts/lib/shell-guard-trace} — what
 * the suites actually EXECUTED — and the coverage question is asked of the exit
 * statuses observed. This module therefore proves "the guard was seen refusing
 * under test", which is one step weaker than "an `expect` named the refusal".
 * Stated plainly rather than papered over: the discriminating evidence for the
 * latter is neutering the guard to an unconditional `exit 0` and watching the
 * named case fail, which is a thing a human or a mutation gate does, not a
 * thing a scan can assert. What this control buys is that the *class* cannot
 * come back silently — a new driven guard with no refusal observation is named
 * on the next run.
 *
 * ## Byte-identical copies are one guard, and drift creates a new one
 *
 * Matching is by content hash, so the thirteen tracked copies of
 * `lisa-edit-gate.sh` are the same program and one execution covers all of
 * them. That is not a shortcut around the copy problem, it is the correct
 * answer to it: the copies are proven together precisely while they are
 * identical, and the moment one DRIFTS it hashes differently, becomes its own
 * unobserved guard, and this check names it.
 *
 * ## Two rules, and why `set -e` is not one of them
 *
 * A guard is required to be seen refusing only if its source contains a literal
 * non-zero `exit`. A script that merely runs under `set -e` is NOT counted:
 * dying because a tool it called died is a crash path, not a verdict, and
 * requiring a "refusal case" for it would turn this control into a demand for
 * fault injection on every setup script in the tree — which is how a guard
 * earns an exemption list, and an exemption list added to harden a guard has
 * already become the way around one here.
 *
 * A guard at the agent TOOL BOUNDARY — one installed as a hook or reading a
 * tool payload, WHOSE OWN SOURCE contains a literal `exit 2` — is held to the
 * sharper rule: it must be seen exiting exactly 2. Both halves are needed. A
 * `SessionStart` hook that only ever exits 1 is not making a deny decision, and
 * demanding a 2 from it would be this check inventing a contract; a hook that
 * DOES spell `exit 2` has declared the deny contract itself.
 *
 * Why the sharper rule is worth the extra clause: exit 2 is the `PreToolUse`
 * deny contract and exit 1 is a guard that crashed, so evidence that accepts
 * either cannot tell a working guard from a broken one — and
 * CodySwannGT/lisa#3188 was precisely a guard that, when it could not run,
 * permitted everything.
 *
 * @module scripts/lib/shell-guard-refusal-coverage
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

/** Wall-clock ceiling for the one `git` call this module makes. */
const GIT_TIMEOUT_MS = 60_000;

/** The exit status an agent tool-boundary guard uses to refuse. */
export const REFUSED = 2;

/**
 * Path prefixes whose `.sh` files are not shipped guards.
 *
 * `tests/` holds pinned pre-change snapshots and fixture scripts, which are
 * executed constantly and are not the subject; `dist/` is this repository's own
 * source a second time, from its build output.
 */
const NOT_GUARDS = Object.freeze(["tests/", "dist/", ".husky/_/"]);

/**
 * Guards that cannot be driven to refuse hermetically, with the reason.
 *
 * Deliberately checked in and deliberately EMPTY. An omission recorded here is
 * visible; an omission left out of the roster is absent, and CodySwannGT/lisa#3190
 * is a ticket about the difference. An entry must name a guard the trace
 * actually observed — an exclusion for a guard nothing runs is reported as
 * stale rather than quietly kept.
 *
 * @type {readonly {script: string, reason: string}[]}
 */
export const HERMETIC_EXCLUSIONS = Object.freeze([]);

/**
 * Every tracked shell guard in a checkout, with what its source can do.
 * @param {string} root - Repository root.
 * @returns {{path: string, sha256: string, size: number, canRefuse: boolean, toolBoundary: boolean}[]}
 *   One entry per tracked guard, sorted by path.
 */
export function guardPopulation(root) {
  const tracked = execFileSync("git", ["ls-files", "-z", "*.sh"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: GIT_TIMEOUT_MS,
  })
    .split("\0")
    .filter(file => file.length > 0)
    .filter(file => !NOT_GUARDS.some(prefix => file.startsWith(prefix)))
    .sort((left, right) => left.localeCompare(right));
  return tracked.flatMap(file => {
    let bytes;
    try {
      bytes = readFileSync(path.join(root, file));
    } catch {
      return [];
    }
    const source = bytes.toString("utf8");
    return [
      {
        path: file,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        size: bytes.length,
        canRefuse: /\bexit[ \t]+[1-9]\d*\b/u.test(source),
        toolBoundary:
          (file.includes("/hooks/") ||
            /tool_input|"file_path"/u.test(source)) &&
          /\bexit[ \t]+2\b/u.test(source),
      },
    ];
  });
}

/**
 * The index the tracer consults, derived from the population.
 * @param {ReturnType<typeof guardPopulation>} population - Tracked guards.
 * @returns {{byHash: Record<string, string[]>, sizes: number[]}} Tracer index.
 */
export function tracerIndex(population) {
  /** @type {Record<string, string[]>} */
  const byHash = {};
  for (const guard of population) {
    byHash[guard.sha256] = [...(byHash[guard.sha256] ?? []), guard.path];
  }
  return { byHash, sizes: [...new Set(population.map(g => g.size))] };
}

/**
 * Parse a JSONL trace into the statuses observed per guard.
 * @param {string} jsonl - Raw trace content.
 * @returns {Map<string, {statuses: Set<number>, origins: Set<string>}>} Observations.
 */
export function parseTrace(jsonl) {
  /** @type {Map<string, {statuses: Set<number>, origins: Set<string>}>} */
  const observed = new Map();
  for (const line of jsonl.split("\n")) {
    if (line.trim().length === 0) continue;
    /** @type {{script?: unknown, status?: unknown, origin?: unknown}} */
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof record.script !== "string") continue;
    const entry = observed.get(record.script) ?? {
      statuses: new Set(),
      origins: new Set(),
    };
    if (typeof record.status === "number") entry.statuses.add(record.status);
    if (typeof record.origin === "string" && record.origin.length > 0) {
      entry.origins.add(record.origin);
    }
    observed.set(record.script, entry);
  }
  return observed;
}

/**
 * Judge one run's observations against the population.
 * @param {object} input - Everything the verdict depends on.
 * @param {ReturnType<typeof guardPopulation>} input.population - Tracked guards.
 * @param {ReturnType<typeof parseTrace>} input.observed - Trace observations.
 * @param {readonly {script: string, reason: string}[]} [input.exclusions] - Recorded omissions.
 * @returns {{driven: number, findings: {script: string, kind: string, detail: string}[], excluded: readonly {script: string, reason: string}[]}}
 *   The report.
 */
export function judge({
  population,
  observed,
  exclusions = HERMETIC_EXCLUSIONS,
}) {
  const excludedScripts = new Set(exclusions.map(entry => entry.script));
  const byPath = new Map(population.map(guard => [guard.path, guard]));
  /** @type {{script: string, kind: string, detail: string}[]} */
  const findings = [];
  const driven = [...observed.keys()]
    .filter(script => byPath.has(script))
    .sort();

  for (const script of driven) {
    const guard = /** @type {NonNullable<ReturnType<typeof byPath.get>>} */ (
      byPath.get(script)
    );
    const statuses = /** @type {{statuses: Set<number>}} */ (
      observed.get(script)
    ).statuses;
    const seen = [...statuses].sort((a, b) => a - b).join(", ");
    if (!statuses.has(0)) {
      findings.push({
        script,
        kind: "no-allow-control",
        detail: `never observed allowing ordinary work (statuses seen: ${seen || "none"})`,
      });
    }
    if (excludedScripts.has(script) || !guard.canRefuse) continue;
    const refusals = [...statuses].filter(status => status !== 0);
    if (refusals.length === 0) {
      findings.push({
        script,
        kind: "no-refusal-case",
        detail: `driven ${statuses.size} time(s), only ever exit 0 — nothing proves it can refuse`,
      });
      continue;
    }
    if (guard.toolBoundary && !statuses.has(REFUSED)) {
      findings.push({
        script,
        kind: "no-refusal-case",
        detail: `refuses only with exit ${refusals.join("/")}; the tool boundary contract is exit ${REFUSED}, and exit 1 is a guard that crashed`,
      });
    }
  }

  for (const entry of exclusions) {
    if (!byPath.has(entry.script)) {
      findings.push({
        script: entry.script,
        kind: "unknown-exclusion",
        detail: "recorded as un-drivable but is not a tracked guard",
      });
      continue;
    }
    if (!observed.has(entry.script)) {
      findings.push({
        script: entry.script,
        kind: "stale-exclusion",
        detail: "recorded as un-drivable but no test drives it at all",
      });
      continue;
    }
    const statuses = /** @type {{statuses: Set<number>}} */ (
      observed.get(entry.script)
    ).statuses;
    if ([...statuses].some(status => status !== 0)) {
      findings.push({
        script: entry.script,
        kind: "stale-exclusion",
        detail: "recorded as un-drivable, yet it was observed refusing",
      });
    }
  }

  return { driven: driven.length, findings, excluded: exclusions };
}

/**
 * Render one report for a terminal.
 * @param {ReturnType<typeof judge>} report - The verdict.
 * @returns {string} Human-readable text.
 */
export function formatReport(report) {
  const lines = [
    `shell-guard refusal coverage: ${report.driven} guard(s) observed running under test`,
  ];
  if (report.driven === 0) {
    lines.push(
      "",
      "  ✖ NOTHING was observed. No guard ran, so no guard was measured, and",
      "    nothing passed — this is the inert-control shape the check exists to",
      "    refuse. Check that the trace file and the tracer import both reached",
      "    the vitest workers."
    );
    return lines.join("\n");
  }
  for (const entry of report.excluded) {
    lines.push(`  ⚪ ${entry.script} — omitted on purpose: ${entry.reason}`);
  }
  if (report.findings.length === 0) {
    lines.push("  ✔ Every driven guard was observed refusing AND allowing.");
    return lines.join("\n");
  }
  for (const finding of report.findings) {
    lines.push(`  ✖ ${finding.script} — ${finding.detail}`);
  }
  lines.push(
    "",
    "Fix: add a case that drives the guard onto a refusal path and asserts the",
    "exit status EXACTLY — `expect(result.status).toBe(2)` for a tool-boundary",
    "guard. `not.toBe(0)` is not enough: it cannot tell a guard that refused",
    "from one that crashed. Keep the allow control beside it.",
    "A guard that genuinely cannot be driven hermetically belongs in",
    "HERMETIC_EXCLUSIONS with its reason, so the omission is visible."
  );
  return lines.join("\n");
}
