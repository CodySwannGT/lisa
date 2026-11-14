/**
 * CodySwannGT/lisa#4859 (CodeRabbit, PR #4881): a release marker a trusted
 * human writes inside a code example is documentation, not a release. Jira
 * stores a code block as ADF and Linear as a Markdown fence; either way the
 * hold classifier must see the code boundary, exactly as it does for GitHub,
 * while a plain-prose release still lifts the hold.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { allocateLeaf } from "../../../all/copy-overwrite/scripts/lib/npm-update-allocate.mjs";
import { createTracker } from "../../../all/copy-overwrite/scripts/lib/npm-update-tracker.mjs";
import {
  adfCodeBlock,
  fence,
} from "../../../all/copy-overwrite/scripts/lib/npm-update-tracker-wire.mjs";
import { withPrivateRoot } from "../../../all/copy-overwrite/scripts/lib/npm-update-process.mjs";
import { publicFailure } from "../../../all/copy-overwrite/scripts/lib/npm-update-invariants.mjs";
import { fakeJira } from "../../support/npm-update-jira-fake.js";
import { fakeLinear } from "../../support/npm-update-linear-fake.js";
import {
  JIRA_CONFIG,
  JIRA_MAINTAINER,
  LINEAR_CONFIG,
  LINEAR_MAINTAINER,
  REGISTRY_METADATA,
  automation,
  codeHost,
  committedHost,
} from "../../support/npm-update-tracker-host.js";

const JIRA_ENV = { JIRA_API_TOKEN: "t", JIRA_LOGIN: "bot@example.test" };
const RELEASE = "[lisa-human-gate-release]";
const HUMAN = "human-1";
const HOLD = "human-needed";
const HELD = /current human hold is outstanding/;
const AUTOMATION = await automation();

/**
 * Inline ADF paragraph text, optionally marked as inline code.
 * @param text - The text.
 * @param code - Whether it carries the inline `code` mark.
 * @returns A one-paragraph ADF document.
 */
function paragraph(text: string, code = false) {
  const node = code
    ? { type: "text", text, marks: [{ type: "code" }] }
    : { type: "text", text };
  return {
    type: "doc",
    version: 1,
    content: [{ type: "paragraph", content: [node] }],
  };
}

describe("Jira human comments keep their code boundary for the hold classifier", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json(REGISTRY_METADATA)
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it("ignores a release marker inside a code block or inline code, and honours a plain release", async () => {
    const config = {
      ...JIRA_CONFIG,
      jira: { ...JIRA_CONFIG.jira, trustedHumanActorIds: [HUMAN] },
      automationProvenance: AUTOMATION,
    };
    await withPrivateRoot(async (root, env) => {
      const host = await committedHost(root, env, JIRA_MAINTAINER);
      const jira = fakeJira({ assignable: [JIRA_MAINTAINER] });
      const api = {
        ...codeHost(host.parent),
        tracker: createTracker(config, JIRA_ENV, jira.transport)!,
      };
      const allocate = () => allocateLeaf({ api, config, ...host });
      await allocate();
      jira.issues[0]!.fields.labels.push(HOLD);
      await expect(allocate()).rejects.toThrow(HELD);
      jira.comment(1, adfCodeBlock(`Example:\n${RELEASE}`), HUMAN);
      jira.comment(1, paragraph(RELEASE, true), HUMAN);
      await expect(allocate()).rejects.toThrow(HELD);
      jira.comment(1, paragraph(RELEASE), HUMAN);
      expect((await allocate()).workItem).toBe("PROJ-1");
    });
  });
});

/** Plain text, `{ code }` inline code, or `{ block }` for a code block. */
type Part = string | { code: string } | { block: string };

/**
 * An ADF document: each inner array is one paragraph, a `{ block }` entry is a
 * top-level code block.
 * @param blocks - Paragraph parts or code blocks, in order.
 * @returns The ADF document.
 */
function adf(blocks: readonly (readonly Part[] | { block: string })[]) {
  const inline = (part: Part) =>
    typeof part === "string"
      ? { type: "text", text: part }
      : {
          type: "text",
          text: "code" in part ? part.code : "",
          marks: [{ type: "code" }],
        };
  return {
    type: "doc",
    version: 1,
    content: blocks.map(block =>
      Array.isArray(block)
        ? { type: "paragraph", content: block.map(inline) }
        : {
            type: "codeBlock",
            content: [
              { type: "text", text: (block as { block: string }).block },
            ],
          }
    ),
  };
}

describe("Jira plain-text backticks cannot move the hold classifier's code boundary (#4873)", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json(REGISTRY_METADATA)
    );
  });
  afterEach(() => vi.restoreAllMocks());

  /**
   * Allocate a held Jira item, add one trusted comment, and allocate again.
   * @param document - The ADF comment a trusted human writes.
   * @returns The second allocation's outcome.
   */
  async function afterComment(document: object) {
    const config = {
      ...JIRA_CONFIG,
      jira: { ...JIRA_CONFIG.jira, trustedHumanActorIds: [HUMAN] },
      automationProvenance: AUTOMATION,
    };
    return withPrivateRoot(async (root, env) => {
      const host = await committedHost(root, env, JIRA_MAINTAINER);
      const jira = fakeJira({ assignable: [JIRA_MAINTAINER] });
      const api = {
        ...codeHost(host.parent),
        tracker: createTracker(config, JIRA_ENV, jira.transport)!,
      };
      const allocate = () => allocateLeaf({ api, config, ...host });
      await allocate();
      jira.issues[0]!.fields.labels.push(HOLD);
      jira.comment(1, document, HUMAN);
      return allocate().then(
        result => result.workItem,
        (error: Error) => error.message
      );
    });
  }

  it("keeps a code example a code example when a stray backtick precedes it", async () => {
    // Unneutralised, "`" + "`[marker]`" strips as "``" and the marker leads the line.
    expect(await afterComment(adf([["`", { code: RELEASE }]]))).toMatch(HELD);
  });

  it("still sees a real plain release when stray backticks sit before a code block", async () => {
    // Unneutralised, "``" + "`y`" opens a fence that runs to the code block and swallows the release.
    expect(
      await afterComment(
        adf([["``", { code: "y" }], [RELEASE], { block: "z" }])
      )
    ).toBe("PROJ-1");
  });
});

describe("a Jira hold with no trusted release list (#4873)", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json(REGISTRY_METADATA)
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it("keeps the hold despite a release comment and names the missing trust list", async () => {
    const config = { ...JIRA_CONFIG, automationProvenance: AUTOMATION };
    await withPrivateRoot(async (root, env) => {
      const host = await committedHost(root, env, JIRA_MAINTAINER);
      const jira = fakeJira({ assignable: [JIRA_MAINTAINER] });
      const api = {
        ...codeHost(host.parent),
        tracker: createTracker(config, JIRA_ENV, jira.transport)!,
      };
      const allocate = () => allocateLeaf({ api, config, ...host });
      await allocate();
      jira.issues[0]!.fields.labels.push(HOLD);
      jira.comment(1, paragraph(RELEASE), HUMAN);
      const failure = await allocate().then(
        () => undefined,
        (error: unknown) => publicFailure(error)
      );
      expect(failure).toContain("jira.trustedHumanActorIds is not set");
      expect(jira.issues[0]!.fields.labels).toContain(HOLD);
    });
  });
});

describe("Linear human comments keep their fence for the hold classifier", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json(REGISTRY_METADATA)
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it("ignores a release marker a human wrote inside a lisa fence, and honours a plain release", async () => {
    const config = {
      ...LINEAR_CONFIG,
      linear: { ...LINEAR_CONFIG.linear, trustedHumanActorIds: [HUMAN] },
      automationProvenance: AUTOMATION,
    };
    await withPrivateRoot(async (root, env) => {
      const host = await committedHost(root, env, LINEAR_MAINTAINER);
      const linear = fakeLinear({ members: [LINEAR_MAINTAINER] });
      const api = {
        ...codeHost(host.parent),
        tracker: createTracker(
          config,
          { LINEAR_API_KEY: "k" },
          linear.transport
        )!,
      };
      const allocate = () => allocateLeaf({ api, config, ...host });
      await allocate();
      linear.issues[0]!.labels.push(HOLD);
      linear.comment(1, fence(RELEASE), HUMAN);
      await expect(allocate()).rejects.toThrow(HELD);
      linear.comment(1, RELEASE, HUMAN);
      expect((await allocate()).workItem).toBe("ENG-1");
    });
  });
});
