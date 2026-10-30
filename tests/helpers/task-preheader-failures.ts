/** Controlled failures for the existing fixed owner, preserving production assertions. */
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { preheaderGithub } from "./task-preheader-github.js";
import { intakeOwnerCommand } from "./task-intake-owner.js";
export const WRONG_NATIVE = "wrong-native";
const MISMATCH = "identity-mismatch";
const rules = {
  "read-failure": {
    category: "capability-unreachable",
    env: { FIXTURE_READ_FAILURE: "1" },
  },
  missing: {
    category: "credential-missing",
    env: { FIXTURE_RECORD_MISSING: "1" },
  },
  "provider-unreachable": {
    category: "provider-unreachable",
    env: { FIXTURE_SOURCE_FAILURE: "1" },
  },
  "tool-missing": { category: "tool-missing" },
  "wrong-actor": { category: MISMATCH, env: { FIXTURE_ACTOR_INVALID: "1" } },
  "wrong-repo": { category: MISMATCH, env: { FIXTURE_GH_WRONG: "1" } },
  [WRONG_NATIVE]: {
    category: MISMATCH,
    env: { FIXTURE_ACTOR_INVALID: "1", FIXTURE_NATIVE_AVAILABLE: "1" },
  },
  grant: { category: "config-invalid" },
  "provider-grant": { category: "credential-missing" },
  "bad-ref": { blocked: true },
  "shell-suffix": { blocked: true },
  "arbitrary-operation": { blocked: true },
};
export const preheaderFailures = Object.keys(rules);
/** Apply only explicit synthetic failure data before the actual wrapper call.
 * @param f - Owned isolated fixture.
 * @param mode - Fixed failure name.
 * @returns Command, isolated environment and expected category.
 */
export function preheaderFailure(
  f: ReturnType<typeof preheaderGithub>,
  mode: string
) {
  const selected = (
    rules as Record<
      string,
      { category?: string; env?: Record<string, string>; blocked?: boolean }
    >
  )[mode]!;
  const command = intakeOwnerCommand(f, "issue");
  const variants: Record<string, string> = {
    "bad-ref": command.replace("fixture/project#1", "other/project#1"),
    "shell-suffix": `${command}; touch source.ts`,
    "arbitrary-operation": command.replace("--read issue", "--read claim"),
  };
  if (mode === "tool-missing") rmSync(path.join(f.env.PATH, "bws"));
  if (mode === "grant" || mode === "provider-grant") {
    const p = path.join(f.root, ".lisa.config.json"),
      cfg = JSON.parse(readFileSync(p, "utf8"));
    const setting =
      mode === "grant"
        ? { require: [] }
        : { narrow: { projectIds: ["other"] } };
    writeFileSync(
      p,
      JSON.stringify({ ...cfg, secrets: { ...cfg.secrets, ...setting } })
    );
  }
  return {
    command: variants[mode] ?? command,
    env: { ...f.env, ...selected.env },
    category: selected.category,
    blocked: selected.blocked === true,
  };
}
