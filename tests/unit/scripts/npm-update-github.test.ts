/** Fixed writer and provider controls are transport fixtures, never attestation proof. */
import { describe, expect, it, vi } from "vitest";
import { registryVersion } from "../../../all/copy-overwrite/scripts/lib/npm-update-npm.mjs";
import {
  buildDraft,
  inspectLeaf,
  qualityGates,
  claimLeaf,
  leafRoles,
} from "../../../all/copy-overwrite/scripts/lib/npm-update-leaf.mjs";
import {
  assertPublicationPolicy,
  assertPublication,
  publicationBody,
  publishDestination,
} from "../../../all/copy-overwrite/scripts/lib/npm-update-publish.mjs";
import { discoverPrior } from "../../../all/copy-overwrite/scripts/lib/npm-update-allocate.mjs";
import { persistCheckpoint } from "../../../all/copy-overwrite/scripts/lib/npm-update-recovery.mjs";
import {
  destinationSnapshot,
  authorizeAllocation,
  prepareAuthorization,
  recoveryRecord,
} from "../../../all/copy-overwrite/scripts/lib/npm-update-authorization.mjs";
import { CLAIM } from "../../../all/copy-overwrite/scripts/lib/npm-update-contract.mjs";
import { sha256 } from "../../../all/copy-overwrite/scripts/lib/github-attestation-verifier.mjs";
import { canonicalJson } from "../../../all/copy-overwrite/scripts/lisa-automation-provenance.mjs";

const MEDIUM_PRIORITY = "priority:medium";
const MANIFEST_FILE = "package.json";
const LOCK_FILE = "package-lock.json";

const TRUSTED_CHECKOUT = "/trusted/checkout";
const REPOSITORY = "acme/widgets";
const WORK_ITEM = "acme/widgets#42";
const TASK_LABEL = "type:Task";
const STALE_MODE = "stale-outstanding";
const REQUIRED_CHECK = "required-ci";

describe("publisher native blob refusal", () => {
  it("compares actual Git blob bytes and stops before any tree write on mismatch", async () => {
    const { GitHub } =
      await import("../../../all/copy-overwrite/scripts/lib/npm-update-github.mjs");
    const { withPrivateRoot, runProcess } =
      await import("../../../all/copy-overwrite/scripts/lib/npm-update-process.mjs");
    const { mkdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    await withPrivateRoot(async (root, env) => {
      const cwd = join(root, "publisher");
      const calls: unknown[] = [];
      const fixture = {
        policy: { repository: REPOSITORY },
        request: async (endpoint: string, method: string, body: unknown) => {
          calls.push({ endpoint, method, body });
          return { sha: "0".repeat(40) };
        },
      };
      mkdirSync(cwd);
      await runProcess("git", ["init", "--object-format=sha1"], { cwd, env });
      // This unit reaches the real method with synthetic transport; it grants no constructor/provider authority.
      await expect(
        Reflect.apply(GitHub.prototype.gitCommit, fixture, [
          {
            files: {
              [MANIFEST_FILE]: "unused",
              [LOCK_FILE]: "exact original bytes",
            },
          },
          {},
          {},
          async () => calls.push("authorize"),
          cwd,
        ])
      ).rejects.toThrow(/provider blob bytes differ/);
      expect(calls).toEqual([
        "authorize",
        {
          endpoint: `repos/${REPOSITORY}/git/blobs`,
          method: "POST",
          body: {
            content: Buffer.from("exact original bytes").toString("base64"),
            encoding: "base64",
          },
        },
      ]);
    });
  });
  it("refuses corrupt or missing native child results before the next provider write", async () => {
    const { GitHub } =
      await import("../../../all/copy-overwrite/scripts/lib/npm-update-github.mjs");
    const bounded =
      await import("../../../all/copy-overwrite/scripts/lib/bounded-spawn.mjs");
    const { withPrivateRoot, runProcess } =
      await import("../../../all/copy-overwrite/scripts/lib/npm-update-process.mjs");
    const { mkdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    await withPrivateRoot(async (root, env) => {
      const cwd = join(root, "native-failure");
      mkdirSync(cwd);
      await runProcess("git", ["init", "--object-format=sha1"], { cwd, env });
      const format = bounded.boundedSpawnSync(
        "git",
        ["rev-parse", "--show-object-format"],
        { cwd, env, encoding: "utf8", timeout: 30_000, maxBuffer: 128 }
      );
      for (const changed of [
        { ...format, stdout: "invalid\n" },
        {
          ...format,
          status: null,
          error: new Error("simulated missing child"),
        },
        {
          ...format,
          stdout: `${"a".repeat(40)}\n`,
          stderr: "unexpected diagnostic",
        },
      ]) {
        const calls: string[] = [];
        const fixture = {
          policy: { repository: REPOSITORY },
          request: async (endpoint: string) => {
            calls.push(endpoint);
            return { sha: "a".repeat(40) };
          },
        };
        const spy = vi
          .spyOn(bounded, "boundedSpawnSync")
          .mockReturnValueOnce(format)
          .mockReturnValueOnce(changed);
        try {
          await expect(
            Reflect.apply(GitHub.prototype.gitCommit, fixture, [
              {
                files: {
                  [MANIFEST_FILE]: "exact bytes",
                  [LOCK_FILE]: "unused",
                },
              },
              {},
              {},
              async () => {},
              cwd,
            ])
          ).rejects.toThrow(/native Git object identity/);
          expect(calls).toEqual([`repos/${REPOSITORY}/git/blobs`]);
        } finally {
          spy.mockRestore();
        }
      }
    });
  });
});

describe("supported publication backlink ordering", () => {
  it("rechecks authorization separately before backlink and complete-range validation", async () => {
    const { publicationBacklink } =
      await import("../../../all/copy-overwrite/scripts/lib/npm-update-publication.mjs");
    const calls: unknown[] = [];
    const context = {
      controller: {},
      api: {
        workItem: async (cwd: string, args: string[]) =>
          calls.push([cwd, args]),
      },
      cwd: TRUSTED_CHECKOUT,
      proposal: { parent: "a".repeat(40), repository: REPOSITORY },
      allocation: { workItem: WORK_ITEM },
      commit: { sha: "b".repeat(40) },
      authorize: async () => {
        calls.push("authorization");
      },
    };
    const pr = {
      number: 12,
      html_url: "https://github.com/acme/widgets/pull/12",
    };
    await publicationBacklink(context, pr);
    expect(calls).toEqual([
      "authorization",
      [
        context.cwd,
        [
          "backlink",
          "--ref",
          context.allocation.workItem,
          "--pr-url",
          pr.html_url,
        ],
      ],
      "authorization",
      [
        context.cwd,
        [
          "validate-pr",
          "--base",
          context.proposal.parent,
          "--head",
          context.commit.sha,
          "--pr-number",
          "12",
          "--repo",
          context.proposal.repository,
          "--pr-url",
          pr.html_url,
        ],
      ],
    ]);
    let reads = 0;
    calls.length = 0;
    await expect(
      publicationBacklink(
        {
          ...context,
          authorize: async () => {
            if (++reads === 2) throw Error("current hold");
          },
        },
        pr
      )
    ).rejects.toThrow(/current hold/);
    expect(calls).toHaveLength(1);
    expect((calls[0] as unknown[])[1]).toContain("backlink");
  });
});
const CLAIMED = "queue:active";
const policy = { repository: REPOSITORY, maintainer: "maintainer" };
const config = {
  tracker: "github",
  github: {
    org: "acme",
    repo: "widgets",
    labels: {
      build: {
        ready: "queue:ready",
        claimed: CLAIMED,
        human_needed: "needs-person",
        blocked: "queue:blocked",
        done: { production: "queue:done" },
      },
    },
  },
  deploy: { branches: { production: "main" } },
};
const proposal = {
  key: "a".repeat(64),
  selectionKey: "e".repeat(64),
  parent: "b".repeat(40),
  updates: [
    { name: "is-number", section: "dependencies", from: "6.0.0", to: "7.0.0" },
  ],
  hashes: {
    [MANIFEST_FILE]: "c".repeat(64),
    [LOCK_FILE]: "d".repeat(64),
  },
};
const evidence = {
  history: {
    command: "git log main -- package.json package-lock.json",
    result: "none",
  },
  search: { query: "repo:acme/widgets npm in:title,body", total: 0 },
  registry: [{ name: "is-number", version: "7.0.0" }],
  labels: [TASK_LABEL, MEDIUM_PRIORITY, "queue:ready", CLAIMED],
  main: proposal.parent,
};
const draft = () => buildDraft(proposal, policy, config, evidence);
const live = () => ({
  number: 42,
  state: "open",
  title: draft().title,
  body: draft().body,
  labels: draft().labels.map(name => ({ name })),
  assignees: [{ login: "maintainer", type: "User", id: 7 }],
  comments: Array<{
    id?: number;
    body: string;
    user: { id: number; type: string };
  }>(),
  children: [],
  blockers: [],
});
describe("bounded selected registry evidence", () => {
  const integrity = `sha512-${Buffer.alloc(64, 1).toString("base64")}`;
  const tarball = "https://registry.npmjs.org/is-number/-/is-number-7.0.0.tgz";
  const update = proposal.updates[0];
  if (!update) throw Error("selected update fixture required");
  const selected = {
    files: {
      [LOCK_FILE]: JSON.stringify({
        packages: {
          "node_modules/is-number": {
            version: update.to,
            resolved: tarball,
            integrity,
          },
        },
      }),
    },
  };
  const metadata = {
    name: update.name,
    version: update.to,
    dist: { integrity, tarball },
  };
  it("requires exact registry name, version, integrity and archive agreement", async () => {
    const request = vi.spyOn(globalThis, "fetch");
    try {
      request.mockResolvedValueOnce(Response.json(metadata));
      expect(await registryVersion(update, selected)).toEqual({
        name: update.name,
        version: update.to,
      });
      expect(request.mock.calls[0]?.[0]).toBe(
        "https://registry.npmjs.org/is-number/7.0.0"
      );
      for (const changed of [
        { name: "other" },
        { version: "8.0.0" },
        { dist: { ...metadata.dist, integrity: "sha512-other" } },
        {
          dist: {
            ...metadata.dist,
            tarball: "https://other.example/package.tgz",
          },
        },
      ]) {
        request.mockResolvedValueOnce(
          Response.json({ ...metadata, ...changed })
        );
        await expect(registryVersion(update, selected)).rejects.toThrow(
          /differs/
        );
      }
    } finally {
      request.mockRestore();
    }
  });
  it("cancels an oversized streaming response before reading its remainder", async () => {
    let canceled = false;
    let pulls = 0;
    const body = new ReadableStream(
      {
        pull(controller) {
          pulls++;
          controller.enqueue(new Uint8Array(524_289));
        },
        cancel() {
          canceled = true;
        },
      },
      { highWaterMark: 0 }
    );
    const request = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(body));
    try {
      await expect(registryVersion(update, selected)).rejects.toThrow(/bound/);
      expect(canceled).toBe(true);
      expect(pulls).toBe(2);
    } finally {
      request.mockRestore();
    }
  });
  it("refuses failed registry responses and invalid UTF8 without evidence", async () => {
    const request = vi.spyOn(globalThis, "fetch");
    try {
      request.mockResolvedValueOnce(
        new Response("unavailable", { status: 503 })
      );
      await expect(registryVersion(update, selected)).rejects.toThrow(
        /unavailable/
      );
      request.mockResolvedValueOnce(new Response(new Uint8Array([255])));
      await expect(registryVersion(update, selected)).rejects.toThrow();
    } finally {
      request.mockRestore();
    }
  });
});
describe("current allocation authorization boundaries", () => {
  const claim = { id: 123, body: CLAIM, user: { id: 456, type: "Bot" } };
  const allocation = {
    number: 42,
    workItem: WORK_ITEM,
    claimCommentId: "123",
    claimSha256: sha256(CLAIM),
    draft: draft(),
    evidence,
  };
  function transport(changes = {}) {
    const reads: string[] = [];
    return {
      reads,
      policy: { claimActorId: "456" },
      main: async (parent: string) => {
        expect(parent).toBe(proposal.parent);
        reads.push("main");
      },
      assignable: async (login: string) => {
        expect(login).toBe(policy.maintainer);
        reads.push("assignable");
      },
      issue: async () => {
        reads.push("issue");
        return {
          ...live(),
          labels: [
            { name: TASK_LABEL },
            { name: MEDIUM_PRIORITY },
            { name: CLAIMED },
          ],
          comments: [claim],
          ...changes,
        };
      },
    };
  }
  it("requires the exact current canonical claim, live owner and specification", async () => {
    const api = transport();
    expect(
      (await authorizeAllocation(api, proposal, allocation, policy, config))
        .number
    ).toBe(42);
    expect(api.reads).toEqual(["main", "assignable", "issue"]);
    for (const changes of [
      { comments: [] },
      { comments: [{ ...claim, id: 124 }] },
      { comments: [{ ...claim, user: { id: 456, type: "User" } }] },
      { comments: [claim, claim] },
      { assignees: [] },
      { body: `${draft().body}\nchanged` },
    ])
      await expect(
        authorizeAllocation(
          transport(changes),
          proposal,
          allocation,
          policy,
          config
        )
      ).rejects.toThrow();
  });
  it("preserves stale-outstanding identity without filesystem or provider calls", async () => {
    const stale = {
      status: STALE_MODE,
      number: 42,
      workItem: allocation.workItem,
    };
    const forbidden = new Proxy(
      {},
      {
        get() {
          throw Error("unexpected provider access");
        },
      }
    );
    expect(
      await prepareAuthorization({
        api: forbidden,
        cwd: "/missing",
        output: "/missing",
        allocation: stale,
        proposal,
        policy,
        config,
      })
    ).toEqual({ mode: STALE_MODE, allocation: stale });
  });
  it("binds a fresh recovery record to immutable original bytes and current claim/body", () => {
    const priorId = process.env.GITHUB_RUN_ID;
    const priorAttempt = process.env.GITHUB_RUN_ATTEMPT;
    process.env.GITHUB_RUN_ID = "222";
    process.env.GITHUB_RUN_ATTEMPT = "1";
    try {
      const message = "chore: fixture\n\nWork-Item: acme/widgets#42\n";
      const descriptor = {
        queue: policy.repository,
        workItem: allocation.workItem,
        proposalKey: "f".repeat(64),
        policySha256: "e".repeat(64),
        runId: "111",
        runAttempt: "1",
        parent: proposal.parent,
        tree: "d".repeat(40),
        author: "Fixture <fixture@example.invalid> 1700000000 +0000",
        committer: "Fixture <fixture@example.invalid> 1700000000 +0000",
        messageSha256: sha256(message),
      };
      const preview = { descriptor, message };
      const snapshot = {
        branch: `lisa/npm-${proposal.key}`,
        expectedBranchHead: null,
        prNumber: null,
        expectedPrHead: null,
      };
      const record = recoveryRecord(
        { ...proposal, policySha256: "c".repeat(64) },
        allocation,
        preview,
        policy,
        { repositoryId: "10", ownerId: "20" },
        live(),
        snapshot
      );
      expect(record.originRunId).toBe("111");
      expect(record.runId).toBe("222");
      expect(record.originDescriptorSha256).toBe(
        sha256(`${canonicalJson(descriptor)}\n`)
      );
      expect(record.leafBodySha256).toBe(sha256(live().body));
      expect(record.claimCommentId).toBe("123");
      expect(record.expectedBranchHead).toBeNull();
      expect(() =>
        recoveryRecord(
          { ...proposal, policySha256: "c".repeat(64) },
          allocation,
          { ...preview, message: `${message}changed` },
          policy,
          {},
          live(),
          snapshot
        )
      ).toThrow(/origin message bytes differ/);
    } finally {
      if (priorId === undefined) delete process.env.GITHUB_RUN_ID;
      else process.env.GITHUB_RUN_ID = priorId;
      if (priorAttempt === undefined) delete process.env.GITHUB_RUN_ATTEMPT;
      else process.env.GITHUB_RUN_ATTEMPT = priorAttempt;
    }
  });
});
describe("configured claim transition readbacks", () => {
  it("preserves assigned ownership and retries the actual canonical claim without duplicate writes", async () => {
    const issue = live();
    const writes: Array<{ endpoint: string; method: string }> = [];
    const api = {
      policy: { claimActorId: "456" },
      issue: async () => structuredClone(issue),
      assignable: async () => {
        throw Error("existing ownership must not be reassigned");
      },
      request: async (
        endpoint: string,
        method: string,
        value: { labels?: string[]; body?: string }
      ) => {
        writes.push({ endpoint, method });
        if (method === "PATCH")
          issue.labels = value.labels!.map(name => ({ name }));
        else
          issue.comments.push({
            id: 123,
            body: value.body!,
            user: { id: 456, type: "Bot" },
          });
      },
    };
    const roles = leafRoles(config, policy.repository);
    const first = await claimLeaf(
      api,
      issue,
      draft(),
      proposal,
      policy,
      config,
      evidence,
      roles
    );
    expect(first.state.claimed).toBe(true);
    expect(first.state.claims[0].id).toBe(123);
    expect(issue.assignees).toEqual([
      { login: "maintainer", type: "User", id: 7 },
    ]);
    expect(writes.map(value => value.method)).toEqual(["PATCH", "POST"]);
    await claimLeaf(
      api,
      issue,
      draft(),
      proposal,
      policy,
      config,
      evidence,
      roles
    );
    expect(writes).toHaveLength(2);
  });
  it("refuses foreign ownership and changed claim readback without reassignment", async () => {
    for (const changes of [
      { assignees: [{ login: "other", type: "User", id: 9 }] },
      {
        labels: [
          { name: TASK_LABEL },
          { name: MEDIUM_PRIORITY },
          { name: CLAIMED },
        ],
        comments: [{ id: 123, body: CLAIM, user: { id: 999, type: "Bot" } }],
      },
    ]) {
      let writes = 0;
      const issue = { ...live(), ...changes };
      const api = {
        policy: { claimActorId: "456" },
        issue: async () => issue,
        assignable: async () => {
          writes++;
        },
        request: async () => {
          writes++;
        },
      };
      await expect(
        claimLeaf(
          api,
          issue,
          draft(),
          proposal,
          policy,
          config,
          evidence,
          leafRoles(config, policy.repository)
        )
      ).rejects.toThrow();
      expect(writes).toBe(0);
    }
  });
});
describe("fixed dependency leaf", () => {
  it("evaluates every configured writer quality gate independently of a roundtrip", () => {
    const gates = qualityGates(draft(), proposal, policy, config, evidence);
    expect(gates).toHaveLength(25);
    expect(gates.every(gate => ["PASS", "N/A"].includes(gate.verdict))).toBe(
      true
    );
    const thin = { ...draft(), body: "Updated dependencies" };
    expect(() =>
      qualityGates(thin, proposal, policy, config, evidence)
    ).toThrow();
  });
  it("derives the runtime environment and branch plan rather than pretending config-only", () => {
    expect(draft().body).toContain(
      "Assumption: production — remote default branch main"
    );
    expect(draft().body).toContain(
      "Derived from: Target Backend Environment production via .lisa.config.json deploy.branches"
    );
    expect(draft().body).toContain("[EVIDENCE: cli-output: npm-ci]");
  });
  it("refuses ambiguous environments, configured projects and wrong queues", () => {
    expect(() =>
      buildDraft(
        proposal,
        policy,
        { ...config, deploy: { branches: { one: "main", two: "main" } } },
        evidence
      )
    ).toThrow();
    expect(() =>
      buildDraft(
        proposal,
        policy,
        { ...config, github: { ...config.github, project: { enabled: true } } },
        evidence
      )
    ).toThrow();
    expect(() =>
      buildDraft(
        proposal,
        policy,
        { ...config, github: { ...config.github, queueRepo: "foreign/queue" } },
        evidence
      )
    ).toThrow();
  });
  it("refuses closed, foreign-owned, blocked and container work without editing it", async () => {
    for (const changes of [
      { state: "closed" },
      { assignees: [{ login: "other", type: "User", id: 8 }] },
      { children: [{ state: "open" }] },
      { blockers: [{ state: "open" }] },
    ])
      await expect(
        inspectLeaf({ ...live(), ...changes }, draft(), policy, config)
      ).rejects.toThrow();
  });
  it("a bot-authored release cannot discharge a marker-only hold", async () => {
    const issue = live();
    issue.body += "\n<!-- [lisa-human-gate] reason=approval -->";
    issue.comments = [
      {
        body: "<!-- [lisa-human-gate-release] reason=approval -->",
        user: { id: 7, type: "Bot" },
      },
    ];
    await expect(inspectLeaf(issue, draft(), policy, config)).rejects.toThrow();
  });
  it("preserves a still-authorized later lifecycle role", async () => {
    const issue = live();
    issue.labels = [
      { name: TASK_LABEL },
      { name: MEDIUM_PRIORITY },
      { name: CLAIMED },
    ];
    expect((await inspectLeaf(issue, draft(), policy, config)).claimed).toBe(
      true
    );
  });
});
describe("publication controls", () => {
  it("refuses premature closing instructions embedded in immutable filing history", () => {
    for (const relationship of [
      "close #42",
      "Closes #42",
      "closed\n#42",
      "fix #42",
      "fixes acme/widgets#42",
      "FIXED ACME/widgets#42",
      "resolve https://github.com/acme/widgets/issues/42",
      "Resolves https://github.com/acme/widgets/issues/42",
      "resolved\t#42",
    ])
      expect(() =>
        publicationBody({
          draft: { body: relationship },
          workItem: WORK_ITEM,
        })
      ).toThrow(/closing/);
  });
  it("preserves ordinary prose and explicit non-closing relationships", () => {
    for (const relationship of [
      "Relates to #42",
      "prefixes #42",
      "close issue #42 after verification",
      "fix #0 is invalid prose data",
    ])
      expect(
        publicationBody({
          draft: { body: relationship },
          workItem: WORK_ITEM,
        })
      ).toContain(relationship);
  });
  it("requires current-head check integration identity and newest successful execution", () => {
    const sha = "a".repeat(40);
    const pr = { state: "open", head: { sha }, base: { ref: "main" } };
    const review = {
      id: 1,
      submitted_at: "2026-10-05T01:00:00Z",
      state: "APPROVED",
      commit_id: sha,
      user: { id: 7, type: "User" },
    };
    const check = {
      id: 11,
      name: REQUIRED_CHECK,
      app: { id: 9 },
      head_sha: sha,
      status: "completed",
      conclusion: "success",
    };
    const requirement = [{ name: REQUIRED_CHECK, appId: 9 }];
    expect(() =>
      assertPublication(pr, [check], [review], sha, requirement)
    ).not.toThrow();
    for (const checks of [
      [{ ...check, app: { id: 8 } }],
      [check, { ...check, id: 12, conclusion: "failure" }],
      [check, { ...check, id: 12, status: "in_progress" }],
    ])
      expect(() =>
        assertPublication(pr, checks, [review], sha, requirement)
      ).toThrow();
    expect(() =>
      assertPublication(pr, [check], [review], sha, [REQUIRED_CHECK])
    ).toThrow(/integration/);
  });
  it("declares the complete item set without premature closing keywords", () => {
    const body = publicationBody({
      draft: draft(),
      workItem: WORK_ITEM,
      number: 42,
    });
    expect(body).not.toMatch(
      /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#42/i
    );
    expect(body).toContain("Work-Item: acme/widgets#42\n");
    expect(body).toContain("https://github.com/acme/widgets/issues/42");
  });
  it("fails closed while Actions PR creation is disabled", () => {
    expect(() =>
      assertPublicationPolicy({ can_approve_pull_request_reviews: false })
    ).toThrow(/creation/);
    expect(() =>
      assertPublicationPolicy({ can_approve_pull_request_reviews: true })
    ).not.toThrow();
  });
  it("does not count stale checks, skipped gates or unapproved reviews", () => {
    const pr = {
      state: "open",
      head: { sha: "a".repeat(40) },
      base: { ref: "main" },
    };
    expect(() => assertPublication(pr, [], [], pr.head.sha)).toThrow();
    expect(() =>
      assertPublication(
        pr,
        [
          {
            head_sha: "b".repeat(40),
            status: "completed",
            conclusion: "success",
          },
        ],
        [{ state: "APPROVED", commit_id: pr.head.sha, user: { type: "User" } }],
        pr.head.sha
      )
    ).toThrow();
  });
});

describe("actual main environment terminal policy", () => {
  it("binds terminal roles to dev, staging or production rather than assuming production", () => {
    for (const environment of ["dev", "staging", "production"]) {
      const terminal = `done-${environment}`;
      const mapped = {
        ...config,
        deploy: { branches: { [environment]: "main" } },
        github: {
          ...config.github,
          labels: { build: { done: { [environment]: terminal } } },
        },
      };
      const roles = leafRoles(mapped, policy.repository);
      expect(roles.terminal).toBe(terminal);
      expect(roles.later).not.toContain(terminal);
    }
  });
  it("refuses an open terminal-labelled leaf before claim or provider mutation", async () => {
    for (const environment of ["dev", "staging"]) {
      const terminal = `done-${environment}`;
      const mapped = {
        ...config,
        deploy: { branches: { [environment]: "main" } },
        github: {
          ...config.github,
          labels: { build: { done: { [environment]: terminal } } },
        },
      };
      const expected = buildDraft(proposal, policy, mapped, evidence);
      const issue = {
        ...live(),
        title: expected.title,
        body: expected.body,
        labels: [
          { name: TASK_LABEL },
          { name: MEDIUM_PRIORITY },
          { name: terminal },
        ],
      };
      await expect(
        inspectLeaf(issue, expected, policy, mapped)
      ).rejects.toThrow(/terminal/);
    }
  });
  it("reuses canonical environment defaults and preserves scalar terminal policy", () => {
    const mapped = { ...config, deploy: { branches: { dev: "main" } } };
    const missing = {
      ...mapped,
      github: {
        ...mapped.github,
        labels: { build: { done: { production: "done-production" } } },
      },
    };
    expect(leafRoles(missing, policy.repository).terminal).toBe(
      "status:on-dev"
    );
    expect(
      leafRoles(
        { ...mapped, github: { ...mapped.github, labels: { build: {} } } },
        policy.repository
      ).terminal
    ).toBe("status:on-dev");
    expect(
      leafRoles(
        {
          ...mapped,
          github: {
            ...mapped.github,
            labels: { build: { done: "done-runtime" } },
          },
        },
        policy.repository
      ).terminal
    ).toBe("done-runtime");
  });
});

describe("exact publication destination preflight", () => {
  const allocation = {
    draft: draft(),
    workItem: WORK_ITEM,
    number: 42,
  };
  const commit = "c".repeat(40);
  const branch = `lisa/npm-${proposal.key}`;
  const ref = {
    ref: `refs/heads/${branch}`,
    object: { type: "commit", sha: commit },
  };
  const pr = {
    number: 12,
    html_url: "https://github.com/acme/widgets/pull/12",
    state: "open",
    body: publicationBody(allocation),
    user: { type: "Bot", login: "github-actions[bot]" },
    head: { sha: commit, ref: branch, repo: { full_name: REPOSITORY } },
    base: {
      ref: "main",
      sha: proposal.parent,
      repo: { full_name: REPOSITORY },
    },
  };
  function transport(reference = ref, pulls = [pr]) {
    return { maybe: async () => reference, list: async () => pulls };
  }
  it("accepts only the exact existing destination and refuses foreign metadata", async () => {
    const selected = { ...proposal, repository: REPOSITORY };
    expect(
      (await destinationSnapshot(transport(), selected, allocation, commit))
        .prNumber
    ).toBe(12);
    for (const change of [
      { number: -1 },
      { html_url: "https://github.com/foreign/other/pull/12" },
      { state: "closed" },
      { body: `${pr.body}\nWork-Item: acme/widgets#99` },
      { head: { ...pr.head, repo: { full_name: "foreign/other" } } },
    ])
      await expect(
        destinationSnapshot(
          transport(ref, [{ ...pr, ...change }]),
          selected,
          allocation,
          commit
        )
      ).rejects.toThrow();
    await expect(
      destinationSnapshot(
        transport({ ...ref, object: { type: "tag", sha: commit } }),
        selected,
        allocation,
        commit
      )
    ).rejects.toThrow();
  });
  it("publisher recovery invokes the supported backlink and complete-range validator without duplicate publication writes", async () => {
    const commands: string[][] = [];
    const writes: string[] = [];
    const api = {
      ...transport(),
      policy: { repository: policy.repository },
      request: async (endpoint: string, method = "GET") => {
        if (method !== "GET") writes.push(endpoint);
        return pr;
      },
      workItem: async (_cwd: string, args: string[]) => {
        commands.push(args);
      },
    };
    let authorization = 0;
    const args = {
      api,
      controller: {},
      cwd: TRUSTED_CHECKOUT,
      proposal: { ...proposal, repository: policy.repository },
      allocation,
      policy,
      config,
      commit: { sha: commit },
      authorize: async () => {
        authorization++;
      },
    };
    expect((await publishDestination(args)).commit).toBe(commit);
    expect((await publishDestination(args)).commit).toBe(commit);
    expect(writes).toHaveLength(0);
    expect(commands[0]).toEqual([
      "backlink",
      "--ref",
      allocation.workItem,
      "--pr-url",
      pr.html_url,
    ]);
    expect(commands[1]).toContain("validate-pr");
    expect(commands[1]).toContain(proposal.parent);
    expect(commands[1]).toContain(commit);
    expect(commands[1]).toContain("--pr-number");
    expect(authorization).toBeGreaterThanOrEqual(6);
  });
  it("publisher refuses a newly held leaf or foreign PR before mutation or backlink", async () => {
    let writes = 0;
    const api = {
      ...transport(),
      request: async () => {
        writes++;
        return pr;
      },
      workItem: async () => {
        writes++;
      },
    };
    const args = {
      api,
      controller: {},
      cwd: TRUSTED_CHECKOUT,
      proposal: { ...proposal, repository: policy.repository },
      allocation,
      policy,
      config,
      commit: { sha: commit },
      authorize: async () => {
        throw Error("fresh human hold");
      },
    };
    await expect(publishDestination(args)).rejects.toThrow(/hold/);
    expect(writes).toBe(0);
    await expect(
      publishDestination({
        ...args,
        api: { ...api, list: async () => [{ ...pr, body: "foreign body" }] },
        authorize: async () => {},
      })
    ).rejects.toThrow(/preserved/);
    expect(writes).toBe(0);
  });
});

describe("unfinished proposal discovery precedes allocation writes", () => {
  const selectionKey = "e".repeat(64);
  it("preserves an unfinished equivalent selection on main advance", async () => {
    const issue = { ...live(), body: draft().body };
    const calls: string[] = [];
    const api = {
      policy: { repository: policy.repository },
      request: async (endpoint: string) => {
        calls.push(endpoint);
        return {
          total_count: 1,
          incomplete_results: false,
          items: [{ number: 42 }],
        };
      },
      issue: async () => issue,
    };
    const result = await discoverPrior(api, {
      ...proposal,
      selectionKey,
      parent: "f".repeat(40),
    });
    expect(result.status).toBe(STALE_MODE);
    expect(result.issue).toBe(issue);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain(encodeURIComponent(selectionKey));
  });
  it("does not substitute closed, ambiguous or incomplete search results", async () => {
    for (const search of [
      {
        total_count: 2,
        incomplete_results: false,
        items: [{ number: 42 }, { number: 43 }],
      },
      { total_count: 0, incomplete_results: true, items: [] },
    ])
      await expect(
        discoverPrior(
          { request: async () => search },
          { ...proposal, selectionKey }
        )
      ).rejects.toThrow();
    await expect(
      discoverPrior(
        {
          request: async () => ({
            total_count: 1,
            incomplete_results: false,
            items: [{ number: 42 }],
          }),
          issue: async () => ({ ...live(), state: "closed" }),
        },
        { ...proposal, selectionKey }
      )
    ).rejects.toThrow();
  });
});

/** Memory transport tests are write/readback controls, not provider success. */
describe("checkpoint writer readback and retry controls", () => {
  const payload = {
    version: 1,
    proposal: {},
    allocation: {},
    preview: null,
    bundle: "",
  };
  const digest = "a".repeat(64);
  function transport(corrupt = false) {
    const comments: Array<{ id: number; body: string; issue_url: string }> = [];
    const writes: string[] = [];
    return {
      comments,
      writes,
      policy: { repository: policy.repository },
      list: async () => [...comments],
      request: async (
        endpoint: string,
        method = "GET",
        body?: { body: string }
      ) => {
        if (method === "POST") {
          writes.push(endpoint);
          const value = {
            id: comments.length + 1,
            body: body!.body,
            issue_url: "https://api.github.com/repos/acme/widgets/issues/42",
          };
          comments.push(value);
          return value;
        }
        const value = comments.find(comment =>
          endpoint.endsWith(`/${comment.id}`)
        )!;
        return corrupt ? { ...value, body: "changed public readback" } : value;
      },
    };
  }
  it("stores chunks before completion and exact retry produces no additional writes", async () => {
    const api = transport();
    let authorization = 0;
    const allow = async () => {
      authorization++;
    };
    expect(
      (await persistCheckpoint(api, 42, payload, digest, allow)).complete
    ).toBe(true);
    const count = api.writes.length;
    expect(count).toBe(2);
    expect(api.comments.at(-1)!.body).toContain(" complete\n");
    await persistCheckpoint(api, 42, payload, digest, allow);
    expect(api.writes).toHaveLength(count);
    expect(authorization).toBe(4);
  });
  it("refuses bad readback and failed fresh authority before completion", async () => {
    const api = transport(true);
    await expect(
      persistCheckpoint(api, 42, payload, digest, async () => {})
    ).rejects.toThrow(/readback/);
    expect(
      api.comments.every(comment => !comment.body.includes(" complete\n"))
    ).toBe(true);
    const absent = transport();
    await expect(
      persistCheckpoint(absent, 42, payload, digest, async () => {
        throw Error("current claim changed");
      })
    ).rejects.toThrow(/claim/);
    expect(absent.writes).toHaveLength(0);
  });
  it("refuses a comment readback from a different canonical leaf", async () => {
    const api = transport();
    const request = api.request;
    api.request = async (...args: Parameters<typeof request>) => ({
      ...(await request(...args)),
      issue_url: "https://api.github.com/repos/acme/widgets/issues/99",
    });
    await expect(
      persistCheckpoint(api, 42, payload, digest, async () => {})
    ).rejects.toThrow(/scope/);
    expect(
      api.comments.every(comment => !comment.body.includes(" complete\n"))
    ).toBe(true);
  });
});
