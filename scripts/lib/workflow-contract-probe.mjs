/**
 * Prove that the artifact at a workflow's package path still honours the
 * contract that workflow expects of it (issue #2982).
 *
 * `scripts/check-workflow-package-paths.mjs` (#2960) proves a workflow's
 * package paths EXIST in the released package. Its own docblock says why that
 * is only half the question: "a file can keep its path and change its contract
 * ... only the PATH is legible from a workflow, so a contract probe needs a
 * declaration this gate does not have and does not invent." This module is that
 * declaration's engine.
 *
 * ## Why a declaration, and not inference
 *
 * A workflow step gives up exactly one legible fact: the path it resolves. What
 * the artifact must DO — the flags it accepts, the exit code the step branches
 * on, whether a prover that reports success examined anything — appears nowhere
 * in the workflow. A guessed contract is the same failure in a new costume: a
 * check that passes because it asked a question too weak to fail. So the
 * contract is DECLARED, in the same file as the compatibility floor, for the
 * same reason the floor is declared rather than counted.
 *
 * ## The two probe shapes, and the non-vacuity signal each yields
 *
 * The hard question #2982 poses is what "it examined N things" means for an
 * artifact that is not a prover. Measured against three released tarballs, two
 * shapes cover every executed path in this repository's workflows:
 *
 * **Prove.** Run the artifact with the workflow's own arguments against a
 * fixture that contains something to examine, and require the count it reports
 * to exceed a declared minimum. `check-conflict-markers.mjs --root .` says "no
 * leftover conflict markers in 2 tracked files"; a released copy that scans
 * nothing says 0 and fails. That is #2951's defect, stated as an assertion.
 *
 * **Refuse.** Hand the artifact a deliberately invalid value for the very
 * parameter the workflow supplies, and require it to reject the value AND
 * enumerate the domain it would have accepted. `dispatch.mjs` answers "unknown
 * executionEnv ... Supported: local, codex-cloud, claude-web"; the non-vacuity
 * count is the size of that enumerated domain, and `contains` pins the exact
 * token the workflow passes. A released copy that lost the flag prints a
 * generic usage line, enumerates nothing, and fails. Refuse probes have no side
 * effects at all, which is what makes it safe to run a dispatcher and a secret
 * rotator out of a tarball.
 *
 * Both reduce to one thing: a regex with ONE capture group, whose captured
 * domain must be large enough and must contain what the workflow depends on.
 *
 * ## Refusing to pass on nothing
 *
 * A probe that resolved no artifact, could not read its output, or matched its
 * signal zero times FAILS. It does not report all-clear, because an empty
 * inspection and a satisfied contract are otherwise the same green. A child
 * killed at its deadline returns EMPTY streams — which reads exactly like an
 * absent signal — so a timeout is reported as an operational failure and never
 * as a contract violation.
 * @module scripts/lib/workflow-contract-probe
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  boundedExecFileSync,
  boundedSpawnSync,
  isChildTimeout,
} from "./bounded-spawn.mjs";

/** How a declaration may describe the artifact at a package path. */
export const CONTRACT_KINDS = new Set(["executed", "reference"]);

/** How a probe's captured domain is turned into a count. */
export const SIGNAL_SHAPES = new Set(["count", "list", "json-object-keys"]);

/**
 * What separates one token from the next inside a captured domain.
 * @remarks
 * The word alternatives precede the whitespace one deliberately: the leading
 * `\s*` has already consumed the space before `and`, so `and` is matched as a
 * separator rather than counted as a member of the domain it joins.
 */
const TOKEN_SEPARATOR = /\s*(?:,|\||\band\b|\bor\b|\s+)\s*/;

/** How long one probe may run before it is killed and reported as such. */
const PROBE_BUDGET_MS = 120_000;

/**
 * Compare two `major.minor.patch` versions.
 * @param {string} left - A version
 * @param {string} right - Another version
 * @returns {number} Negative when left is older, positive when newer, 0 equal
 */
export function compareVersions(left, right) {
  const parse = version =>
    version.split(".").map(part => Number.parseInt(part, 10) || 0);
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    if ((a[index] ?? 0) !== (b[index] ?? 0))
      return (a[index] ?? 0) - (b[index] ?? 0);
  }
  return 0;
}

/**
 * Reject a probe declaration that could not fail.
 * @param {string} where - The package path being validated
 * @param {object} probe - One declared probe
 * @returns {void}
 * @throws {Error} When the probe is malformed
 */
function validateProbe(where, probe) {
  if (!Array.isArray(probe.argv)) {
    throw new Error(`contracts["${where}"]: a probe needs an "argv" array`);
  }
  if (!Number.isInteger(probe.expectExit)) {
    throw new Error(
      `contracts["${where}"]: a probe needs an integer "expectExit"`
    );
  }
  const signal = probe.signal;
  if (!signal || typeof signal.pattern !== "string") {
    throw new Error(`contracts["${where}"]: a probe needs signal.pattern`);
  }
  if (!SIGNAL_SHAPES.has(signal.shape)) {
    throw new Error(
      `contracts["${where}"]: signal.shape must be one of ${[...SIGNAL_SHAPES].join(", ")}`
    );
  }
  if (!Number.isInteger(signal.min) || signal.min < 1) {
    throw new Error(
      `contracts["${where}"]: signal.min must be a positive integer — a probe whose minimum is zero cannot tell an empty inspection from a satisfied contract`
    );
  }
  if (typeof probe.why !== "string" || probe.why.length < 40) {
    throw new Error(
      `contracts["${where}"]: a probe needs a "why" recording what the workflow depends on`
    );
  }
}

/**
 * Read and validate the contract half of the floor declaration.
 * @param {object} declared - Parsed `.github/workflow-package-floor.json`
 * @returns {{contracts: Record<string, object>, fixtures: Record<string, object>}}
 * @throws {Error} When the declaration is missing or malformed
 */
export function readContractDeclaration(declared) {
  const contracts = declared.contracts;
  const fixtures = declared.fixtures ?? {};
  if (!contracts || typeof contracts !== "object" || Array.isArray(contracts)) {
    throw new Error(
      'the declaration has no "contracts" object. Every package path a workflow resolves must declare what the artifact there does — an undeclared path is a path whose contract nobody checked, which is the gap #2982 exists to close.'
    );
  }
  for (const [where, entry] of Object.entries(contracts)) {
    if (!CONTRACT_KINDS.has(entry?.kind)) {
      throw new Error(
        `contracts["${where}"]: kind must be one of ${[...CONTRACT_KINDS].join(", ")}`
      );
    }
    if (typeof entry.why !== "string" || entry.why.length < 40) {
      throw new Error(
        `contracts["${where}"]: needs a "why" a later reader can argue with`
      );
    }
    if (entry.kind === "reference") continue;
    if (!Array.isArray(entry.probes) || entry.probes.length === 0) {
      throw new Error(
        `contracts["${where}"]: kind "executed" needs at least one probe. Declaring an executed artifact with no probe is existence-only treatment wearing a contract's name.`
      );
    }
    for (const probe of entry.probes) {
      validateProbe(where, probe);
      if (
        probe.fixture !== undefined &&
        fixtures[probe.fixture] === undefined
      ) {
        throw new Error(
          `contracts["${where}"]: no fixture named "${probe.fixture}" is declared`
        );
      }
    }
  }
  return { contracts, fixtures };
}

/**
 * Which referenced paths carry no declaration, and which declarations are stale.
 * @param {readonly {workflow: string, step: string, paths: readonly string[]}[]} groups - Step claims
 * @param {Record<string, object>} contracts - Declared contracts
 * @returns {{undeclared: readonly string[], stale: readonly string[]}} Operator-readable lines
 */
export function declarationGaps(groups, contracts) {
  const referenced = new Set(groups.flatMap(group => group.paths));
  const undeclared = groups.flatMap(group =>
    group.paths
      .filter(candidate => contracts[candidate] === undefined)
      .map(
        candidate =>
          `${group.workflow} step "${group.step}" resolves node_modules/@codyswann/lisa/${candidate}, which declares no contract. Add it to "contracts" in .github/workflow-package-floor.json — as "executed" with a probe if the step runs it, or "reference" with a reason if it does not.`
      )
  );
  const stale = Object.keys(contracts)
    .filter(candidate => !referenced.has(candidate))
    .map(
      candidate =>
        `contracts["${candidate}"] is declared but no workflow references it. A declaration nobody reaches is a probe that never runs; delete it or restore the reference.`
    );
  return { undeclared: [...new Set(undeclared)], stale };
}

/**
 * Build a probe's fixture on disk.
 * @remarks
 * `git: true` stages the files rather than committing them. `git ls-files`
 * reads the index, so staging is enough, and it avoids needing a committer
 * identity that a CI runner may not have configured. `GIT_*` variables are
 * stripped so an ambient environment cannot reach into the fixture.
 * @param {object} fixture - Declared fixture: `{git?: boolean, files: Record<string,string>}`
 * @param {string} dir - Directory to build it in
 * @returns {void}
 */
export function materialiseFixture(fixture, dir) {
  mkdirSync(dir, { recursive: true });
  for (const [relative, contents] of Object.entries(fixture.files ?? {})) {
    const target = path.join(dir, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, contents);
  }
  if (fixture.git !== true) return;
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_"))
  );
  boundedExecFileSync("git", ["init", "-q", dir], { env, stdio: "ignore" });
  boundedExecFileSync("git", ["-C", dir, "add", "-A"], {
    env,
    stdio: "ignore",
  });
}

/**
 * The domain a probe's signal captured, and how big it is.
 * @param {string} output - The artifact's combined stdout and stderr
 * @param {object} signal - The declared signal
 * @returns {{text: string|null, count: number}} Captured domain and its size
 */
export function capturedDomain(output, signal) {
  if (signal.shape === "json-object-keys") {
    try {
      const parsed = JSON.parse(output.trim());
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { text: null, count: 0 };
      }
      const keys = Object.keys(parsed);
      return { text: keys.join(", "), count: keys.length };
    } catch {
      return { text: null, count: 0 };
    }
  }
  const match = new RegExp(signal.pattern, "m").exec(output);
  const captured = match?.[1];
  if (captured === undefined) return { text: null, count: 0 };
  if (signal.shape === "count") {
    const parsed = Number.parseInt(captured, 10);
    return { text: captured, count: Number.isInteger(parsed) ? parsed : 0 };
  }
  const tokens = captured
    .split(TOKEN_SEPARATOR)
    .map(token => token.trim())
    .filter(Boolean);
  return { text: captured, count: tokens.length };
}

/**
 * Judge one probe run against its declaration.
 * @param {{status: number|null, output: string}} run - What the artifact did
 * @param {object} probe - The declared probe
 * @returns {{ok: boolean, count: number, reason: string|null}} The verdict
 */
export function evaluateProbe(run, probe) {
  const domain = capturedDomain(run.output, probe.signal);
  if (run.status !== probe.expectExit) {
    return {
      ok: false,
      count: domain.count,
      reason: `exited ${run.status} where the workflow depends on ${probe.expectExit}`,
    };
  }
  if (domain.text === null) {
    return {
      ok: false,
      count: 0,
      reason: `emitted no ${probe.signal.shape} signal matching ${probe.signal.pattern} — it ran, and proved nothing`,
    };
  }
  if (domain.count < probe.signal.min) {
    return {
      ok: false,
      count: domain.count,
      reason: `signal counted ${domain.count}, below the declared minimum of ${probe.signal.min} — an inspection this empty is indistinguishable from a satisfied contract`,
    };
  }
  const missing = (probe.signal.contains ?? []).filter(
    token => !domain.text.includes(token)
  );
  if (missing.length > 0) {
    return {
      ok: false,
      count: domain.count,
      reason: `enumerated "${domain.text}", which is missing ${missing.join(", ")} — the workflow passes that value`,
    };
  }
  return { ok: true, count: domain.count, reason: null };
}

/**
 * Run one probe against one released artifact.
 * @param {object} input - `{artifact, probe, fixtures, workDir}`
 * @returns {{status: number|null, output: string, timedOut: boolean}} What happened
 */
export function runProbe({ artifact, probe, fixtures, workDir }) {
  if (probe.fixture !== undefined) {
    materialiseFixture(fixtures[probe.fixture], workDir);
  } else {
    mkdirSync(workDir, { recursive: true });
  }
  try {
    const result = boundedSpawnSync(
      process.execPath,
      [artifact, ...probe.argv],
      {
        cwd: workDir,
        encoding: "utf8",
        timeout: PROBE_BUDGET_MS,
        maxBuffer: 32 * 1024 * 1024,
        env: { ...process.env, CI: "1", NO_COLOR: "1" },
      }
    );
    return {
      status: result.status,
      output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
      timedOut: false,
    };
  } catch (error) {
    if (isChildTimeout(error))
      return { status: null, output: "", timedOut: true };
    throw error;
  }
}

/**
 * The path a step would actually EXECUTE in a given release.
 * @remarks
 * Mirrors the workflow's own `for candidate in ...; break` loop, with one
 * refinement: a path declared `reference` is skipped. A directory named in a
 * step's error prose exists in every release and would otherwise shadow the
 * artifact the step really runs — which would quietly retire the probe.
 * @param {readonly string[]} paths - The step's candidates, in workflow order
 * @param {(candidate: string) => boolean} exists - Does this release carry it?
 * @param {Record<string, object>} contracts - Declared contracts
 * @returns {string|null} The executed path, or null when the step runs nothing
 */
export function resolveExecutedPath(paths, exists, contracts) {
  return (
    paths.find(
      candidate =>
        contracts[candidate]?.kind === "executed" && exists(candidate)
    ) ?? null
  );
}

/**
 * Probe every executed path every step resolves, in every release.
 * @remarks
 * Deduplicated by release, path and probe: `lisa-gates.mjs` is resolved by more
 * than forty steps, and running the same probe forty times per release would
 * cost minutes and prove nothing extra.
 * @param {object} input - `{groups, releases, contracts, fixtures, workRoot}`
 * @returns {{executed: number, violations: readonly string[], deferred: readonly string[], operational: readonly string[], probed: readonly string[]}}
 */
export function probeReleases({
  groups,
  releases,
  contracts,
  fixtures,
  workRoot,
}) {
  const seen = new Set();
  const violations = [];
  const deferred = [];
  const operational = [];
  const probed = [];
  for (const release of releases) {
    for (const group of groups) {
      const target = resolveExecutedPath(
        group.paths,
        release.contains,
        contracts
      );
      if (target === null) continue;
      contracts[target].probes.forEach((probe, index) => {
        const key = `${release.version}::${target}::${index}`;
        if (seen.has(key)) return;
        seen.add(key);
        const where = `${release.version}: node_modules/@codyswann/lisa/${target}`;
        if (
          probe.since !== undefined &&
          compareVersions(release.version, probe.since) < 0
        ) {
          deferred.push(
            `${where} — probe requires ${probe.since} or newer; the workflow degrades instead: ${probe.degradation}`
          );
          return;
        }
        const artifact = path.join(release.root, target);
        const run = runProbe({
          artifact,
          probe,
          fixtures,
          workDir: path.join(workRoot, key.replace(/[^A-Za-z0-9]+/g, "_")),
        });
        if (run.timedOut) {
          operational.push(
            `${where} — the probe was killed at its ${PROBE_BUDGET_MS}ms deadline. A killed child returns EMPTY streams, so this would otherwise read as an absent signal; it is reported as "could not look" instead.`
          );
          return;
        }
        const verdict = evaluateProbe(run, probe);
        probed.push(
          `${where} — ${probe.why} [signal counted ${verdict.count}]`
        );
        if (!verdict.ok) {
          violations.push(
            `${where} exists, and ${verdict.reason}. Expected because ${probe.why}. The path check passes here; the contract does not.`
          );
        }
      });
    }
  }
  return {
    executed: probed.length,
    violations,
    deferred,
    operational,
    probed,
  };
}
