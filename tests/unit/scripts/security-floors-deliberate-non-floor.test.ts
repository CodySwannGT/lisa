/**
 * "No floor by design" and "unreadable floor" are different answers (#3465).
 *
 * `resolveLowerBound` returns a null version for four structurally different
 * reasons, and `record()` sent every one of them to `unparseable` — which gates
 * `--strict` and closes with one piece of advice:
 *
 * > Fix by rewriting each one as a constraint with a lower bound — `>=x.y.z`,
 * > `^x.y.z`, `~x.y.z`, or an exact version.
 *
 * An alias cannot take that advice: its version belongs to a DIFFERENT package,
 * which is precisely why the code refuses to compare it. A `workspace:` or
 * `github:` spec cannot take it either — it names a SOURCE, not a registry
 * range, and any digits in it belong to a branch, tag or commit. So the report
 * asked for an edit that is wrong for the case in front of the reader, and
 * `--strict` failed for a coverage gap that does not exist.
 *
 * MEASURED on `origin/main` before this change, calling the shipped exports:
 *
 *     workspace:^1.2.3        null | is not a version range this check knows how to read
 *     github:org/repo#v1.2.3  null | is not a version range this check knows how to read
 *     not a range             null | is not a version range this check knows how to read
 *
 * Two deliberate non-floors and one genuinely malformed spec, one string.
 *
 * ## Why a bucket and not a branch
 *
 * The narrow reading is "add a protocol branch beside the `npm:` alias branch".
 * That would make protocol specs behave differently from aliases with nothing
 * justifying the split, and the alias case has exactly the same problem. The
 * distinction the file already draws one level up — a literal carrying no
 * digits is "not a failed attempt to state a floor" — is the right principle;
 * it was applied by a digit test, which cannot tell `workspace:*` from
 * `workspace:^1.2.3`, so it stopped applying exactly where the spec got more
 * specific.
 *
 * ## The direction this fails, which is the unusual one here
 *
 * It BLOCKS what it should pass. Nothing vulnerable slips through — the
 * upper-bound-only case still gates — so the cost is noise on a gate somebody
 * eventually switches off, not a hole. That is the opposite direction from most
 * of this family, and it is why `a genuinely malformed range still gates` below
 * is the assertion that matters most: a fix that emptied `unparseable` would
 * satisfy every other scenario while retiring the check's real purpose.
 * @module tests/unit/scripts/security-floors-deliberate-non-floor
 */
import { describe, expect, it } from "vitest";

import {
  classifyLowerBound,
  lowerBoundGap,
  lowestPermitted,
} from "../../../scripts/check-security-floors.mjs";

/** An alias: its version belongs to another package entirely. */
const ALIAS = "npm:other-package@^1.2.3";

/** A workspace protocol spec carrying digits, which the digit test lets past. */
const WORKSPACE = "workspace:^1.2.3";

/** A git protocol spec whose digits are a tag, not a registry range. */
const GITHUB = "github:org/repo#v1.2.3";

/** A spec the checker genuinely cannot read. */
const MALFORMED = "not a range";

/** Upper bound only: read perfectly, and what it says is dangerous. */
const UPPER_ONLY = "<8";

describe("a spec with no floor BY DESIGN is not an unreadable floor", () => {
  it.each([ALIAS, WORKSPACE, GITHUB])(
    "classifies %s as a deliberate non-floor",
    spec => {
      expect(classifyLowerBound(spec).kind).toBe("non-floor");
    }
  );

  it("gives an alias advice it can actually follow", () => {
    // AGENTS.md: everything crossing a gate outward must be actionable. "Rewrite
    // it as >=x.y.z" is impossible for a spec whose version names another
    // package, so the advice has to name the aliased package instead.
    const reason = classifyLowerBound(ALIAS).reason ?? "";

    expect(reason).toContain("another package");
    expect(reason).not.toContain(">=x.y.z");
  });

  it("gives a protocol spec advice that names the real reason", () => {
    // Not "unreadable": it was read fine. Its digits are a branch, tag or
    // commit, so there is no registry range to rewrite.
    const reason = classifyLowerBound(WORKSPACE).reason ?? "";

    expect(reason).toContain("source");
    expect(reason).not.toContain(">=x.y.z");
  });

  it("stops giving three different specs one identical sentence", () => {
    // The measured collapse: before this, all three read
    // "is not a version range this check knows how to read".
    expect(classifyLowerBound(WORKSPACE).reason).not.toBe(
      classifyLowerBound(MALFORMED).reason
    );
    expect(classifyLowerBound(GITHUB).reason).not.toBe(
      classifyLowerBound(MALFORMED).reason
    );
  });
});

describe("rejection controls: what must NOT move", () => {
  it("still reports a genuinely malformed range as unreadable", () => {
    // THE assertion of this suite. A fix that moved everything out of
    // `unparseable` would satisfy every scenario above and silently retire the
    // check's purpose.
    expect(classifyLowerBound(MALFORMED).kind).toBe("unreadable");
  });

  it("still reports an upper-bound-only spec as a real finding", () => {
    // `<8` was read perfectly and permits every earlier release including
    // vulnerable ones. It is neither unreadable nor a non-floor, and calling it
    // either would clear a genuine gap.
    expect(classifyLowerBound(UPPER_ONLY).kind).toBe("floorless");
  });

  it("still treats an empty spec as unreadable rather than deliberate", () => {
    expect(classifyLowerBound("").kind).toBe("unreadable");
  });

  it.each(["^8", "~2.0", "5.x", ">=5.0.7"])(
    "still resolves %s to a comparable floor",
    spec => {
      expect(classifyLowerBound(spec).kind).toBe("bound");
      expect(lowestPermitted(spec)).not.toBeNull();
    }
  );

  it("keeps the two shipped helpers answering exactly as before", () => {
    // `lowestPermitted` and `lowerBoundGap` have callers. Widening the
    // classification must not change what they return, or the fix arrives as a
    // second defect in the audit loop that consumes them.
    expect(lowestPermitted("^8")).toEqual([8, 0, 0]);
    expect(lowestPermitted(ALIAS)).toBeNull();
    expect(lowerBoundGap("^8")).toBeNull();
    expect(lowerBoundGap(MALFORMED)).toContain("know");
  });
});
