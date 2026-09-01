/**
 * A renamed managed-block marker must not orphan the block it replaced.
 *
 * Every managed-block writer in Lisa has the same shape: look for a marker,
 * and if `indexOf` says it is absent, append. That is idempotent while the
 * marker text never changes, and it fails ADDITIVELY and SILENTLY the moment
 * it does — the reader looks for the new text in a file containing the old,
 * concludes it has never written here, and appends a second block.
 *
 * This module is the worst place in Lisa for that failure. It writes into
 * `~/.aws` files and a shell profile, outside any repository, where no apply,
 * diff, or review ever revisits the result. And the orphan is not inert: a
 * stale block in a shell profile is STILL SOURCED, and profiles apply
 * assignments in order, so whichever block comes last wins. An operator can
 * end up running under credentials from a block Lisa believes it no longer
 * manages.
 *
 * These tests assert the PROPERTY — one block, and it is the current one —
 * rather than that the marker string changed. A test that only checked the
 * text would pass against a reader that still appends.
 *
 * The suite does two distinct jobs, and it is worth separating them because
 * only one of them fails against the pre-fix source:
 *
 *  - Cases seeded with a marker of a DIFFERENT version fail against the
 *    pre-fix reader, which appends a second block. They are the bite proof.
 *  - Cases seeded with the exact literal that shipped before the version bump
 *    pass in both worlds, because that literal was what the pre-fix reader
 *    wrote and looked for. They are not bite proof and are not claimed as it —
 *    they prove the family recogniser still finds the ENTIRE population in the
 *    field, which is the thing that would silently orphan every operator's
 *    block if the regex were wrong.
 *
 * The defect is latent by nature: the pre-fix reader is correct right up until
 * the first rename, and wrong forever after. So a test that fails against it
 * has to contain a rename.
 *
 * Everything here runs against a temp HOME. Nothing in this file may touch a
 * real `~/.aws` or a real shell profile.
 * @module tests/unit/secrets/managed-marker-orphans
 */
import * as fs from "fs-extra";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  collidingProfiles,
  installProfileSourcing,
  upsertManagedBlock,
} from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/materialize-secrets.mjs";

/**
 * The EXACT marker text shipped before the family recogniser existed.
 *
 * Hardcoded rather than derived. Every block in the field today carries this
 * literal, and deriving it from the module would make the test agree with
 * whatever the module currently thinks — which is the failure under test.
 */
const OLD_PROFILE_START = "# >>> lisa secrets (managed) >>>";

/** Its closing half, equally hardcoded. */
const OLD_PROFILE_END = "# <<< lisa secrets (managed) <<<";

/** The pre-family `~/.aws` marker, likewise the literal that shipped. */
const OLD_AWS_START = "# >>> managed by lisa-secrets-access >>>";

/** Its closing half. */
const OLD_AWS_END = "# <<< managed by lisa-secrets-access <<<";

/**
 * A marker from some OTHER version of the family.
 *
 * This is what makes a case bite: the reader must be looking for text that
 * differs from what the fixture carries, which is the situation the first
 * rename creates and the pre-fix reader answers by appending.
 */
const OTHER_PROFILE_START = "# >>> lisa secrets (managed v1) >>>";

/** Operator-owned text after a deliberately truncated managed block. */
const OPERATOR_TAIL = "# operator content after the truncated block";

/** Its closing half. */
const OTHER_PROFILE_END = "# <<< lisa secrets (managed v1) <<<";

/** The same, for an `~/.aws` managed region. */
const OTHER_AWS_START = "# >>> managed by lisa-secrets-access v1 >>>";

/** Its closing half. */
const OTHER_AWS_END = "# <<< managed by lisa-secrets-access v1 <<<";

/** Recognises a managed block of the profile family, whatever its version. */
const PROFILE_FAMILY_RE = /# >>> lisa secrets \(managed[^\n]*>>>/g;

/** Recognises an `~/.aws` managed block of any version. */
const AWS_FAMILY_RE = /# >>> managed by lisa-secrets-access[^\n]*>>>/g;

/**
 * How many managed blocks of a family the text carries.
 * @param text File contents.
 * @param recogniser Global family recogniser.
 * @returns The match count.
 */
function blockCount(text: string, recogniser: RegExp): number {
  // `exec` in a loop rather than `match`: the linter is right that `match`
  // with a global flag hides whether the regex is stateful, and this one is.
  recogniser.lastIndex = 0;
  const found: string[] = [];
  for (
    let hit = recogniser.exec(text);
    hit !== null;
    hit = recogniser.exec(text)
  ) {
    found.push(hit[0]);
  }
  return found.length;
}

/** The values file an older block points at. */
const OLD_VALUES = "/old/values.env";

/** The values file the current run points at. */
const NEW_VALUES = "/new/values.env";

/** The sourcing line a fixture block carries. */
const OLD_SOURCE_LINE = `. "${OLD_VALUES}"`;

/** The project every case here writes as. */
const OWNER = "acmeco";

/** The `.aws` profile name every case here writes. */
const PROFILE = "agent-dev";

/** Its TOML-ish section header in an `~/.aws/config`. */
const PROFILE_HEADER = `[profile ${PROFILE}]`;

/** An operator-authored line, used to prove surrounding content survives. */
const HOST_PATH_LINE = "export PATH=/usr/local/bin:$PATH";

/** The region an older block already carries. */
const STALE_REGION = "region = us-west-2";

/** A region belonging to a profile the operator owns. */
const HOST_REGION = "region = us-east-1";

/** A profile the operator owns, used to prove host content survives. */
const HOST_PROFILE_HEADER = "[profile someone-elses]";

let home = "";

beforeEach(() => {
  // A temp HOME, always. This module's real target is an operator's home
  // directory, and a fixture that reached it would be the bug with a test
  // harness attached.
  home = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-marker-home-"));
});

afterEach(() => {
  fs.removeSync(home);
});

describe("a shell profile written under a previous marker", () => {
  it("refuses an unclosed managed block without changing the profile", () => {
    const profile = path.join(home, ".bashrc");
    const before = [
      HOST_PATH_LINE,
      OTHER_PROFILE_START,
      OLD_SOURCE_LINE,
      OPERATOR_TAIL,
      "",
    ].join("\n");
    fs.writeFileSync(profile, before);

    expect(() =>
      installProfileSourcing(NEW_VALUES, { home, owner: OWNER })
    ).toThrow(/no closing marker/i);
    expect(fs.readFileSync(profile, "utf8")).toBe(before);
  });

  it("is replaced in place rather than joined by a second block", () => {
    const profile = path.join(home, ".bashrc");
    fs.writeFileSync(
      profile,
      [
        HOST_PATH_LINE,
        "",
        OLD_PROFILE_START,
        'if [ -f "/old/values.env" ]; then',
        "  set -a",
        '  . "/old/values.env"',
        "  set +a",
        "fi",
        OLD_PROFILE_END,
        "",
      ].join("\n")
    );

    installProfileSourcing(NEW_VALUES, { home, owner: OWNER });

    const after = fs.readFileSync(profile, "utf8");
    expect(blockCount(after, PROFILE_FAMILY_RE)).toBe(1);
  });

  it("is replaced in place when the marker version differs", () => {
    // The bite case for the shell profile, and the one with the credential
    // consequence: a surviving older block is still sourced, and the last
    // assignment wins.
    const profile = path.join(home, ".bashrc");
    fs.writeFileSync(
      profile,
      [
        HOST_PATH_LINE,
        "",
        OTHER_PROFILE_START,
        OLD_SOURCE_LINE,
        OTHER_PROFILE_END,
        "",
      ].join("\n")
    );

    installProfileSourcing(NEW_VALUES, { home, owner: OWNER });

    const after = fs.readFileSync(profile, "utf8");
    expect(blockCount(after, PROFILE_FAMILY_RE)).toBe(1);
    expect(after).not.toContain(OLD_VALUES);
    expect(after).toContain(HOST_PATH_LINE);
  });

  it("leaves no assignment from the superseded block behind", () => {
    // The property that makes this a credential defect rather than clutter.
    // A surviving older block is still sourced, and the last one sourced wins.
    const profile = path.join(home, ".bashrc");
    fs.writeFileSync(
      profile,
      [OLD_PROFILE_START, OLD_SOURCE_LINE, OLD_PROFILE_END, ""].join("\n")
    );

    installProfileSourcing(NEW_VALUES, { home, owner: OWNER });

    const after = fs.readFileSync(profile, "utf8");
    expect(after).not.toContain(OLD_VALUES);
    expect(after).toContain(NEW_VALUES);
  });

  it("keeps the operator's own lines on either side", () => {
    const profile = path.join(home, ".profile");
    fs.writeFileSync(
      profile,
      [
        "# operator's own line, above",
        OLD_PROFILE_START,
        OLD_SOURCE_LINE,
        OLD_PROFILE_END,
        "# operator's own line, below",
        "",
      ].join("\n")
    );

    installProfileSourcing(NEW_VALUES, { home, owner: OWNER });

    const after = fs.readFileSync(profile, "utf8");
    expect(after).toContain("# operator's own line, above");
    expect(after).toContain("# operator's own line, below");
  });

  it("repairs a profile already carrying two orphans from an earlier rename", () => {
    // The population this fix meets is not clean: no operation has ever
    // revisited these files, so some already carry damage. Coming out with
    // exactly one block is what separates a fix from one more append.
    const profile = path.join(home, ".bashrc");
    fs.writeFileSync(
      profile,
      [
        OLD_PROFILE_START,
        '. "/oldest/values.env"',
        OLD_PROFILE_END,
        "# >>> lisa secrets (managed v1) >>>",
        '. "/older/values.env"',
        "# <<< lisa secrets (managed v1) <<<",
        "",
      ].join("\n")
    );

    installProfileSourcing(NEW_VALUES, { home, owner: OWNER });

    const after = fs.readFileSync(profile, "utf8");
    expect(blockCount(after, PROFILE_FAMILY_RE)).toBe(1);
    expect(after).not.toContain("/oldest/values.env");
    expect(after).not.toContain("/older/values.env");
  });
});

describe("an ~/.aws file written under a previous marker", () => {
  it("refuses an unclosed managed block instead of deleting its tail", () => {
    const before = [
      HOST_PROFILE_HEADER,
      HOST_REGION,
      OTHER_AWS_START,
      PROFILE_HEADER,
      STALE_REGION,
      OPERATOR_TAIL,
      "",
    ].join("\n");

    expect(() =>
      upsertManagedBlock(
        before,
        `${PROFILE_HEADER}\nregion = us-west-1`,
        OWNER,
        true
      )
    ).toThrow(/no closing marker/i);
    expect(before).toContain(OPERATOR_TAIL);
  });

  it("gets no second block appended", () => {
    const existing = [
      HOST_PROFILE_HEADER,
      HOST_REGION,
      "",
      OLD_AWS_START,
      PROFILE_HEADER,
      STALE_REGION,
      OLD_AWS_END,
      "",
    ].join("\n");

    const merged = upsertManagedBlock(
      existing,
      `${PROFILE_HEADER}\nregion = eu-west-1`,
      OWNER,
      true
    );

    expect(blockCount(merged, AWS_FAMILY_RE)).toBe(1);
  });

  it("gets no second block when the marker version differs", () => {
    // The bite case for this area: the reader is looking for a version the
    // file does not carry, which is exactly what the first rename produces.
    const existing = [
      HOST_PROFILE_HEADER,
      "",
      OTHER_AWS_START,
      PROFILE_HEADER,
      STALE_REGION,
      OTHER_AWS_END,
      "",
    ].join("\n");

    const merged = upsertManagedBlock(
      existing,
      `${PROFILE_HEADER}\nregion = eu-west-1`,
      OWNER,
      true
    );

    expect(blockCount(merged, AWS_FAMILY_RE)).toBe(1);
    expect(merged).not.toContain(STALE_REGION);
    expect(merged).toContain(HOST_PROFILE_HEADER);
  });

  it("keeps a profile the operator defined outside the block", () => {
    const existing = [
      HOST_PROFILE_HEADER,
      HOST_REGION,
      "",
      OLD_AWS_START,
      PROFILE_HEADER,
      OLD_AWS_END,
      "",
    ].join("\n");

    const merged = upsertManagedBlock(existing, PROFILE_HEADER, OWNER, true);

    expect(merged).toContain(HOST_PROFILE_HEADER);
    expect(merged).toContain(HOST_REGION);
  });

  it("does not carry the superseded region forward", () => {
    const existing = [
      OLD_AWS_START,
      PROFILE_HEADER,
      STALE_REGION,
      OLD_AWS_END,
      "",
    ].join("\n");

    const merged = upsertManagedBlock(
      existing,
      `${PROFILE_HEADER}\nregion = eu-west-1`,
      OWNER,
      true
    );

    expect(merged).toContain("eu-west-1");
    expect(merged).not.toContain(STALE_REGION);
  });
});

describe("collision detection across a marker change", () => {
  it("does not read our own older block as a host-owned collision", () => {
    // The inverse failure. If an orphaned block counts as "outside", the very
    // profile names Lisa wrote last time look like the operator's, and the
    // next run refuses to write them.
    const dir = path.join(home, ".aws");
    fs.ensureDirSync(dir);
    fs.writeFileSync(
      path.join(dir, "config"),
      [OLD_AWS_START, PROFILE_HEADER, OLD_AWS_END, ""].join("\n")
    );

    expect(collidingProfiles(dir, [PROFILE], { owner: OWNER })).toEqual([]);
  });

  it("does not read an older-version block as a host-owned collision", () => {
    // The bite case for collision detection. Pre-fix, an orphan left by a
    // rename lies OUTSIDE the recognised block, so the profile names Lisa
    // itself wrote last time read as the operator's and the next run refuses
    // to write them — Lisa blocked by its own output.
    const dir = path.join(home, ".aws");
    fs.ensureDirSync(dir);
    fs.writeFileSync(
      path.join(dir, "config"),
      [OTHER_AWS_START, PROFILE_HEADER, OTHER_AWS_END, ""].join("\n")
    );

    expect(collidingProfiles(dir, [PROFILE], { owner: OWNER })).toEqual([]);
  });

  it("still reports a genuine host-owned collision", () => {
    // The control. Without it, the assertion above would also pass against a
    // detector that had simply stopped detecting anything.
    const dir = path.join(home, ".aws");
    fs.ensureDirSync(dir);
    fs.writeFileSync(
      path.join(dir, "config"),
      [PROFILE_HEADER, HOST_REGION, ""].join("\n")
    );

    expect(collidingProfiles(dir, [PROFILE], { owner: OWNER })).toEqual([
      { name: PROFILE, owner: null },
    ]);
  });
});
