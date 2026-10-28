/** Explicit native revision/publisher fixtures, with immutable asset bytes. */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  proofFixture,
  putAsset,
  PUBLISHER,
  setApi,
  digest,
} from "./work-item-proof-fixture.js";

/**
 *
 */
export type ProofFixture = ReturnType<typeof proofFixture>;
/**
 *
 */
interface NativeProofState {
  body: string;
  comments: Array<{
    id: number;
    body: string;
    user: typeof PUBLISHER;
    created_at: string;
    updated_at: string;
  }>;
}

/**
 * Change only the selected owned fixture's native snapshot.
 * @param fixture - Owned disposable repository and controlled provider.
 * @param edit - Controlled native-state change.
 */
export function editProofState(
  fixture: ProofFixture,
  edit: (state: NativeProofState) => void
): void {
  const file = fixture.env.FAKE_GH_STATE_FILE!;
  const state = JSON.parse(readFileSync(file, "utf8"));
  edit(state);
  writeFileSync(file, JSON.stringify(state));
}

/**
 * Each revision owns a distinct native asset rather than overwriting a capture.
 * @param fixture - Owned disposable repository and controlled provider.
 * @param revision - Monotonic immutable proof revision.
 * @param state - Declared proof revision state.
 * @param actor - Native fixture publisher identity.
 * @returns Native immutable asset pointer for this revision.
 */
export function addRevision(
  fixture: ProofFixture,
  revision: number,
  state: string,
  actor = PUBLISHER
) {
  const predecessor =
    revision > 1
      ? readFileSync(
          path.join(fixture.env.FAKE_GH_ASSET_DIRECTORY!, `${revision + 9}.bin`)
        )
      : null;
  const record = {
    ...fixture.record,
    revision,
    state,
    supersedes: predecessor ? digest(predecessor) : null,
    producer: {
      ...fixture.record.producer,
      github_actor_id: actor.id,
      tracker_actor_id: String(actor.id),
    },
  };
  const pointer = putAsset(fixture, revision + 10, record);
  const indexFile = fixture.env.FAKE_GH_ASSET_INDEX!;
  const index = JSON.parse(readFileSync(indexFile, "utf8"));
  index.find((row: { id: number }) => row.id === revision + 10).uploader =
    actor;
  writeFileSync(indexFile, JSON.stringify(index));
  editProofState(fixture, native =>
    native.comments.push({
      id: revision + 10,
      body: `[lisa-completion-authorization]\n${JSON.stringify({
        schema_version: 1,
        repository: "acme/code",
        record_id: record.record_id,
        revision,
        asset_id: pointer.asset_id,
        sha256: pointer.sha256,
      })}`,
      user: actor,
      created_at: `2026-10-27T12:00:${String(revision).padStart(2, "0")}Z`,
      updated_at: `2026-10-27T12:00:${String(revision).padStart(2, "0")}Z`,
    })
  );
  return pointer;
}

/**
 * Explicit configured bot provenance, never an author-association shortcut.
 * @param fixture - Owned disposable repository and controlled provider.
 * @returns Configured stable native automation publisher identity.
 */
export function configureBot(fixture: ProofFixture) {
  const actor = { id: 994, login: "fixture-repository-app[bot]", type: "Bot" };
  const configFile = path.join(fixture.root, ".lisa.config.json");
  const config = JSON.parse(readFileSync(configFile, "utf8"));
  config.verification.completion.automationPublishers = [
    {
      user_id: actor.id,
      type: "Bot",
      repository_id: 881,
      workflow_id: 23,
      workflow_path: ".github/workflows/verify.yml",
      events: ["workflow_dispatch"],
      ref: "main",
    },
  ];
  writeFileSync(configFile, JSON.stringify(config));
  Object.assign(fixture.record.producer, {
    github_actor_id: actor.id,
    tracker_actor_id: String(actor.id),
    workflow_run_id: 32,
    workflow_attempt: 1,
    workflow_head: fixture.merge,
  });
  fixture.env.FAKE_GH_PUBLISHER = JSON.stringify(actor);
  setApi(fixture, ["api", "user"], {
    failure: "Resource not accessible by integration (HTTP 403)",
  });
  return actor;
}

/**
 * Pin native run attempt, including failures that a later rerun cannot upgrade.
 * @param fixture - Owned disposable repository and controlled provider.
 * @param status - Native pinned workflow-attempt status.
 * @param conclusion - Native pinned attempt result, or null while pending.
 */
export function producerAttempt(
  fixture: ProofFixture,
  status: string,
  conclusion: string | null
) {
  setApi(fixture, ["api", "repos/acme/code/actions/runs/32/attempts/1"], {
    json: {
      id: 32,
      repository: { id: 881 },
      workflow_id: 23,
      path: ".github/workflows/verify.yml",
      event: "workflow_dispatch",
      head_branch: "main",
      head_sha: fixture.merge,
      run_attempt: 1,
      status,
      conclusion,
      run_started_at: "2020-01-01T00:00:00Z",
      updated_at: "2099-01-01T00:00:00Z",
    },
  });
}
