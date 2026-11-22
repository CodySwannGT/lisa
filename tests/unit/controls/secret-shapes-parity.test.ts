/**
 * The credential shapes the control commands look for are the ones the
 * repository already ships, and stay that way.
 *
 * `src/controls/secret-shapes.ts` restates `SECRET_SHAPES` from
 * `scripts/lib/phrase-tests/redact.mjs`, because compiled code cannot import
 * that script. Two lists drift unless something holds them together, so this
 * suite does: a shape added to, changed in or removed from one list alone
 * fails here (CodySwannGT/lisa#4999).
 */
import { describe, expect, it } from "vitest";

import { SECRET_SHAPES } from "../../../scripts/lib/phrase-tests/redact.mjs";
import {
  AUTHORIZATION_KIND,
  CREDENTIAL_KIND_NAMES,
  CREDENTIAL_SHAPES,
  NAMED_SECRET_KIND,
  credentialPlaceholder,
  describeCredentialKind,
} from "../../../src/controls/secret-shapes.js";

/** What makes a shape what it is, as plain data that can be compared. */
interface PlainShape {
  readonly kind: string;
  readonly source: string;
  readonly flags: string;
  readonly replace: string | null;
}

/**
 * Write a list of shapes as plain data.
 * @param shapes - The shapes
 * @returns One entry per shape, in order
 */
function plain(
  shapes: readonly {
    readonly kind: string;
    readonly re: RegExp;
    readonly replace?: string;
  }[]
): readonly PlainShape[] {
  return shapes.map(shape => ({
    kind: shape.kind,
    source: shape.re.source,
    flags: shape.re.flags,
    replace: shape.replace ?? null,
  }));
}

describe("the credential shapes the control commands look for", () => {
  it("are exactly the shapes the repository already ships, in the same order", () => {
    expect(plain(CREDENTIAL_SHAPES)).toEqual(plain(SECRET_SHAPES));
  });

  it("are not an empty list", () => {
    expect(CREDENTIAL_SHAPES.length).toBeGreaterThan(10);
  });

  it("each find every run, not only the first", () => {
    expect(CREDENTIAL_SHAPES.filter(shape => !shape.re.global)).toEqual([]);
  });

  it("each have a name an operator can read", () => {
    const kinds = [
      ...new Set([
        ...CREDENTIAL_SHAPES.map(shape => shape.kind),
        AUTHORIZATION_KIND,
        NAMED_SECRET_KIND,
      ]),
    ];

    expect(
      kinds.filter(kind => CREDENTIAL_KIND_NAMES[kind] === undefined)
    ).toEqual([]);
    expect(describeCredentialKind("GITHUB_TOKEN")).toBe("a GitHub token");
    expect(describeCredentialKind("NOT_A_KIND")).toBe("a credential");
  });

  it("are replaced by a placeholder that says what was there", () => {
    expect(credentialPlaceholder("GITHUB_TOKEN")).toBe(
      "[REDACTED:GITHUB_TOKEN]"
    );
  });
});
