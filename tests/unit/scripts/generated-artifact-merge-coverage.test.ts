/**
 * Every generated artifact is merge-driver covered, or declared unsupported
 * for a reason that is still true (CodySwannGT/lisa#3932).
 *
 * ## What the guard is for
 *
 * `.gitattributes` mapped **two of Lisa's four** generated artifacts to the
 * merge driver, and nothing said so — an artifact joined the unregistered set
 * by being written. The obvious repair, "register the other two", is wrong:
 * measured, the driver's parser rejects both with `mixed indentation in an
 * entry block`, because it handles a flat one-level map and both are nested.
 * Mapping them would make the driver run, fail, exit 1, and leave the conflict
 * while appearing to have handled it.
 *
 * So the unregistered set is a capability boundary, and these cases hold the
 * boundary rather than erase it — including the tripwire that fires when
 * somebody widens the driver and an `unsupported` declaration goes stale.
 *
 * ## Why the entry-count condition exists
 *
 * The parser passes unrecognised regions through verbatim, so "it parses and
 * round-trips" is nearly unfalsifiable. Measured on the real hash ledger:
 * stripping every leading indent still parsed and still round-tripped exactly,
 * while structuring **0** of its 148 entries. A mapping over a file the driver
 * structures nothing in is inert, so the guard requires a non-zero count and
 * the case below pins that specific mutation.
 *
 * Per the Test Isolation house rule, expected values are HARDCODED.
 * @module tests/unit/scripts/generated-artifact-merge-coverage
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  AGGREGATE_CHECK,
  DISPOSITION,
  DRIVER,
  GENERATED_ARTIFACTS,
  driverCanStructure,
  inspectGeneratedArtifacts,
  judgeArtifact,
  mapsToDriver,
  undeclaredChecks,
} from "../../../scripts/check-generated-artifact-merge-coverage.mjs";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/** The manifest's path, named once so the ruleset's duplicate-literal rule holds. */
const MANIFEST_PATH = "src/core/upstream-evidence-manifest.ts";

/** The two-channel artifact's path, named once for the same reason. */
const TWO_CHANNEL_PATH = "scripts/two-channel-couplings.json";

/** A `.gitattributes` mapping exactly one artifact to the driver. */
const MAPPED = `${MANIFEST_PATH} merge=lisa-generated-artifact\n`;

/** One driver-declared entry, so a case can state a disposition directly. */
const DRIVEN = {
  path: MANIFEST_PATH,
  check: "check:upstream-evidence-manifest",
  disposition: DISPOSITION.DRIVER,
  reason: "",
};

/** One unsupported-declared entry, for the mirrored branches. */
const UNSUPPORTED = {
  path: TWO_CHANNEL_PATH,
  check: "check:two-channel-couplings",
  disposition: DISPOSITION.UNSUPPORTED,
  reason: "nested",
};

/** A flat artifact the driver structures — two entries, one chunk. */
const STRUCTURABLE = [
  "export const X = Object.freeze({",
  '  "a": "1",',
  '  "b": "2",',
  "});",
  "",
].join("\n");

const readArtifact = (relative: string): string =>
  readFileSync(path.join(REPO_ROOT, relative), "utf8");

describe("the declaration matches this repository", () => {
  it("passes against the real checkout", () => {
    expect(inspectGeneratedArtifacts(REPO_ROOT).violations).toEqual([]);
  });

  it("declares four artifacts", () => {
    expect(GENERATED_ARTIFACTS.length).toBe(4);
  });

  it("covers exactly the two the driver can structure", () => {
    expect(
      GENERATED_ARTIFACTS.filter(
        entry => entry.disposition === DISPOSITION.DRIVER
      ).map(entry => entry.path)
    ).toEqual([MANIFEST_PATH, "src/core/lisa-owned-hash-ledger.ts"]);
  });

  it("gives every unsupported artifact a written reason", () => {
    // `String(...)` widens deliberately. Comparing `entry.reason === ""`
    // directly does not compile: the frozen declaration gives `reason` a
    // literal union that today contains no empty string, so TypeScript calls
    // the comparison unintentional (TS2367) — the assertion is rejected
    // precisely because the tree is currently correct. Widening keeps it a
    // real guard for the entry somebody adds later with no reason written.
    const unreasoned = GENERATED_ARTIFACTS.filter(
      entry => entry.disposition === DISPOSITION.UNSUPPORTED
    )
      .map(entry => String(entry.reason).trim())
      .filter(reason => reason === "");

    expect(unreasoned).toEqual([]);
  });
});

describe("driverCanStructure", () => {
  it("accepts an artifact the driver structures", () => {
    const verdict = driverCanStructure(STRUCTURABLE);

    expect(verdict.ok).toBe(true);
    expect(verdict.entries).toBe(2);
  });

  it("rejects the nested shape the driver cannot parse", () => {
    const verdict = driverCanStructure(readArtifact(TWO_CHANNEL_PATH));

    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("mixed indentation");
  });

  it("rejects a file that parses and round-trips but structures nothing", () => {
    // The measured hole in a round-trip-only oracle: every leading indent
    // stripped, so the parser recognises no entry block and passes the whole
    // file through as opaque text — exactly reproducible, exactly inert.
    const flattened = readArtifact(
      "src/core/lisa-owned-hash-ledger.ts"
    ).replace(/\n[ \t]+/gu, "\n");
    const verdict = driverCanStructure(flattened);

    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("ZERO entries");
  });
});

describe("mapsToDriver", () => {
  it("finds an exact mapping", () => {
    expect(mapsToDriver(MAPPED, MANIFEST_PATH)).toBe(true);
  });

  it("does not match a different path", () => {
    expect(mapsToDriver(MAPPED, TWO_CHANNEL_PATH)).toBe(false);
  });

  it("does not match a mapping to some other driver", () => {
    expect(
      mapsToDriver("src/core/x.ts merge=lisa-learnings\n", "src/core/x.ts")
    ).toBe(false);
  });
});

describe("undeclaredChecks", () => {
  const pkg = (script: string): string =>
    JSON.stringify({ scripts: { [AGGREGATE_CHECK]: script } });

  it("names a check nothing declares", () => {
    expect(undeclaredChecks(pkg("bun run check:brand-new-artifact"))).toEqual([
      "check:brand-new-artifact",
    ]);
  });

  it("accepts the declared artifact checks", () => {
    expect(
      undeclaredChecks(
        pkg(
          "bun run check:upstream-evidence-manifest; bun run check:two-channel-couplings"
        )
      )
    ).toEqual([]);
  });

  it("accepts a check declared as owning no artifact", () => {
    expect(undeclaredChecks(pkg("bun run check:deletion-basis"))).toEqual([]);
  });

  it("does not report the aggregate naming itself in its own message", () => {
    // `check:artifacts` echoes its own name on failure, so it appears in its
    // own body. Reporting that would make the guard fail on a correct tree.
    expect(undeclaredChecks(pkg('echo "check:artifacts FAILED"'))).toEqual([]);
  });
});

describe("judgeArtifact", () => {
  it("passes a driver-declared artifact that is mapped and structurable", () => {
    expect(judgeArtifact(DRIVEN, MAPPED, STRUCTURABLE)).toEqual([]);
  });

  it("refuses a driver-declared artifact with no mapping", () => {
    const [violation] = judgeArtifact(DRIVEN, "", STRUCTURABLE);

    expect(violation).toContain("declared `driver` but .gitattributes");
    expect(violation).toContain(`merge=${DRIVER}`);
  });

  it("refuses a mapped artifact the driver cannot structure", () => {
    const [violation] = judgeArtifact(DRIVEN, MAPPED, "not an artifact at all");

    expect(violation).toContain("The mapping is inert");
  });

  it("refuses an unsupported artifact that is nevertheless mapped", () => {
    const attributes = `${TWO_CHANNEL_PATH} merge=${DRIVER}\n`;
    const [violation] = judgeArtifact(UNSUPPORTED, attributes, "opaque");

    expect(violation).toContain("appearing to have handled it");
  });

  it("fires the tripwire when an unsupported artifact becomes structurable", () => {
    // The case that matters most: it goes red the day somebody widens the
    // driver, naming the artifact that can now be registered. Without it the
    // declaration would stay wrong silently.
    const [violation] = judgeArtifact(UNSUPPORTED, "", STRUCTURABLE);

    expect(violation).toContain("The boundary moved");
  });

  it("passes an unsupported artifact that is unmapped and unstructurable", () => {
    expect(judgeArtifact(UNSUPPORTED, "", "opaque")).toEqual([]);
  });
});
