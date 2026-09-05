/**
 * Gives the plugin-sync prover a local moment, so a green push can see it.
 *
 * `🧩 Plugin artifacts match source` is a REQUIRED status check on this
 * repository's ruleset, and the prover behind it — `bun run check:plugins`,
 * i.e. `scripts/check-plugins-sync.sh` — was declared at no local moment at
 * all. Measured on `origin/main` at 4.45.8, resolving the push moment through
 * `resolveMoment` with this repository's own `.lisa.config.json`: twelve gates
 * resolved and **not one of them named `check:plugins`**. No registry gate
 * named it either.
 *
 * So an agent could pass every gate available to it locally and still be
 * refused by CI, on a check it had no way to run as part of the push
 * (CodySwannGT/lisa#3891). That is not a process failure by whoever hits it —
 * `artifact-freshness` covers the OTHER generated family (`check:artifacts`:
 * evidence manifest, hash ledger, guard certificate, couplings) and cannot
 * cover this one, so the local suite reported OK having never examined the
 * plugin tree at all.
 *
 * ## Why the failure recurs rather than being a one-off
 *
 * It is MERGE-SPECIFIC. A source edit under `plugins/src` on a branch, plus a
 * generated copy that `main` concurrently adds from the pre-edit source,
 * produce a tree whose artifact no longer matches its own source. Both changes
 * are correct in isolation, and the merge that combines them is textually
 * clean, so nothing notices. On a busy default branch that is a standing
 * hazard for any concurrent pair with this shape.
 *
 * ## Why `push` and not `commit`
 *
 * The prover works by rebuilding from source and diffing, so any uncommitted
 * state under `plugins/` makes its answer meaningless — and it says so rather
 * than guessing:
 *
 * ```
 * ✗ plugins/ has uncommitted changes before the sync check could run.
 * ```
 *
 * A merge is uncommitted by definition, so a commit-moment declaration would
 * emit that refusal on every merge commit — training a reader to ignore it,
 * which is worse than no gate. By push the merge is committed and `plugins/`
 * is clean. Push-only is the honest placement, and the fourth assertion below
 * pins it so a later "why not earlier too?" reads the reason first.
 *
 * ## Why `x-`, and why not the shipped registry
 *
 * The same reason `x-orphan-fixture-processes` gives: `validateGates` refuses
 * an id it does not know, and `plugins/src` is a surface no downstream project
 * has. Registering it in the shipped registry would announce a gate to every
 * consumer that cannot run it, and would need a permanent `declareOnly` excuse
 * standing in for a prover that will never ship.
 * @module tests/unit/config/plugin-sync-push-gate-wired
 */

import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { resolveMoment } from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");

/** The gate id. */
const GATE_ID = "x-plugin-artifact-sync";

/** The moment it is declared at, and the only one it may be declared at. */
const MOMENT = "push";

/** The moment the prover cannot answer at, because a merge is uncommitted. */
const REFUSING_MOMENT = "commit";

/** The package script the gate's `run:` names. */
const TASK = "check:plugins";

/** The prover itself. */
const PROVER = "scripts/check-plugins-sync.sh";

/** The CI job whose required context had no local counterpart before #3891. */
const CI_WORKFLOW = ".github/workflows/plugins-sync.yml";

/** One gate's declaration at one moment. */
type Declaration = { level?: string; run?: string };

/** This repository's Lisa configuration, as far as this file reads it. */
type LisaConfig = {
  gates: Record<string, Record<string, unknown>> & { runner?: string };
};

/**
 * Read a repository file.
 * @param relative - Repository-relative path
 * @returns Its contents
 */
const read = (relative: string): string =>
  readFileSync(path.join(REPO_ROOT, relative), "utf8");

/**
 * This repository's own Lisa configuration.
 * @returns The parsed configuration
 */
const config = (): LisaConfig =>
  JSON.parse(read(".lisa.config.json")) as LisaConfig;

/**
 * The gates block of this repository's own Lisa configuration.
 * @returns Every declared gate, keyed by id
 */
const gates = (): Record<string, Record<string, unknown>> => config().gates;

/**
 * The scripts block of this repository's `package.json`.
 * @returns Every script, keyed by name
 */
const scripts = (): Record<string, string> =>
  (JSON.parse(read("package.json")) as { scripts: Record<string, string> })
    .scripts;

describe("the plugin-sync prover is reachable before the push leaves the machine", () => {
  it("is declared as a gate, so a push actually invokes it", () => {
    // The defect, stated as an assertion. Before this declaration the prover's
    // only local mention was the package.json line defining the script; no
    // gate declared it, so the pre-push chain never ran it.
    expect(
      gates()[GATE_ID],
      `${PROVER} backs a REQUIRED CI context and was declared at no local moment. A push that will fail ${CI_WORKFLOW} passed every local gate and only failed ~20 minutes later in CI`
    ).toBeDefined();
    expect(gates()[GATE_ID]?.[MOMENT]).toBeDefined();
  });

  it("names a task that exists and resolves to the prover CI runs", () => {
    const declaration = gates()[GATE_ID]?.[MOMENT] as Declaration | undefined;

    expect(declaration?.run).toBe(TASK);
    // A gate naming a task that does not exist is the same nothing as a gate
    // that is not declared, and it reads as wired.
    expect(scripts()[TASK]).toContain(PROVER);
    // And it must be the prover CI runs, not a second copy: the whole point is
    // that the local answer and the CI answer are the same answer.
    expect(read(CI_WORKFLOW)).toContain(`run: bun run ${TASK}`);
  });

  it("reaches the push moment through the runner's own resolution", () => {
    // The assertion that actually distinguishes wired from declared-looking.
    // `lisa-run-gates.mjs --moment=push` runs exactly what `resolveMoment`
    // returns, so this is the pre-push hook's own question asked here. It
    // answered `false` on 4.45.8 and answers `true` now.
    const resolved = resolveMoment({
      gates: gates(),
      moment: MOMENT,
      runner: config().gates.runner,
      scripts: scripts(),
    }) as Array<{ id: string; task?: string; level?: string }>;

    const gate = resolved.find(entry => entry.id === GATE_ID);

    expect(gate, `no push gate resolves ${TASK}`).toBeDefined();
    expect(gate?.task).toBe(TASK);
  });

  it("is required, because its verdict is scoped to the tree being pushed", () => {
    const declaration = gates()[GATE_ID]?.[MOMENT] as Declaration | undefined;

    // Unlike `x-orphan-fixture-processes`, whose match is $TMPDIR-global and
    // therefore reports a sibling agent's residue to every other agent, this
    // prover reads only the checkout it runs in. There is no cross-run false
    // positive to soften, and CI refuses the same tree outright — an
    // `optional` local arm would print a warning for a push that cannot merge.
    expect(declaration?.level).toBe("required");
  });

  it("is NOT declared at commit, where the prover refuses to run at all", () => {
    // Pins the placement argument. `check-plugins-sync.sh` exits 1 with
    // "plugins/ has uncommitted changes before the sync check could run"
    // rather than answering, and a merge is uncommitted by definition — so a
    // commit-moment arm would emit a refusal-to-run on every merge commit,
    // which is the failure that gets a gate ignored rather than obeyed.
    expect(
      gates()[GATE_ID]?.[REFUSING_MOMENT],
      "a commit-moment arm fires the prover's refusal-to-run on every merge; see CodySwannGT/lisa#3891"
    ).toBeUndefined();
    expect(read(PROVER)).toContain(
      "has uncommitted changes before the sync check could run"
    );
  });

  it("still has a prover that fails rather than warns on divergence", () => {
    // The pass arm and the bite arm share one prover, so the thing worth
    // pinning is that its divergence branch is fatal. If this text or its
    // `exit 1` ever softens, the gate above keeps reporting PASSED on a tree
    // CI will refuse — the exact green-that-proves-nothing this gate exists to
    // close, one layer down.
    const prover = read(PROVER);

    expect(prover).toContain(
      "Generated plugin artifacts are out of sync with plugins/src."
    );
    expect(prover).toContain("set -euo pipefail");
  });
});
