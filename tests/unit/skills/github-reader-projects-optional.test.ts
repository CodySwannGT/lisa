/** Exercise actual reader selection and the complete required repository context. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readGitHubIssue } from "../../../src/cli/github-read-issue-cmd.js";
import {
  OWNER,
  PROJECT_REFUSAL,
  REF,
  REPOSITORY_REFUSAL,
  projectBlock,
  readerFixture,
} from "../../support/github-reader-fixture.js";

const COMMITTED = ".lisa.config.json";
const LOCAL = ".lisa.config.local.json";
const roots: string[] = [];
const PROJECT_REQUEST = /projectItems|projectV2|projectCards/iu;
const MUTATION = /\bmutation\b|--method\s+(?:POST|PATCH|PUT|DELETE)/iu;

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

/**
 * Write the committed fixture using optional Project configuration.
 * @param projects - Settings for the committed GitHub Projects block.
 * @returns A private fixture directory.
 */
function project(projects?: object): string {
  const root = mkdtempSync(join(tmpdir(), "lisa-github-issue-reader-"));
  roots.push(root);
  writeFileSync(
    join(root, COMMITTED),
    JSON.stringify({
      tracker: "github",
      github: { org: OWNER, repo: "product", projects },
    })
  );
  return root;
}

/**
 * Require two comment pages, native graph edges and all recorded review data.
 * @param result - Actual reader output.
 */
function assertRepository(
  result: Awaited<ReturnType<typeof readGitHubIssue>>
): void {
  expect(result.ref).toBe(REF);
  expect(result.issue).toMatchObject({
    number: 7,
    title: "Fixture issue",
    state: "OPEN",
  });
  expect(result.comments).toEqual([{ id: 1 }, { id: 2 }]);
  expect(result.graph).toMatchObject({
    parent: { number: 2 },
    children: [{ number: 8 }, { number: 10 }],
  });
  expect(result.timeline.events).toHaveLength(2);
  expect(result.pullRequests).toEqual([
    expect.objectContaining({
      metadata: {
        number: 9,
        headRefOid: "native-head",
        baseRefName: "main",
        reviewDecision: "CHANGES_REQUESTED",
      },
      reviews: [{ id: 11 }, { id: 12 }],
      threads: [
        {
          id: "THREAD-1",
          isResolved: false,
          comments: [{ id: 41 }, { id: 42 }],
        },
      ],
    }),
  ]);
}

/**
 * Find optional service operations and assert the journal stayed read-only.
 * @param fixture - Recording transport after the actual reader ran.
 * @returns Requests that selected Projects fields or routes.
 */
function projectsRequested(
  fixture: ReturnType<typeof readerFixture>
): string[] {
  const requests = fixture.requests.map(args => args.join(" "));
  expect(fixture.unsupported).toEqual([]);
  expect(requests.filter(request => MUTATION.test(request))).toEqual([]);
  return requests.filter(request => PROJECT_REQUEST.test(request));
}

describe("GitHub issue reader selects Projects from effective configuration", () => {
  it("reads complete paginated repository context with zero Projects requests when absent", async () => {
    const root = project();
    const fixture = readerFixture({ denyProject: true });
    const result = await readGitHubIssue(root, "#7", fixture.read);
    assertRepository(result);
    expect(result.project).toEqual({ status: "unconfigured" });
    expect(projectsRequested(fixture)).toEqual([]);
  });

  it("uses the effective Project number and false required override while keeping repository context", async () => {
    const root = project(projectBlock(16, true));
    const fixture = readerFixture();
    writeFileSync(
      join(root, LOCAL),
      JSON.stringify({
        github: { projects: { v2: { number: 23, required: false } } },
      })
    );
    const result = await readGitHubIssue(
      root,
      `https://github.com/${OWNER}/product/issues/7`,
      fixture.read
    );
    assertRepository(result);
    expect(result.project).toMatchObject({
      status: "verified",
      metadata: { id: "PROJECT_FIXTURE", number: 23 },
    });
    expect(projectsRequested(fixture)).toEqual([
      expect.stringContaining(`login=${OWNER} -F number=23`),
    ]);
  });

  it("retains the exact best-effort service refusal without dropping repository pages", async () => {
    const root = project(projectBlock(23, true));
    const fixture = readerFixture({ denyProject: true });
    writeFileSync(
      join(root, LOCAL),
      JSON.stringify({ github: { projects: { v2: { required: false } } } })
    );
    const result = await readGitHubIssue(root, REF, fixture.read);
    assertRepository(result);
    expect(result.project).toEqual({
      status: "unverified",
      warning: PROJECT_REFUSAL,
    });
    expect(projectsRequested(fixture)).toHaveLength(1);
  });

  it("stops a required Projects refusal before returning a context bundle", async () => {
    const fixture = readerFixture({ denyProject: true });
    const root = project(projectBlock(23, true));
    await expect(readGitHubIssue(root, REF, fixture.read)).rejects.toThrow(
      `Required GitHub Project could not be read. ${PROJECT_REFUSAL}`
    );
    expect(projectsRequested(fixture)).toHaveLength(1);
    expect(fixture.requests).toHaveLength(3);
  });

  it("keeps a required repository denial blocking in best-effort mode", async () => {
    const fixture = readerFixture({ denyIssue: true, denyProject: true });
    const root = project(projectBlock(23, false));
    await expect(
      readGitHubIssue(root, REF, fixture.read)
    ).rejects.toMatchObject({ stderr: `${REPOSITORY_REFUSAL}\n` });
    expect(projectsRequested(fixture)).toEqual([]);
    expect(fixture.requests).toHaveLength(2);
  });

  it("stops a primary-repository PR denial after the optional warning", async () => {
    const fixture = readerFixture({ denyReview: true, denyProject: true });
    const root = project(projectBlock(23, false));
    await expect(
      readGitHubIssue(root, REF, fixture.read)
    ).rejects.toMatchObject({
      stderr: `${REPOSITORY_REFUSAL}\n`,
    });
    expect(projectsRequested(fixture)).toHaveLength(1);
    expect(fixture.requests).toContainEqual(
      expect.arrayContaining(["pr", "view", "9"])
    );
  });

  it("refuses an incomplete required repository page sequence", async () => {
    const fixture = readerFixture({ commentCount: 3 });
    await expect(readGitHubIssue(project(), REF, fixture.read)).rejects.toThrow(
      "GitHub issue comments are incomplete. Read 2 of 3"
    );
    expect(projectsRequested(fixture)).toEqual([]);
  });

  it.each([
    ["bad syntax", "malformed-json", /Could not parse .*local\.json/u],
    ["non-object root", "[]", /must contain a JSON object/u],
    [
      "malformed Project block",
      '{"github":{"projects":{"v2":null}}}',
      /github\.projects\.v2 must be an object/u,
    ],
    [
      "invalid requiredness",
      '{"github":{"projects":{"v2":{"required":"false"}}}}',
      /required must be true or false/u,
    ],
  ])(
    "refuses %s before any GitHub request",
    async (_name, bytes, diagnosis) => {
      const root = project(projectBlock(23, false));
      const fixture = readerFixture();
      writeFileSync(join(root, LOCAL), bytes);
      await expect(readGitHubIssue(root, REF, fixture.read)).rejects.toThrow(
        diagnosis
      );
      expect(fixture.requests).toEqual([]);
    }
  );

  it("refuses an unreadable config target before any GitHub request", async () => {
    const root = project();
    const fixture = readerFixture();
    mkdirSync(join(root, LOCAL));
    await expect(readGitHubIssue(root, REF, fixture.read)).rejects.toThrow(
      /Unsafe health project file/u
    );
    expect(fixture.requests).toEqual([]);
  });
});
