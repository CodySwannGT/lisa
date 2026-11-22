/** Same-byte old/candidate comparison; never edits the archived production source. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect } from "vitest";
import type { taskFixture } from "./task-readiness-fixture.js";
import type { TaskOperation } from "./task-readiness-tools.js";
/**
 *
 */
type Fixture = ReturnType<typeof taskFixture>;
/**
 *
 */
type Observation = ReturnType<Fixture["run"]>;
const CONTEXT = ".lisa/work-item-context.md";
const OWNER = "skills/lisa-secrets-access/scripts/preflight-secrets.mjs";
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/** Require the real canonical secret-list argv rather than a version executable.
 * @param journal - Actual accepted hook operations.
 */
export function expectHookList(journal: TaskOperation[]): void {
  expect(journal).toContainEqual({
    tool: "bws",
    operation: "secret-list",
    label: "bws:secret:list",
    argv: ["--color", "no", "secret", "list", "--output", "json"],
    accepted: true,
  });
}

/** Exercise both implementations against identical valid metadata/config bytes.
 * @param f - Same owned fixture for both calls.
 * @param legacy - Actual old-hook observation, before recorder reset.
 * @param input - Archived source and exact input identity.
 * @param input.context - Complete context bytes shared by both calls.
 * @param input.routing - Whether the independent GitHub routing floor is declared.
 * @param input.source - Unmodified archived baseline plugin root.
 */
export function pairedReadback(
  f: Fixture,
  legacy: Observation,
  input: { context: Buffer; routing: boolean; source: string }
): void {
  const candidate = f.run();
  const currentContext = readFileSync(path.join(f.root, CONTEXT));
  const config = readFileSync(path.join(f.root, ".lisa.config.json"));
  expect(currentContext).toEqual(input.context);
  expect(JSON.parse(config.toString()).secrets.require).toBeUndefined();
  expect(candidate.status).toBe(2);
  expect(candidate.stderr).toContain("provider-unreachable");
  expect(candidate.counters).toEqual({
    claim: 0,
    branch: 0,
    code: 0,
    external: 0,
  });
  expectHookList(candidate.journal);
  console.info(
    "QUALIFICATION_OBSERVATION",
    JSON.stringify({
      case: "identical-input-old-current-pair",
      routing: input.routing,
      input_sha256: sha(input.context),
      input_unchanged: true,
      config_file_sha256: sha(config),
      config_digest: f.manifest.effective_config_sha256,
      requirements_digest: f.manifest.requirements_sha256,
      independently_mandatory_secret_require: false,
      old: {
        source_sha256: sha(readFileSync(path.join(input.source, OWNER))),
        status: legacy.status,
        operations: legacy.journal,
        effects: legacy.counters,
        reason: "advisory-transport-success",
      },
      candidate: {
        source_sha256: sha(readFileSync(path.join(f.plugin, OWNER))),
        status: candidate.status,
        operations: candidate.journal,
        effects: candidate.counters,
        reason: "provider-unreachable",
      },
    })
  );
}
