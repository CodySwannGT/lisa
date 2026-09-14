import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  addStarterCommand,
  runStarterAdopt,
} from "../../../src/cli/starter-cmd.js";

const CONFIG = ".lisa.config.json";
const REPO = "fixture/starter";
const SHA = "a".repeat(40);
let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "lisa-starter-adopt-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("starter adoption", () => {
  it("adds a baseline to an existing project and preserves its settings", async () => {
    await writeFile(
      join(root, CONFIG),
      JSON.stringify({ marker: true, starter: { sync: { auto: false } } })
    );
    const capture = vi.fn(async () => `${SHA}\t${"b".repeat(40)}`);
    await runStarterAdopt(REPO, { path: root, ref: "release/v1" }, capture);
    const config = JSON.parse(await readFile(join(root, CONFIG), "utf8"));
    expect(config.marker).toBe(true);
    expect(config.starter.sync.auto).toBe(false);
    expect(config.starter.templates[0]).toMatchObject({
      repo: REPO,
      ref: "release/v1",
      lastSync: { sha: SHA },
    });
    expect(capture.mock.calls[0]).toContain("gh");
  });

  it("leaves an existing repo baseline byte-identical without needing remote access", async () => {
    const original = JSON.stringify({
      starter: {
        templates: [
          {
            repo: REPO,
            ref: "main",
            lastSync: { sha: SHA, at: "2026-09-14T00:00:00Z" },
          },
        ],
      },
    });
    await writeFile(join(root, CONFIG), original);
    const capture = vi.fn(async () => {
      throw new Error("offline");
    });
    await runStarterAdopt(REPO.toUpperCase(), { path: root }, capture);
    expect(capture).not.toHaveBeenCalled();
    expect(await readFile(join(root, CONFIG), "utf8")).toBe(original);
  });

  it("does not rewrite malformed config or accept arbitrary repository endpoints", async () => {
    const capture = vi.fn(async () => `${SHA}\t${"b".repeat(40)}`);
    await expect(
      runStarterAdopt("https://example.invalid/repo", { path: root }, capture)
    ).rejects.toThrow("owner/repository");
    await writeFile(join(root, CONFIG), "{broken");
    await expect(
      runStarterAdopt(REPO, { path: root }, capture)
    ).rejects.toThrow();
    expect(capture).not.toHaveBeenCalled();
    expect(await readFile(join(root, CONFIG), "utf8")).toBe("{broken");
  });

  it("wires the public command's repository, path and ref", async () => {
    const run = vi.fn(async () => undefined);
    const program = new Command();
    addStarterCommand(program, run);
    await program.parseAsync([
      "node",
      "lisa",
      "starter",
      "adopt",
      REPO,
      "--path",
      root,
      "--ref",
      "main",
    ]);
    expect(run).toHaveBeenCalledWith(REPO, { path: root, ref: "main" });
  });
});
