/** Add real proof preconditions to older positive lifecycle controls. */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { type Fixture } from "./work-item-cli.js";
import {
  proofFixture,
  attachRecord,
  setApi,
} from "./work-item-proof-fixture.js";

/**
 * No test-only authorization hook: use actual source, assets and canonical CLI.
 * @param fixture - Owned disposable repository and controlled provider.
 * @param ref - Canonical native work-item reference.
 * @param before - Native state before any terminal write.
 * @param after - Optional independent post-write observation.
 * @param primary - Primary production pull-request identifier.
 * @returns Write-driven fixture with actual proof preconditions.
 */
export function acceptedCompatibility(
  fixture: Fixture,
  ref: string,
  before: string,
  after?: string,
  primary = 7
) {
  const proof = proofFixture(ref, fixture);
  const repository = ref.split("#")[0]!;
  const file = proof.env.FAKE_GH_STATE_FILE!;
  const state = JSON.parse(readFileSync(file, "utf8"));
  const initial = JSON.parse(before);
  Object.assign(state, {
    labels: initial.labels,
    state: initial.state,
    stateReason: initial.stateReason,
    assignees: initial.assignees ?? state.assignees,
  });
  if (primary !== 7) {
    proof.record.source.pull_request = primary;
    state.comments[0].body = `[lisa-pr-link] https://github.com/${repository}/pull/${primary}`;
    setApi(proof, ["api", `repos/${repository}/pulls/${primary}`], {
      json: {
        number: primary,
        merged: true,
        state: "closed",
        merged_at: new Date().toISOString(),
        html_url: `https://github.com/${repository}/pull/${primary}`,
        body: `Work-Item: ${ref}`,
        merge_commit_sha: proof.merge,
        head: { sha: proof.prHead },
        base: { ref: proof.record.branch },
      },
    });
  }
  writeFileSync(file, JSON.stringify(state));
  attachRecord(proof);
  if (after) {
    proof.env.FAKE_GH_WRITE_READBACK_FILE = path.join(
      proof.root,
      "post-write-observation.json"
    );
    writeFileSync(proof.env.FAKE_GH_WRITE_READBACK_FILE, after);
  }
  return proof;
}
