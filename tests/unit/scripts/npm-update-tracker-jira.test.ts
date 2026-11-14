/**
 * AC3 and AC4 of CodySwannGT/lisa#4859 against a mocked Jira REST v3
 * endpoint: allocation creates exactly one ticket in the configured project,
 * moves it to the configured ready status, and a re-run creates none. The
 * managed text survives the ADF round trip byte for byte, and the signed
 * artifacts carry the PROJ-<N> reference.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { allocateLeaf } from "../../../all/copy-overwrite/scripts/lib/npm-update-allocate.mjs";
import { prepareAuthorization } from "../../../all/copy-overwrite/scripts/lib/npm-update-authorization.mjs";
import { createTracker } from "../../../all/copy-overwrite/scripts/lib/npm-update-tracker.mjs";
import {
  adfCodeBlock,
  adfText,
} from "../../../all/copy-overwrite/scripts/lib/npm-update-tracker-wire.mjs";
import { checkpointComments } from "../../../all/copy-overwrite/scripts/lib/npm-update-checkpoint.mjs";
import { CLAIM } from "../../../all/copy-overwrite/scripts/lib/npm-update-contract.mjs";
import { withPrivateRoot } from "../../../all/copy-overwrite/scripts/lib/npm-update-process.mjs";
import { sha256 } from "../../../all/copy-overwrite/scripts/lib/github-attestation-verifier.mjs";
import { fakeJira } from "../../support/npm-update-jira-fake.js";
import {
  JIRA_CONFIG,
  JIRA_MAINTAINER,
  REGISTRY_METADATA,
  codeHost,
  committedHost,
  automation,
} from "../../support/npm-update-tracker-host.js";

const CONFIG = { ...JIRA_CONFIG, automationProvenance: await automation() };
const CREDENTIALS = {
  JIRA_API_TOKEN: "jira-token-fixture",
  JIRA_LOGIN: "bot@example.test",
};

/** A Jira-tracked allocation run over a committed host and the mocked project. */
async function jiraRun(root: string, env: NodeJS.ProcessEnv) {
  const host = await committedHost(root, env, JIRA_MAINTAINER);
  const jira = fakeJira({ assignable: [JIRA_MAINTAINER] });
  const api = {
    ...codeHost(host.parent),
    tracker: createTracker(CONFIG, CREDENTIALS, jira.transport)!,
  };
  const allocate = () =>
    allocateLeaf({
      api,
      proposal: host.proposal,
      policy: host.policy,
      config: CONFIG,
      cwd: host.cwd,
    });
  return { ...host, jira, api, allocate };
}

describe("Jira allocation", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json(REGISTRY_METADATA)
    );
    vi.stubEnv("GITHUB_RUN_ID", "700");
    vi.stubEnv("GITHUB_RUN_ATTEMPT", "1");
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("creates exactly one ticket in the configured project in the ready status and none on re-run", async () => {
    await withPrivateRoot(async (root, env) => {
      const run = await jiraRun(root, env);
      const first = await run.allocate();
      expect(run.jira.creates()).toBe(1);
      const create = run.jira.log.find(
        entry => entry.operation === "POST /rest/api/3/issue"
      )!;
      expect(create.body).toMatchObject({
        fields: {
          project: { key: "PROJ" },
          issuetype: { name: "Task" },
          priority: { name: "Medium" },
          assignee: { accountId: JIRA_MAINTAINER },
          labels: [`lisa-npm-${run.proposal.selectionKey}`],
        },
      });
      const transitions = run.jira.log
        .filter(
          entry =>
            entry.operation === "POST /rest/api/3/issue/PROJ-1/transitions"
        )
        .map(entry => entry.body);
      // Backlog → Ready (build-ready filing), then Ready → In Progress (claim).
      expect(transitions).toEqual([
        { transition: { id: "12" } },
        { transition: { id: "13" } },
      ]);
      expect(first.workItem).toBe("PROJ-1");
      const ticket = run.jira.issues[0]!;
      expect(adfText(ticket.fields.description)).toBe(first.draft.body);
      expect(ticket.fields.status.name).toBe("In Progress");
      expect(
        ticket.comments.filter(comment => adfText(comment.body) === CLAIM)
      ).toHaveLength(1);

      const second = await run.allocate();
      expect(run.jira.creates()).toBe(1);
      expect(second.workItem).toBe("PROJ-1");
      expect(second.claimCommentId).toBe(first.claimCommentId);
      expect(ticket.comments).toHaveLength(2);
    });
  });

  it("signs the PROJ-<N> reference into the descriptor and the trailer", async () => {
    await withPrivateRoot(async (root, env) => {
      const run = await jiraRun(root, env);
      const allocation = await run.allocate();
      const output = join(root, "allocate");
      mkdirSync(output, { mode: 0o700 });
      await prepareAuthorization({
        api: run.api,
        cwd: run.cwd,
        output,
        proposal: run.proposal,
        allocation,
        policy: run.policy,
        config: CONFIG,
      });
      const descriptor = JSON.parse(
        readFileSync(join(output, "descriptor.json"), "utf8")
      );
      const preview = JSON.parse(
        readFileSync(join(output, "preview.json"), "utf8")
      );
      expect(descriptor.workItem).toBe("PROJ-1");
      expect(descriptor.queue).toBe("acme/widgets");
      expect(preview.message).toContain("\nWork-Item: PROJ-1\n");
      expect(preview.message.match(/^Work-Item: .*$/gm)).toEqual([
        "Work-Item: PROJ-1",
      ]);
    });
  });

  it("proves the claim against the ticket, the API account and the claim bytes", async () => {
    await withPrivateRoot(async (root, env) => {
      const run = await jiraRun(root, env);
      const allocation = await run.allocate();
      const descriptor = {
        workItem: "PROJ-1",
        claimCommentId: allocation.claimCommentId,
        claimSha256: allocation.claimSha256,
      };
      await expect(run.api.tracker.proveClaim(descriptor)).resolves.toEqual({
        created_at: expect.any(String),
      });
      await expect(
        run.api.tracker.proveClaim({ ...descriptor, claimSha256: sha256("x") })
      ).rejects.toThrow(/claim/);
    });
  });
});

describe("Jira ADF managed-text codec", () => {
  it("round-trips the claim, a checkpoint chunk and text with markup byte for byte", () => {
    const chunks = checkpointComments(
      { version: 1, proposal: {}, allocation: {}, preview: null, bundle: "" },
      "a".repeat(64)
    );
    for (const text of [
      CLAIM,
      ...chunks,
      "## Heading\n\n<!-- [lisa-npm-proposal] key -->\n```gherkin\nScenario: x\n```\n",
      "",
    ])
      expect(adfText(adfCodeBlock(text))).toBe(text);
  });

  it("reads a human paragraph comment as plain text that can never equal a managed body", () => {
    const human = {
      type: "doc",
      version: 1,
      content: [
        { type: "paragraph", content: [{ type: "text", text: "hold this" }] },
        { type: "paragraph", content: [{ type: "text", text: "please" }] },
      ],
    };
    expect(adfText(human)).toBe("hold this\nplease");
  });

  it("refuses managed text over the Jira field limit before any request", async () => {
    const jira = fakeJira();
    const tracker = createTracker(CONFIG, CREDENTIALS, jira.transport)!;
    await expect(tracker.comment(1, "x".repeat(32_768))).rejects.toThrow(
      /limit/
    );
    expect(jira.log).toEqual([]);
  });
});
