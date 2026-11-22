/**
 * An `integration:` trusted-author entry names no person, so it never counts
 * as someone who may answer on the item (CodySwannGT/lisa#4895). Counting it
 * would tell the operator to reply on the item when no reply can be read.
 * @module tests/unit/session-manager/cli-integration-answerers
 */
import { afterEach, describe, expect, it } from "vitest";

import { removeSandboxes } from "./support/cli-harness.js";
import {
  askMarked,
  BLOCK,
  githubSandbox,
  MARKER,
  OPERATOR,
  QUESTION_COMMENT_ID,
  REF,
  runStubOnly,
} from "./support/human-sandbox.js";

afterEach(removeSandboxes);

describe("item-answer with integration-only trust", () => {
  it("reports no answerers instead of waiting on a reply nobody may give", () => {
    const { operatorIds: _o, trustedAuthorIds: _t, ...bare } = BLOCK;
    const sandbox = githubSandbox({
      ...bare,
      trustedAuthorIds: ["integration:sentry"],
    });
    askMarked(sandbox);
    const result = runStubOnly(sandbox, ["item-answer", REF], {
      input: JSON.stringify({
        comments: [
          {
            id: QUESTION_COMMENT_ID,
            author: { login: OPERATOR },
            body: `${MARKER} ${REF} needs a human`,
          },
          { author: { login: "sentry" }, body: "CSV" },
        ],
      }),
    });
    expect(result.status).toBe(0);
    expect(result.json).toMatchObject({
      queued: false,
      reason: "no-answerers-configured",
    });
  });
});
