/**
 * The prover's `--publish` mode, under more than one name: the verdict a run
 * judged is published once per declared reviewer (CodySwannGT/lisa#4738).
 *
 * The verdict covers every declared reviewer, but it was published only under
 * the name of the reviewer that woke the run. A red `(A)` therefore stayed red
 * after B's later review made the head acceptable, because B's run updated only
 * `(B)`; and a manual run, which names no reviewer, could update neither. Each
 * publishing run now posts the same verdict under every declared reviewer's
 * name, plus the waking reviewer's, plus the bare name on a manual run.
 * @module tests/unit/scripts/third-party-review-evidence-publish-contexts
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  EVIDENCE_OUTCOMES,
  main,
} from "../../../all/copy-overwrite/scripts/check-third-party-review-evidence.mjs";

const HEAD = "a".repeat(40);
const VERDICT_FILE = "/runner/temp/verdict.json";
const BARE = "🕵️ Third-party review evidence";

/**
 * The gates block declaring these reviewer contexts, one gate each.
 * @param contexts - Reviewer contexts, as each gate's `await`
 * @returns A `gates` block
 */
const declaring = (...contexts: string[]) =>
  Object.fromEntries(
    contexts.map((context, index) => [
      `review-${index}`,
      {
        "pull-request": {
          level: "required",
          await: context,
          evidence: { reviewer: true },
        },
      },
    ])
  );

/**
 * A saved verdict for one outcome, with a reading per context.
 * @param outcome - The outcome
 * @param contexts - Contexts the saved readings name
 * @returns Its JSON text, as `--json` writes it
 */
const saved = (outcome: string, ...contexts: string[]) =>
  JSON.stringify({
    outcome,
    sha: HEAD,
    readings: contexts.map(context => ({
      context,
      reviewed: true,
      reading: "reviewed",
    })),
  });

/** What one publish run did. */
interface PublishRun {
  readonly code: number;
  readonly out: string;
  readonly err: string;
  readonly names: readonly string[];
  readonly conclusions: readonly string[];
}

/**
 * Run `--publish` once against a saved verdict.
 * @param options - The run
 * @param options.verdict - The saved verdict text
 * @param options.proverExit - The prover step's exit code
 * @param options.context - The waking reviewer; empty on a manual run
 * @param options.gates - The gates block; read from `--root` when absent
 * @param options.root - The checkout `--root` names
 * @param options.refuse - Check-run names GitHub refuses to create
 * @returns The run
 */
function publish({
  verdict,
  proverExit = "0",
  context,
  gates,
  root,
  refuse = [],
}: {
  verdict: string;
  proverExit?: string;
  context: string;
  gates?: Record<string, unknown>;
  root?: string;
  refuse?: readonly string[];
}): PublishRun {
  const out: string[] = [];
  const err: string[] = [];
  const bodies: Array<{ name: string; conclusion: string }> = [];
  const code = main(
    [
      `--publish=${VERDICT_FILE}`,
      `--prover-exit=${proverExit}`,
      `--sha=${HEAD}`,
      `--context=${context}`,
      "--repo=acme/code",
      ...(root === undefined ? [] : [`--root=${root}`]),
    ],
    {
      ...(gates === undefined ? {} : { gates }),
      readFile: () => verdict,
      gh: (_args: string[], input: string) => {
        const body = JSON.parse(input) as { name: string; conclusion: string };
        bodies.push(body);
        if (refuse.includes(body.name)) {
          throw new Error(`HTTP 422: refused ${body.name}`);
        }
        return '{"id": 1}';
      },
      appendSummary: () => undefined,
      out: {
        write: (text: string) => {
          out.push(text);
        },
      },
      err: {
        write: (text: string) => {
          err.push(text);
        },
      },
    }
  );
  return {
    code,
    out: out.join(""),
    err: err.join(""),
    names: bodies.map(body => body.name),
    conclusions: bodies.map(body => body.conclusion),
  };
}

describe("--publish under every declared reviewer", () => {
  const temps: string[] = [];

  afterEach(() => {
    for (const dir of temps.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("publishes the supplied context's check run, as before, when nothing else is declared", () => {
    const run = publish({
      verdict: saved(EVIDENCE_OUTCOMES.satisfied),
      context: "A",
      gates: {},
    });

    expect(run.code).toBe(0);
    expect(run.names).toEqual([`${BARE} (A)`]);
  });

  it("updates every declared reviewer's check run, so a later verdict clears a stale one", () => {
    // Scenario B: A's run published (A) as failure while B's review was
    // hollow. B's proper review wakes a run that must clear (A) as well.
    const run = publish({
      verdict: saved(EVIDENCE_OUTCOMES.satisfied, "A", "B"),
      context: "B",
      gates: declaring("A", "B"),
    });

    expect(run.code).toBe(0);
    expect(run.names).toEqual([`${BARE} (B)`, `${BARE} (A)`]);
    expect(run.conclusions).toEqual(["success", "success"]);
    expect(run.out).toContain(`Published "${BARE} (A)"`);
    expect(run.out).toContain(`Published "${BARE} (B)"`);
  });

  it("publishes the bare name and every declared reviewer's on a manual run with no context", () => {
    const run = publish({
      verdict: saved(EVIDENCE_OUTCOMES.substituted),
      context: "",
      gates: declaring("A", "B"),
    });

    expect(run.code).toBe(0);
    expect(run.names).toEqual([BARE, `${BARE} (A)`, `${BARE} (B)`]);
  });

  it("publishes each name once when the supplied context is also declared", () => {
    const run = publish({
      verdict: saved(EVIDENCE_OUTCOMES.unsatisfied, "A"),
      proverExit: "1",
      context: "A",
      gates: declaring("A", "A"),
    });

    expect(run.code).toBe(0);
    expect(run.names).toEqual([`${BARE} (A)`]);
    expect(run.conclusions).toEqual(["failure"]);
  });

  it("takes declared reviewers from the saved verdict's readings when the config names none", () => {
    const run = publish({
      verdict: saved(EVIDENCE_OUTCOMES.satisfied, "A", "B"),
      context: "",
      gates: {},
    });

    expect(run.names).toEqual([BARE, `${BARE} (A)`, `${BARE} (B)`]);
  });

  it("takes the union of the config's reviewers and the readings', each once", () => {
    const run = publish({
      verdict: saved(EVIDENCE_OUTCOMES.satisfied, "A", "B"),
      context: "A",
      gates: declaring("B", "C"),
    });

    expect(run.names).toEqual([`${BARE} (A)`, `${BARE} (B)`, `${BARE} (C)`]);
  });

  it("still updates every declared reviewer when the verdict carries no readings", () => {
    // An unreadable pull-request list saves a verdict with no readings at
    // all; the config still names the reviewers whose checks it judged.
    const run = publish({
      verdict: saved(EVIDENCE_OUTCOMES.pullRequestsUnreadable),
      proverExit: "1",
      context: "",
      gates: declaring("A"),
    });

    expect(run.names).toEqual([BARE, `${BARE} (A)`]);
    expect(run.conclusions).toEqual(["failure", "failure"]);
  });

  it("reads the declared reviewers from the checkout's own config", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "publish-contexts-"));
    temps.push(root);
    fs.writeFileSync(
      path.join(root, ".lisa.config.json"),
      JSON.stringify({ gates: declaring("A", "B") })
    );

    const run = publish({
      verdict: saved(EVIDENCE_OUTCOMES.satisfied),
      context: "B",
      root,
    });

    expect(run.names).toEqual([`${BARE} (B)`, `${BARE} (A)`]);
  });

  it("publishes nothing, under any name, for an outcome that publishes nothing", () => {
    const run = publish({
      verdict: saved(EVIDENCE_OUTCOMES.notAConfiguredReviewer),
      context: "Some Other App",
      gates: declaring("A", "B"),
    });

    expect(run.code).toBe(0);
    expect(run.names).toEqual([]);
    expect(run.out).toContain("Nothing published");
  });

  it("fails, naming the refused check run, when GitHub refuses one of several", () => {
    const run = publish({
      verdict: saved(EVIDENCE_OUTCOMES.satisfied),
      context: "B",
      gates: declaring("A", "B"),
      refuse: [`${BARE} (A)`],
    });

    expect(run.code).toBe(1);
    // Every name is still attempted, so one refusal leaves no other stale.
    expect(run.names).toEqual([`${BARE} (B)`, `${BARE} (A)`]);
    expect(run.err).toContain(`The check run "${BARE} (A)" was not published`);
    expect(run.err).toContain(`refused ${BARE} (A)`);
    expect(run.err).not.toContain(`"${BARE} (B)" was not published`);
    expect(run.out).toContain(`Published "${BARE} (B)"`);
  });
});
