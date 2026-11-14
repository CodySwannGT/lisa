/**
 * Evidence driver for CodySwannGT/lisa#4859 (run with `bun`, see run.sh).
 *
 * `linear` / `jira`: run the real allocateLeaf twice against the in-memory
 * tracker fake and print every tracker request, so the log shows exactly one
 * create across both runs. `prepare-missing <dir>`: commit a Linear-tracked
 * host with a valid proposal under <dir> so run.sh can call the real CLI with
 * LINEAR_API_KEY unset. No live tracker, credential or network is used; the
 * npm registry read is answered locally with metadata matching the lock.
 * @module evidence/4859/allocate-evidence
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { allocateLeaf } from "../../all/copy-overwrite/scripts/lib/npm-update-allocate.mjs";
import { createTracker } from "../../all/copy-overwrite/scripts/lib/npm-update-tracker.mjs";
import { withPrivateRoot } from "../../all/copy-overwrite/scripts/lib/npm-update-process.mjs";
import { canonicalJson } from "../../all/copy-overwrite/scripts/lisa-automation-provenance.mjs";
import { fakeJira } from "../../tests/support/npm-update-jira-fake.ts";
import { fakeLinear } from "../../tests/support/npm-update-linear-fake.ts";
import {
  JIRA_CONFIG,
  JIRA_MAINTAINER,
  LINEAR_CONFIG,
  LINEAR_MAINTAINER,
  REGISTRY_METADATA,
  automation,
  codeHost,
  committedHost,
  policyFor,
} from "../../tests/support/npm-update-tracker-host.ts";

globalThis.fetch = (async () =>
  Response.json(REGISTRY_METADATA)) as unknown as typeof fetch;

/**
 * Allocate twice against one tracker fake and print the request log.
 * @param name - "linear" or "jira".
 */
async function twice(name: "linear" | "jira") {
  const linear = name === "linear";
  const maintainer = linear ? LINEAR_MAINTAINER : JIRA_MAINTAINER;
  const config = {
    ...(linear ? LINEAR_CONFIG : JIRA_CONFIG),
    automationProvenance: await automation(),
  };
  const fake = linear
    ? fakeLinear({ members: [maintainer] })
    : fakeJira({ assignable: [maintainer] });
  const env = linear
    ? { LINEAR_API_KEY: "fixture-key" }
    : { JIRA_API_TOKEN: "fixture-token", JIRA_LOGIN: "bot@example.test" };
  await withPrivateRoot(async (root, privateEnv) => {
    const host = await committedHost(root, privateEnv, maintainer);
    const api = {
      ...codeHost(host.parent),
      tracker: createTracker(config, env, fake.transport),
    };
    for (const run of [1, 2]) {
      const before = fake.log.length;
      const result = await allocateLeaf({ api, config, cwd: host.cwd, ...host });
      console.log(`--- allocation run ${run}: workItem=${result.workItem} claimCommentId=${result.claimCommentId}`);
      for (const entry of fake.log.slice(before)) console.log(`  ${entry.operation}`);
      console.log(`  creates so far: ${fake.creates()}`);
    }
  });
  console.log(`TOTAL work items created across both runs: ${fake.creates()}`);
}

/**
 * Commit a Linear-tracked host and its private phase directory for the CLI run.
 * @param dir - Empty directory to create the host and phase directory in.
 */
async function prepareMissing(dir: string) {
  const policy = policyFor(LINEAR_MAINTAINER);
  const config = {
    ...LINEAR_CONFIG,
    automationProvenance: await automation(),
    npmUpdater: policy,
  };
  // The private environment only runs git; the host itself lives under <dir>.
  const host = await withPrivateRoot((_root, env) =>
    committedHost(dir, env, LINEAR_MAINTAINER, {
      ".lisa.config.json": `${JSON.stringify(config)}\n`,
    })
  );
  const phase = join(dir, "phase");
  mkdirSync(phase, { mode: 0o700 });
  writeFileSync(join(phase, "proposal.json"), `${canonicalJson(host.proposal)}\n`, {
    mode: 0o600,
  });
  console.log(`${host.cwd} ${phase}`);
}

const [mode, dir] = process.argv.slice(2);
if (mode === "prepare-missing") await prepareMissing(String(dir));
else await twice(mode === "jira" ? "jira" : "linear");
