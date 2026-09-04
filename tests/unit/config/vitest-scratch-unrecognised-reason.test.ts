/**
 * Why an entry could not be bound, not merely that it could not.
 *
 * `unrecognised` was one word covering four conditions, and the refusal
 * reported none of them. That is not a cosmetic gap: the conditions have
 * opposite causes and opposite remedies, and two of them are indistinguishable
 * from a count.
 *
 * A root with no marker *yet* is a run allocating right now — transient, and
 * nothing is wrong. A root that never had one was written by something that
 * does not write markers at all — durable, and the namespace is shared with a
 * writer that predates the owner-marker contract. Same word, same count, same
 * failure text, opposite conclusions. An evening of refusals could not be
 * attributed because of it.
 *
 * These cases pin the distinction, because the distinction is what turns the
 * next real refusal into a diagnosis instead of another sample.
 * @module tests/unit/config/vitest-scratch-unrecognised-reason
 */
import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  SCRATCH_NAMESPACE,
  removeScratchDir,
} from "../../../src/configs/vitest/scratch.js";
import {
  describeResidueFailure,
  sweepThenInspect,
} from "../../../src/configs/vitest/scratch-global-setup.js";
import { SCRATCH_OWNER_FILE } from "../../../src/configs/vitest/scratch-owner.js";
import { withProcessPlatformTempRoot } from "../../helpers/template-toolchain.js";

/**
 * Report every recorded process as dead.
 * @returns Always false
 */
const NEVER_ALIVE = (): boolean => false;

const DEAD_ROOT = "run-111-1000-dead01";
const NAMESPACE_LABEL = "/srv/scratch/lisa-scratch";
const ABSENT_ROOT = "run-222-2000-absent";
const UNREADABLE_ROOT = "run-333-3000-unread";

/** The reason an unparseable or oversized marker earns. */
const UNREADABLE = "marker-unreadable" as const;

/** The reason a root with no marker at all earns. */
const ABSENT = "marker-absent" as const;

const temporaryBases: string[] = [];

/**
 * Build one isolated exact namespace.
 * @returns Isolated namespace path
 */
const makeNamespace = (): string => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "scratch-reason-base-"));
  const namespace = path.join(base, SCRATCH_NAMESPACE);
  temporaryBases.push(base);
  fs.mkdirSync(namespace, { mode: 0o700 });
  return namespace;
};

/**
 * Run a control under the concurrency-scoped authority seam.
 * @param namespace - Isolated exact namespace
 * @param operation - Control to execute
 * @returns Control result
 */
const withNamespaceAuthority = <T>(namespace: string, operation: () => T): T =>
  withProcessPlatformTempRoot(path.dirname(namespace), operation);

afterEach(() => {
  for (const base of temporaryBases.splice(0)) removeScratchDir(base);
});

describe("classifying why an entry is unrecognised", () => {
  it.each([
    ["corrupt", "not-json"],
    ["oversized", "x".repeat(20_000)],
  ])("preserves and refuses a single %s owner marker", (_kind, contents) => {
    const dir = makeNamespace();
    const root = path.join(dir, DEAD_ROOT);
    fs.mkdirSync(root);
    fs.writeFileSync(path.join(root, SCRATCH_OWNER_FILE), contents, "utf8");

    const residue = withNamespaceAuthority(dir, () =>
      sweepThenInspect(NEVER_ALIVE)
    );
    const message = describeResidueFailure(dir, residue);

    expect(fs.existsSync(root)).toBe(true);
    expect(residue).toEqual({
      orphaned: [],
      unrecognised: [DEAD_ROOT],
      unrecognisedDetail: [{ name: DEAD_ROOT, reason: UNREADABLE }],
      total: 1,
    });
    expect(message).toContain(DEAD_ROOT);
  });

  it("separates a marker that is absent from one that is unreadable", () => {
    const dir = makeNamespace();
    fs.mkdirSync(path.join(dir, ABSENT_ROOT));
    const unreadable = path.join(dir, UNREADABLE_ROOT);
    fs.mkdirSync(unreadable);
    fs.writeFileSync(path.join(unreadable, SCRATCH_OWNER_FILE), "{", "utf8");

    const residue = withNamespaceAuthority(dir, () =>
      sweepThenInspect(NEVER_ALIVE)
    );

    expect(residue.unrecognisedDetail).toEqual(
      expect.arrayContaining([
        { name: ABSENT_ROOT, reason: ABSENT },
        { name: UNREADABLE_ROOT, reason: UNREADABLE },
      ])
    );
  });
});

describe("the refusal text names the condition and its cause", () => {
  it("names each reason present with its own explanation", () => {
    const message = describeResidueFailure(NAMESPACE_LABEL, {
      orphaned: [],
      unrecognised: [ABSENT_ROOT, UNREADABLE_ROOT],
      unrecognisedDetail: [
        { name: ABSENT_ROOT, reason: ABSENT },
        { name: UNREADABLE_ROOT, reason: "identity-mismatch" },
      ],
      total: 2,
    });

    expect(message).toContain(`${ABSENT} (1): ${ABSENT_ROOT}`);
    expect(message).toContain(`identity-mismatch (1): ${UNREADABLE_ROOT}`);
    // The transient/durable split is the actionable half. A reader has to be
    // able to tell "a run is allocating right now" from "something sharing
    // this directory never writes markers" without already knowing the
    // subsystem — that is the whole reason this text exists.
    expect(message).toContain("while a run allocates it");
    expect(message).toContain("never wrote a marker");
    expect(message).toContain("moved, restored, or recreated");
  });

  it("reports only the reasons actually present", () => {
    const message = describeResidueFailure(NAMESPACE_LABEL, {
      orphaned: [],
      unrecognised: [ABSENT_ROOT],
      unrecognisedDetail: [{ name: ABSENT_ROOT, reason: "not-a-directory" }],
      total: 1,
    });

    expect(message).toContain("not-a-directory (1)");
    expect(message).not.toContain(ABSENT);
    expect(message).not.toContain("identity-mismatch");
  });
});
