import { describe, expect, it } from "vitest";

import {
  classifyManagedBanner,
  describeStaleManagedBanners,
  MAX_NAMED_STALE_BANNERS,
  type ShippedTemplateStrategy,
} from "../../../src/core/stale-managed-banner.js";

/** The header a `copy-overwrite` template carries, as shipped. */
const MANAGED_HEADER = [
  "# This file is managed by Lisa and IS replaced on each `lisa` run.",
  "# Do not edit directly — durable changes belong upstream in Lisa.",
].join("\n");

/** The header a `create-only` template carries, as shipped. */
const SEEDED_HEADER = [
  "# Seeded by Lisa on first setup — this file is YOURS.",
  "# Lisa will not overwrite it. (copy-overwrite assets ARE replaced each run.)",
].join("\n");

/** The retired wording, still carried by long-lived consumer copies. */
const RETIRED_MANAGED_HEADER =
  "# This file is managed by Lisa; changes will be overwritten on the next `lisa` run.";

/** Destination of the workflow template used as the still-shipped control. */
const QUALITY_WORKFLOW = ".github/workflows/quality.yml";

/** Destination of the workflow whose template was removed upstream. */
const BUILD_WORKFLOW = ".github/workflows/build.yml";

/** Destination of the workflow whose template moved to `create-only`. */
const CI_WORKFLOW = ".github/workflows/ci.yml";

/** The strategy under which a still-managed template ships. */
const COPY_OVERWRITE = "copy-overwrite";

/** The verdict for a file that makes no managed claim at all. */
const NOT_MANAGED = { kind: "not-managed" } as const;

/** A workflow body with no ownership header of any kind. */
const HOST_BODY = "name: nightly\non:\n  schedule:\n    - cron: '0 3 * * *'";

/** A file carrying the managed banner over an ordinary workflow body. */
const MANAGED_FILE = `${MANAGED_HEADER}\n\n${HOST_BODY}`;

/**
 * Build a shipped index from destination/strategy pairs.
 * @param entries - Destination path paired with the strategy shipping it
 * @returns The index `classifyManagedBanner` reads
 */
const shipped = (
  ...entries: readonly (readonly [string, ShippedTemplateStrategy])[]
): ReadonlyMap<string, ShippedTemplateStrategy> =>
  new Map([[".prettierrc.json", "create-only"], ...entries]);

describe("classifyManagedBanner", () => {
  it("reports a managed banner whose template no longer ships as retired", () => {
    expect(
      classifyManagedBanner(
        BUILD_WORKFLOW,
        MANAGED_FILE,
        shipped([QUALITY_WORKFLOW, COPY_OVERWRITE])
      )
    ).toEqual({ kind: "retired" });
  });

  it("accepts the retired wording of the same banner", () => {
    expect(
      classifyManagedBanner(
        BUILD_WORKFLOW,
        `${RETIRED_MANAGED_HEADER}\n\n${HOST_BODY}`,
        shipped()
      )
    ).toEqual({ kind: "retired" });
  });

  it("leaves a banner alone when the template still ships copy-overwrite", () => {
    expect(
      classifyManagedBanner(
        QUALITY_WORKFLOW,
        MANAGED_FILE,
        shipped([QUALITY_WORKFLOW, COPY_OVERWRITE])
      )
    ).toEqual({ kind: "accurate" });
  });

  it("leaves a banner alone when some other strategy still writes the path", () => {
    expect(
      classifyManagedBanner(
        ".gitignore",
        MANAGED_FILE,
        shipped([".gitignore", "other"])
      )
    ).toEqual({ kind: "accurate" });
  });

  it("separates a template that moved to create-only from one that was removed", () => {
    expect(
      classifyManagedBanner(
        CI_WORKFLOW,
        MANAGED_FILE,
        shipped([CI_WORKFLOW, "create-only"])
      )
    ).toEqual({ kind: "overstated" });
  });

  it("says nothing about a file carrying the seed header", () => {
    expect(
      classifyManagedBanner(
        ".github/workflows/deploy.yml",
        `${SEEDED_HEADER}\n\n${HOST_BODY}`,
        shipped()
      )
    ).toEqual(NOT_MANAGED);
  });

  it("says nothing about a file the host wrote itself", () => {
    expect(
      classifyManagedBanner(
        ".github/workflows/nightly.yml",
        HOST_BODY,
        shipped()
      )
    ).toEqual(NOT_MANAGED);
  });

  it("refuses to answer against an empty index rather than condemning everything", () => {
    expect(() =>
      classifyManagedBanner(BUILD_WORKFLOW, MANAGED_FILE, new Map())
    ).toThrow(/empty template index/u);
  });

  it("does not read an ownership claim out of the file body", () => {
    const body = ["name: ci", "", "", "", "# managed by Lisa"].join("\n");
    expect(classifyManagedBanner(CI_WORKFLOW, body, shipped())).toEqual(
      NOT_MANAGED
    );
  });

  it("compares Windows-separated paths against POSIX destinations", () => {
    expect(
      classifyManagedBanner(
        ".github\\workflows\\quality.yml",
        MANAGED_FILE,
        shipped([QUALITY_WORKFLOW, COPY_OVERWRITE])
      )
    ).toEqual({ kind: "accurate" });
  });
});

describe("describeStaleManagedBanners", () => {
  it("names the files and states that the file itself is untouched", () => {
    const detail = describeStaleManagedBanners([BUILD_WORKFLOW]);
    expect(detail).toContain(BUILD_WORKFLOW);
    expect(detail).toContain("yours");
    expect(detail).not.toContain("delete the file");
  });

  it("caps how many it names inline and says how many it withheld", () => {
    const paths = Array.from(
      { length: MAX_NAMED_STALE_BANNERS + 3 },
      (_unused, index) => `scripts/retired-${index}.mjs`
    );
    const detail = describeStaleManagedBanners(paths);
    expect(detail).toContain("scripts/retired-0.mjs");
    expect(detail).not.toContain(`scripts/retired-${paths.length - 1}.mjs`);
    expect(detail).toContain("3 more");
  });
});
