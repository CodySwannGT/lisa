/**
 * The session-start auto-update tells the DEVELOPER when it could not keep
 * Lisa current, not only the agent (CodySwannGT/lisa#4903).
 *
 * Hook context reaches the agent and never the person, so an update skipped
 * for uncommitted changes, or left uncommitted by an earlier session, used to
 * leave a project on an old Lisa with nobody told. Each such outcome now
 * carries a notice for the developer, shown as the hook's `systemMessage`,
 * and context asking the agent to raise it and offer to finish the update.
 * @module tests/unit/hooks/auto-update-attention
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { envelope } from "../../../plugins/src/base/hooks/auto-update.mjs";
import {
  LISA,
  NEW,
  OLD,
  project,
  seedPendingMarker,
  sessionStart,
} from "../../helpers/auto-update-fixture.js";
import { linkForeignNodeModules } from "../../support/borrowed-node-modules.mjs";

/** A release newer than the one a pending update holds. */
const NEWER = "4.70.0";

describe("auto-update: telling the developer", () => {
  it("names both versions and the way out when uncommitted changes block it", async () => {
    const { text, notice } = await sessionStart(project({}), {
      dirtyBefore: " M src/a.ts",
    });
    expect(notice).toContain(OLD);
    expect(notice).toContain(NEW);
    expect(notice).toMatch(/uncommitted changes/u);
    expect(notice).toMatch(/commit or stash/iu);
    // The agent is asked to raise it and is handed the command to finish it.
    expect(text).toMatch(/first reply/u);
    expect(text).toMatch(/auto-update\.mjs" --project-dir/u);
  });

  it("surfaces a pending uncommitted update, and a newer release since", async () => {
    const root = project({});
    seedPendingMarker(root);
    const { notice } = await sessionStart(root, {
      dirtyBefore: " M package.json",
      latest: NEWER,
    });
    expect(notice).toContain(`Lisa update to ${NEW}`);
    expect(notice).toMatch(/not committed/u);
    expect(notice).toContain(NEWER);
  });

  it("surfaces an update applied on a deploy branch that could not be committed", async () => {
    const root = project({ config: { tracker: "github" } });
    const { notice } = await sessionStart(root, { branch: "main" });
    expect(notice).toContain(`from ${OLD} to ${NEW}`);
    expect(notice).toMatch(/not committed/u);
  });

  it("stays quiet after a successful update to whatever npm reports", async () => {
    const { notice } = await sessionStart(project({}), { latest: NEWER });
    expect(notice).toBeNull();
  });

  it("surfaces a failed update", async () => {
    const { notice } = await sessionStart(project({}), { bumpWorks: false });
    expect(notice).toMatch(/could not update/u);
    expect(notice).toContain(NEW);
  });

  it("surfaces a node_modules link only when Lisa is behind", async () => {
    const linked = (installed: string) => {
      const other = project({ installed });
      const root = mkdtempSync(path.join(tmpdir(), "lisa-auto-update-link-"));
      mkdirSync(path.join(root, ".git"));
      writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "host", devDependencies: { [LISA]: installed } })
      );
      linkForeignNodeModules(path.join(other, "node_modules"), root);
      return root;
    };
    const behind = await sessionStart(linked(OLD));
    expect(behind.notice).toMatch(/another checkout/u);
    const current = await sessionStart(linked(NEW));
    expect(current.text).toBe("");
    expect(current.notice).toBeNull();
  });

  it("stays quiet when Lisa is current, and when the update committed", async () => {
    const current = await sessionStart(project({ installed: NEW }));
    expect(current.notice).toBeNull();
    const committed = await sessionStart(project({}));
    expect(committed.text).toContain(`Updated Lisa from ${OLD} to ${NEW}`);
    expect(committed.notice).toBeNull();
  });
});

describe("auto-update: the hook envelope", () => {
  it("puts a notice in systemMessage, where the developer sees it", () => {
    const out = JSON.parse(envelope("context", "SessionStart", "notice"));
    expect(out.systemMessage).toBe("⚠️ notice");
    expect(out.hookSpecificOutput.additionalContext).toContain("context");
  });

  it("leaves systemMessage out when there is no notice", () => {
    const out = JSON.parse(envelope("context", "SessionStart"));
    expect(out).not.toHaveProperty("systemMessage");
  });
});
