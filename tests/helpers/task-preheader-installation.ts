/** Installation credentials establish repository scope without inventing a user. */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect } from "vitest";
import { preheaderGithub, preheaderJournal } from "./task-preheader-github.js";
import { githubRequirement } from "./task-github-fixture.js";
import { intakeOwnerCommand } from "./task-intake-owner.js";
import { nativeBash } from "./task-native-bash.js";
import { nativeWrite } from "./task-native-context.js";
import { driveTask } from "./task-readiness-continuation.js";
import { readConfig } from "../../plugins/src/base/skills/lisa-secrets-access/scripts/surfaces.mjs";
import { requirementsContext } from "../../plugins/src/base/skills/lisa-secrets-access/scripts/task-requirements.mjs";
const CONTEXT = ".lisa/work-item-context.md";
/** Owned strict fixture, including its private synthetic source value. */
type Fixture = ReturnType<typeof preheaderGithub>;
/** Read real fixed operations before any header.
 * @param f - Isolated fixture with installation authentication.
 * @param source - Selected route.
 * @returns Validated raw reads and safe source journal.
 */
function installationReads(f: Fixture, source: string) {
  const reads = ["issue", "comments"].map(operation => {
    const r = nativeBash(f, intakeOwnerCommand(f, operation));
    return {
      operation,
      guard: r.guard.status,
      exit: r.tool?.status,
      stdout: String(r.tool?.stdout),
      stderr: String(r.tool?.stderr),
    };
  });
  const journal = preheaderJournal(f);
  console.info(
    "QUALIFICATION_OBSERVATION",
    JSON.stringify({
      case: `installation-${source}`,
      reads,
      source_journal: journal,
      context_present: existsSync(path.join(f.root, CONTEXT)),
    })
  );
  expect(reads.map(r => r.exit)).toEqual([0, 0]);
  expect(reads.map(r => r.guard)).toEqual([0, 0]);
  expect(JSON.parse(reads[0]!.stdout).number).toBe(1);
  expect(JSON.parse(reads[1]!.stdout)).toHaveLength(2);
  expect(existsSync(path.join(f.root, CONTEXT))).toBe(false);
  expect(journal.filter(row => row.tool === "bws")).toHaveLength(
    source === "native" ? 0 : 2
  );
  return { reads, journal };
}
/** Prepare metadata only after verified raw reads.
 * @param f - Isolated fixture.
 * @param body - Complete selected read data.
 * @returns Fixture after validated owner preparation.
 */
function prepareInstallation(f: Fixture, body: string) {
  const cfg = readConfig(f.root, {
    LISA_SECRETS_SURFACE: f.env.LISA_SECRETS_SURFACE,
  });
  const content = requirementsContext(
    cfg,
    "fixture/project#1",
    "github",
    [githubRequirement],
    body
  );
  const prepared = nativeWrite(f, content);
  expect(prepared.guard.status).toBe(2);
  expect(prepared.rawWrites).toBe(0);
  return f;
}
/** Observe the same existing shared proof through the actual guarded CLI.
 * @param f - Isolated fixture after truthful preparation.
 * @returns Established repository proof with actor explicitly unobserved.
 */
function installationProof(f: Fixture) {
  const proof = nativeBash(
    f,
    `node ${f.plugin}/skills/lisa-secrets-access/scripts/preflight-secrets.mjs --task --ref fixture/project#1`
  );
  const capability = JSON.parse(String(proof.tool?.stdout)).capabilities[0];
  expect(proof.tool?.status).toBe(0);
  expect(capability.established).toBe(true);
  expect(capability.repository_observed).toBe(true);
  expect(capability.authenticated_actor_observed).toBe(false);
  expect(capability).not.toHaveProperty("authenticated_actor_id");
  return capability;
}
/** Drive fixed reads, independent proof and a real continuation.
 * @param f - Owned strict provider/API fixture.
 * @param source - Native or configured-provider installation route.
 */
export function qualifyInstallation(f: Fixture, source: string) {
  const installed = {
    ...f,
    env: {
      ...f.env,
      FIXTURE_INSTALLATION_TOKEN: "1",
      ...(source === "native" ? { FIXTURE_NATIVE_AVAILABLE: "1" } : {}),
    },
  };
  const observed = installationReads(installed, source);
  const capability = installationProof(
    prepareInstallation(installed, JSON.stringify(observed.reads))
  );
  const continuation = driveTask(f.root, f.plugin, installed.env);
  const sinks = JSON.stringify({
    ...observed,
    capability,
    context: readFileSync(path.join(f.root, CONTEXT), "utf8"),
    stdout: continuation.stdout,
    stderr: continuation.stderr,
  });
  expect(continuation.counters).toEqual({
    claim: 1,
    branch: 1,
    code: 1,
    external: 1,
  });
  expect(sinks).not.toContain(f.secret);
  console.info(
    "QUALIFICATION_OBSERVATION",
    JSON.stringify({
      case: `installation-${source}-proof`,
      capability,
      effects: continuation.counters,
    })
  );
}
