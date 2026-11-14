/**
 * CodySwannGT/lisa#4859 review fixes for the shared tracker wire: a response
 * is bounded by its declared length and by the bytes actually read (N5), and
 * the Jira site comes only from committed config, never from JIRA_SERVER (N2).
 */
import { describe, expect, it, vi } from "vitest";
import { jsonCall } from "../../../all/copy-overwrite/scripts/lib/npm-update-tracker-wire.mjs";
import { createTracker } from "../../../all/copy-overwrite/scripts/lib/npm-update-tracker.mjs";
import { publicFailure } from "../../../all/copy-overwrite/scripts/lib/npm-update-invariants.mjs";
import { JIRA_CONFIG } from "../../support/npm-update-tracker-host.js";

const BOUND = 3_145_728;
const URL_ = "https://api.linear.app/graphql";
const REQUEST = { authorization: "key" };

describe("bounded tracker responses", () => {
  it("returns a small JSON body", async () => {
    const transport = async () => Response.json({ ok: true });
    expect(await jsonCall(transport, URL_, REQUEST, "unclassified")).toEqual({
      ok: true,
    });
  });

  it("refuses a declared content-length over the bound before reading the body", async () => {
    const pull = vi.fn();
    const transport = async () =>
      // highWaterMark 0: the stream itself never pre-pulls, so any pull is a read.
      new Response(new ReadableStream({ pull }, { highWaterMark: 0 }), {
        headers: { "content-length": String(BOUND + 1) },
      });
    await expect(
      jsonCall(transport, URL_, REQUEST, "unclassified")
    ).rejects.toThrow(/exceeds bound/);
    expect(pull).not.toHaveBeenCalled();
  });

  it("stops reading an undeclared stream as soon as it passes the bound", async () => {
    const chunk = new Uint8Array(1_048_576);
    let pulled = 0;
    const cancel = vi.fn();
    const transport = async () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            pulled++;
            controller.enqueue(chunk);
          },
          cancel,
        })
      );
    await expect(
      jsonCall(transport, URL_, REQUEST, "unclassified")
    ).rejects.toThrow(/exceeds bound/);
    expect(pulled).toBeLessThanOrEqual(6);
    expect(cancel).toHaveBeenCalled();
  });
});

describe("Jira site source", () => {
  it("ignores JIRA_SERVER and names atlassian.site when config has no site or cloud id", () => {
    let failure: unknown;
    try {
      createTracker(
        { ...JIRA_CONFIG, atlassian: {} },
        {
          JIRA_API_TOKEN: "t",
          JIRA_LOGIN: "bot@example.test",
          JIRA_SERVER: "attacker.example",
        },
        vi.fn()
      );
    } catch (error) {
      failure = error;
    }
    expect(publicFailure(failure)).toContain("atlassian.site");
  });
});
