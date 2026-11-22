/**
 * Contract tests for issue #1783's session-side tracked-work invariant.
 *
 * The skill and rule guidance prose is reviewed, not pinned. What stays pinned
 * is machine-read or code: each vendor claim skill carries the
 * `[lisa-tracker-claim]` marker that `lisa-work-item.mjs` parses, and the
 * shipped work-item guard reads no OS keychain.
 * @module tests/unit/strategies/tracked-work-contract
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const BASE_SKILLS = "plugins/src/base/skills";
const PROVIDERS = ["github", "jira", "linear"] as const;

const read = (file: string): string => readFileSync(path.resolve(file), "utf8");

describe("vendor-neutral tracker claim", () => {
  it.each(PROVIDERS)(
    "%s claim carries the machine-read claim marker",
    provider => {
      const skill = read(`${BASE_SKILLS}/lisa-${provider}-claim/SKILL.md`);

      expect(skill).toContain("[lisa-tracker-claim]");
    }
  );
});

describe("the work-item guard reads no OS keychain", () => {
  // The rung this pins removed read as a fallback and was, on the machines that
  // ran it, the SOLE Linear token source — the two environment variables above
  // it were unset. It also regenerated itself: an agent blocked by the hook
  // opened the guard, found the keychain call, and adopted the deprecated path.
  // Three did so in one day, which is why the assertion is on the shipped bytes
  // and not only on behaviour. The service name is deliberately reconstructed
  // rather than written as a literal, so this file does not reintroduce the
  // string it exists to keep out.
  const DEPRECATED_ENTRY = ["lisa", "linear"].join("-");

  it.each([
    "all/copy-overwrite/scripts/lisa-work-item.mjs",
    "scripts/lisa-work-item.mjs",
  ])("%s consults no keychain", file => {
    const source = read(file);

    expect(source).not.toContain("find-generic-password");
    expect(source).not.toContain(DEPRECATED_ENTRY);
  });
});
