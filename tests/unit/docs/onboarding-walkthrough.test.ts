/**
 * The onboarding walkthrough has to describe the commands that exist.
 *
 * Documentation is where this area has repeatedly gone wrong: a copy of a shell
 * one-liner pinned a release behind, a `cd` was documented to work around a bug
 * rather than the bug being fixed, and an emit template went years without
 * mentioning the three exports a repo-less session cannot run without.
 *
 * So these assert the walkthrough against the surfaces registry and the command
 * table, rather than against a copy of what someone meant to write.
 * @module tests/unit/docs/onboarding-walkthrough
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { TARGETS } from "../../../plugins/src/base/skills/lisa-setup-remote-env/scripts/environment.mjs";
import { SURFACES } from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/surfaces.mjs";

const README = readFileSync("README.md", "utf8");
const SKILL = readFileSync(
  "plugins/src/base/skills/lisa-setup-remote-env/SKILL.md",
  "utf8"
);

describe("the README walkthrough", () => {
  it("names every surface `environment` can configure", () => {
    // Derived from the command's own table, so a surface added without a line
    // in the walkthrough fails here rather than going undocumented.
    for (const surface of Object.keys(TARGETS)) {
      expect(README).toContain(`environment ${surface}`);
    }
  });

  it("says the machine commands need no checkout", () => {
    // The property that makes the ordering work at all, and the one every
    // earlier version of this documentation got wrong.
    expect(README).toMatch(/neither needs a checkout|needs no checkout/i);
  });

  it("requires --tenant where the command requires it", () => {
    expect(README).toMatch(/environment local --tenant=/);
  });

  it("tells operators to give each place its own token", () => {
    // A shared token makes any compromise a multi-place outage and every audit
    // entry anonymous.
    expect(README).toMatch(/own access token/i);
  });

  it("keeps the layers in order: machine, then repo", () => {
    expect(README.indexOf("### 2. The machine")).toBeLessThan(
      README.indexOf("### 3. Each repository")
    );
  });
});

describe("the skill's surface table", () => {
  it("lists every surface that materializes", () => {
    // A surface that writes credentials and is not described is one nobody
    // knows to configure.
    for (const [name, capability] of Object.entries(SURFACES)) {
      if (!capability.materialized) continue;
      expect(SKILL).toContain(name);
    }
  });

  it("explains why --tenant is mandatory rather than only stating it", () => {
    expect(SKILL).toMatch(/another tenant's sessions read/);
  });

  it("records that the old spelling still works", () => {
    expect(SKILL).toContain("remote-env --emit=");
  });
});
