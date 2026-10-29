/** The same real CLI and proof assets with a write-driven Linear adapter. */
import { chmodSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  proofFixture,
  setApi,
  putAsset,
  digest,
} from "./work-item-proof-fixture.js";
import { createFixture, githubConfig } from "./work-item-cli.js";

export const LINEAR_REF = "LIN-42";
export const LINEAR_PR = "https://github.com/acme/code/pull/7";
/**
 * Build the explicit native issue snapshot independently of provider setup.
 * @param ref - Exact fixture identity or captured description.
 * @param body - Exact fixture identity or captured description.
 * @returns Initial native-shaped issue snapshot.
 */
function nativeLinearIssue(ref: string, body: string) {
  const started = { id: "started", name: "In Progress", type: "started" };
  const done = { id: "done", name: "Done", type: "completed" };
  return {
    id: "linear-42",
    identifier: ref,
    description: body,
    team: { key: "LIN", states: { nodes: [started, done] } },
    state: started,
    labels: { nodes: [] },
    children: { nodes: [] },
    assignee: { id: "owner", name: "Fixture Owner" },
    attachments: { nodes: [{ url: LINEAR_PR }] },
    comments: {
      nodes: [
        {
          id: "link",
          body: `[lisa-pr-link] ${LINEAR_PR}`,
          user: { id: "linear-publisher" },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    },
  };
}

/**
 * Create native GraphQL fields including full comment pagination and mutations.
 * @param ref - Canonical native work-item reference.
 * @param overrides - Project configuration overrides for this fixture.
 * @returns Owned Linear/provider fixture with coherent proof input.
 */
export function linearProofFixture(ref = LINEAR_REF, overrides: object = {}) {
  const fixture = proofFixture(
    ref,
    createFixture({ ...githubConfig("full", "code"), ...overrides })
  );
  const configFile = path.join(fixture.root, ".lisa.config.json");
  const config = JSON.parse(readFileSync(configFile, "utf8"));
  const executable = path.join(fixture.root, "fake-bin/curl");
  const recordDigest = digest(["linear", "acme/LIN", ref].join("\0"));
  const issue = nativeLinearIssue(ref, fixture.body);
  Object.assign(config, {
    tracker: "linear",
    linear: { ...config.linear, workspace: "acme", teamKey: "LIN" },
  });
  writeFileSync(configFile, JSON.stringify(config));
  fixture.env.LINEAR_API_KEY = "synthetic-fixture-token";
  fixture.env.FAKE_LINEAR_STATE_FILE = path.join(
    fixture.root,
    "linear-state.json"
  );
  fixture.env.FAKE_LINEAR_LOG = path.join(fixture.root, "linear-calls.jsonl");
  writeFileSync(fixture.env.FAKE_LINEAR_STATE_FILE, JSON.stringify(issue));
  writeFileSync(fixture.env.FAKE_LINEAR_LOG, "");
  copyFileSync(
    path.join(process.cwd(), "tests/support/work-item-stateful-linear.mjs"),
    executable
  );
  chmodSync(executable, 0o755);
  setApi(
    fixture,
    [
      "pr",
      "view",
      LINEAR_PR,
      "--json",
      "number,state,mergedAt,url,baseRefName",
    ],
    {
      json: {
        url: LINEAR_PR,
        number: 7,
        state: "MERGED",
        mergedAt: new Date().toISOString(),
        baseRefName: fixture.record.branch,
      },
    }
  );
  Object.assign(fixture.record, {
    record_id: `completion-${recordDigest}`,
    subject: {
      provider: "linear",
      ref,
      native_id: issue.id,
      scope: "acme/LIN",
    },
  });
  Object.assign(fixture.record.producer, {
    tracker_actor_id: "linear-publisher",
  });
  return fixture;
}

/**
 * Own assets and native actor attribution remain separately verifiable.
 * @param fixture - Owned disposable repository and controlled provider.
 * @param revision - Monotonic immutable proof revision.
 * @returns Native immutable asset pointer.
 */
export function attachLinearRecord(
  fixture: ReturnType<typeof linearProofFixture>,
  revision = 1
) {
  const pointer = putAsset(fixture, revision + 10, fixture.record);
  const file = fixture.env.FAKE_LINEAR_STATE_FILE!;
  const issue = JSON.parse(readFileSync(file, "utf8"));
  issue.comments.nodes.push({
    id: `proof-${revision}`,
    body: `[lisa-completion-authorization]\n${JSON.stringify({
      schema_version: 1,
      repository: "acme/code",
      record_id: fixture.record.record_id,
      revision,
      asset_id: pointer.asset_id,
      sha256: pointer.sha256,
    })}`,
    user: { id: fixture.record.producer.tracker_actor_id },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  writeFileSync(file, JSON.stringify(issue));
  return pointer;
}

/**
 * Upgrade an older native lookup control without a read-count success promise.
 * @param config - Existing project configuration under test.
 * @param lookup - Native initial Linear lookup payload.
 * @returns Write-driven fixture retaining the original control's state.
 */
export function linearCompatibility(config: object, lookup: string) {
  const fixture = linearProofFixture("LIN-12", config);
  const issue = JSON.parse(lookup).data.issue;
  const file = fixture.env.FAKE_LINEAR_STATE_FILE!;
  const state = JSON.parse(readFileSync(file, "utf8"));
  Object.assign(state, {
    team: issue.team,
    state: issue.state,
    attachments: issue.attachments ?? state.attachments,
  });
  writeFileSync(file, JSON.stringify(state));
  attachLinearRecord(fixture);
  return fixture;
}
