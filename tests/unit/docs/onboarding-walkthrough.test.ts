/**
 * The onboarding walkthrough has to describe the commands that exist.
 *
 * Documentation is where this area has repeatedly gone wrong: a copy of a shell
 * one-liner pinned a release behind, a `cd` was documented to work around a bug
 * rather than the bug being fixed, and an emit template went years without
 * mentioning the three exports a repo-less session cannot run without.
 *
 * So these assert the walkthrough against the surfaces registry and the command
 * table, rather than against a copy of what someone meant to write: every
 * surface the code can configure must be named. The surrounding prose is
 * guidance and is reviewed, not pinned (#4867).
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
});
