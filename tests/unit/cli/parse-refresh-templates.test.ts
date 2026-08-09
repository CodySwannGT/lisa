/**
 * Resolution of the `--refresh-templates` CLI flag.
 *
 * The flag is the supported way to deliver a changed managed file — an
 * enforcement guard, say — to an already-installed project without hand-
 * deleting it first. Its shape matters: the bare form is a blunt instrument
 * over every managed file, including ones projects legitimately customise, so
 * the scoped form has to work exactly as it reads.
 * @module tests/unit/cli/parse-refresh-templates
 */
import { describe, expect, it } from "vitest";

import { mayRefreshTemplate } from "../../../src/core/config.js";
import { parseRefreshTemplates } from "../../../src/cli/shared-options.js";

const HOOKS_DIR = "scripts/lisa-hooks";
const GUARD = `${HOOKS_DIR}/block-no-verify.sh`;

describe("parseRefreshTemplates", () => {
  it("is undefined when the flag is absent", () => {
    // Absent must stay conservative: this is the default every postinstall
    // takes, and it is what protects customised host config.
    expect(parseRefreshTemplates(undefined)).toBeUndefined();
    expect(parseRefreshTemplates(false)).toBeUndefined();
  });

  it("selects everything for the bare flag", () => {
    expect(parseRefreshTemplates(true)).toEqual({ mode: "all" });
  });

  it("selects the listed paths", () => {
    expect(parseRefreshTemplates(`${HOOKS_DIR},knip.json`)).toEqual({
      mode: "paths",
      paths: [HOOKS_DIR, "knip.json"],
    });
  });

  it("tolerates whitespace and empty entries in the list", () => {
    expect(parseRefreshTemplates(" a , , b ")).toEqual({
      mode: "paths",
      paths: ["a", "b"],
    });
  });

  it("treats an empty value as the bare flag", () => {
    // `--refresh-templates=` matching no path at all would be a silent no-op
    // dressed as an opt-in, which is the failure mode this whole area exists
    // to remove.
    expect(parseRefreshTemplates("")).toEqual({ mode: "all" });
    expect(parseRefreshTemplates(" , ")).toEqual({ mode: "all" });
  });
});

describe("mayRefreshTemplate", () => {
  it("refuses everything when no selection was made", () => {
    expect(mayRefreshTemplate(GUARD, undefined)).toBe(false);
  });

  it("permits everything under mode all", () => {
    expect(mayRefreshTemplate(GUARD, { mode: "all" })).toBe(true);
    expect(mayRefreshTemplate("tsconfig.json", { mode: "all" })).toBe(true);
  });

  it("matches a directory scope by path segment", () => {
    const scope = { mode: "paths", paths: [HOOKS_DIR] } as const;
    expect(mayRefreshTemplate(GUARD, scope)).toBe(true);
    expect(mayRefreshTemplate("tsconfig.json", scope)).toBe(false);
  });

  it("does not match a sibling directory sharing a prefix", () => {
    // `scripts/lisa-hooks` must not sweep in `scripts/lisa-hooks-extra/...`.
    const scope = { mode: "paths", paths: [HOOKS_DIR] } as const;
    expect(mayRefreshTemplate(`${HOOKS_DIR}-extra/other.sh`, scope)).toBe(
      false
    );
  });

  it("matches an exact file path", () => {
    const scope = { mode: "paths", paths: [GUARD] } as const;
    expect(mayRefreshTemplate(GUARD, scope)).toBe(true);
    expect(
      mayRefreshTemplate("scripts/lisa-hooks/block-no-verify.sh.bak", scope)
    ).toBe(false);
  });

  it("ignores a trailing slash on the scope", () => {
    const scope = { mode: "paths", paths: [`${HOOKS_DIR}/`] } as const;
    expect(mayRefreshTemplate(GUARD, scope)).toBe(true);
  });
});
