import { mkdir, readFile, rm, stat, symlink } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { StarterTemplate } from "../../../src/core/project-config-starter.js";
import {
  root,
  starter,
  project,
  baseline,
  head,
  CONFIG,
  OWNED,
  SECOND,
  PROJECT_OWNED,
  IGNORE,
  BEGIN,
  END,
  OLD,
  NEW,
  git,
  put,
  config,
  sync,
  extendHistory,
} from "./support/starter-sync-fixture.js";

describe("starter synchronization against disposable Git history", () => {
  it.each(["update", "remove"])(
    "preserves a marker mention outside the managed block during %s",
    async operation => {
      const prefix = `# Documentation mentions ${BEGIN}\noperator-must-survive/\n`;
      await put(
        project,
        IGNORE,
        `${prefix}${BEGIN}\nold-cache/\n${END}\nproject suffix\n`
      );
      if (operation === "remove") {
        await put(starter, IGNORE, "starter outside only\n");
        git("add", ".");
        git("commit", "--quiet", "-m", "Remove documented block");
      }
      expect((await sync())[0]?.state).toBe("updated");
      const middle =
        operation === "remove" ? "" : `${BEGIN}\nnew-cache/\n${END}`;
      expect(await readFile(path.join(project, IGNORE), "utf8")).toBe(
        `${prefix}${middle}\nproject suffix\n`
      );
    }
  );

  it("keeps the effective overwrite when Expo also ships a create-only copy", async () => {
    await put(project, "app.json", "{}");
    await extendHistory(
      "tsconfig.json",
      '{"fixture":"old"}\n',
      '{"fixture":"new"}\n'
    );
    expect((await sync())[0]?.state).toBe("updated");
    expect(await readFile(path.join(project, "tsconfig.json"), "utf8")).toBe(
      '{"fixture":"new"}\n'
    );
  });

  it("uses the existing whole-file fallback for Rails markerless copy-contents", async () => {
    await put(project, "bin/rails", "fixture\n");
    const script = "scripts/lisa-mutation.sh";
    await extendHistory(script, OLD, NEW);
    expect((await sync())[0]?.state).toBe("updated");
    expect(await readFile(path.join(project, script), "utf8")).toBe(NEW);
  });

  it("updates governed files and managed blocks, preserving project-owned content and a no-op rerun", async () => {
    expect((await sync())[0]?.state).toBe("updated");
    expect(await readFile(path.join(project, OWNED), "utf8")).toBe(NEW);
    expect(await readFile(path.join(project, PROJECT_OWNED), "utf8")).toBe(
      "project workflow\n"
    );
    expect(await readFile(path.join(project, IGNORE), "utf8")).toBe(
      `project prefix\n${BEGIN}\nnew-cache/\n${END}\nproject suffix\n`
    );
    const actual = await config();
    expect(actual.starter.templates[0].lastSync.sha).toBe(head);
    expect(actual.extension).toBe("retain me");
    expect(actual.starter.sync.strategy).toBe("pull-request");
    const before = await readFile(path.join(project, CONFIG));
    expect((await sync())[0]?.state).toBe("current");
    expect(await readFile(path.join(project, CONFIG))).toEqual(before);
  });

  it("keeps a failed baseline retryable while another scoped template advances", async () => {
    const initial = await config();
    await put(
      project,
      CONFIG,
      JSON.stringify({
        ...initial,
        starter: {
          ...initial.starter,
          templates: [
            { ...initial.starter.templates[0], paths: [OWNED] },
            {
              ...initial.starter.templates[0],
              repo: "example/second",
              paths: [SECOND],
            },
          ],
        },
      })
    );
    await rm(path.join(project, OWNED));
    await mkdir(path.join(project, OWNED));
    const first = await sync();
    expect(first.map(result => result.state)).toEqual(["failed", "updated"]);
    expect(
      (await config()).starter.templates.map(
        (entry: StarterTemplate) => entry.lastSync.sha
      )
    ).toEqual([baseline, head]);
    expect(await readFile(path.join(project, SECOND), "utf8")).toBe(NEW);
    await rm(path.join(project, OWNED), { recursive: true });
    await put(project, OWNED, OLD);
    expect((await sync()).map(result => result.state)).toEqual([
      "updated",
      "current",
    ]);
    expect(await readFile(path.join(project, IGNORE), "utf8")).toContain(
      "old-cache/"
    );
  });

  it("preserves a modified governed file and its baseline as a conflict", async () => {
    await put(project, OWNED, "local changes\n");
    const failed = (await sync())[0];
    expect(failed?.state).toBe("failed");
    expect(failed?.changed).toContain(IGNORE);
    expect(await readFile(path.join(project, OWNED), "utf8")).toBe(
      "local changes\n"
    );
    expect((await config()).starter.templates[0].lastSync.sha).toBe(baseline);
    await put(project, OWNED, OLD);
    const retried = (await sync())[0];
    expect(retried?.state).toBe("updated");
    expect(retried?.changed).not.toContain(IGNORE);
    expect((await config()).starter.templates[0].lastSync.sha).toBe(head);
  });

  it("does not follow a destination symlink outside the consumer", async () => {
    const outside = path.join(root, "outside");
    await mkdir(outside);
    await put(outside, "lib/invoked-as-script.mjs", OLD);
    await rm(path.join(project, "scripts"), { recursive: true });
    await symlink(outside, path.join(project, "scripts"), "dir");
    expect((await sync())[0]?.state).toBe("failed");
    expect(
      await readFile(path.join(outside, "lib/invoked-as-script.mjs"), "utf8")
    ).toBe(OLD);
    expect((await config()).starter.templates[0].lastSync.sha).toBe(baseline);
  });

  it("refuses an incomplete managed block without rewriting the file", async () => {
    const damaged = `project prefix\n${BEGIN}\nlocal-cache/\n`;
    await put(project, IGNORE, damaged);
    expect((await sync())[0]?.state).toBe("failed");
    expect(await readFile(path.join(project, IGNORE), "utf8")).toBe(damaged);
    expect((await config()).starter.templates[0].lastSync.sha).toBe(baseline);
  });

  it("applies owned additions, deletions and executable modes from real Git metadata", async () => {
    const added = "scripts/lib/worktree-dependencies.mjs";
    await rm(path.join(starter, OWNED));
    await put(starter, added, NEW);
    git("add", ".");
    git("update-index", "--chmod=+x", added);
    git("commit", "--quiet", "-m", "Replace owned script");
    expect((await sync())[0]?.state).toBe("updated");
    await expect(readFile(path.join(project, OWNED))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await readFile(path.join(project, added), "utf8")).toBe(NEW);
    expect((await stat(path.join(project, added))).mode & 0o111).toBe(0o111);
    expect((await config()).starter.templates[0].lastSync.sha).toBe(
      git("rev-parse", "HEAD")
    );
  });

  it("removes a retired managed block while preserving the consumer's outside content", async () => {
    await put(starter, IGNORE, "starter outside only\n");
    git("add", ".");
    git("commit", "--quiet", "-m", "Retire managed ignore block");
    expect((await sync())[0]?.state).toBe("updated");
    expect(await readFile(path.join(project, IGNORE), "utf8")).toBe(
      "project prefix\n\nproject suffix\n"
    );
  });

  it("refuses to replace an owned regular file with a starter symlink", async () => {
    await rm(path.join(starter, OWNED));
    await symlink("../../outside", path.join(starter, OWNED));
    git("add", ".");
    git("commit", "--quiet", "-m", "Unsupported source link");
    expect((await sync())[0]?.state).toBe("failed");
    expect(await readFile(path.join(project, OWNED), "utf8")).toBe(OLD);
    expect((await config()).starter.templates[0].lastSync.sha).toBe(baseline);
  });

  it("reuses JSON merge precedence and array union while retaining consumer-only keys", async () => {
    const settings = ".claude/settings.json";
    await put(
      starter,
      settings,
      JSON.stringify({ policy: "old", list: ["starter"] })
    );
    git("add", ".");
    git("commit", "--quiet", "-m", "JSON baseline");
    const initial = await config();
    initial.starter.templates[0].lastSync.sha = git("rev-parse", "HEAD");
    await put(project, CONFIG, JSON.stringify(initial));
    await put(
      project,
      settings,
      JSON.stringify({ policy: "local", local: true, list: ["consumer"] })
    );
    await put(
      starter,
      settings,
      JSON.stringify({ policy: "new", list: ["starter", "added"] })
    );
    git("add", ".");
    git("commit", "--quiet", "-m", "JSON update");
    expect((await sync())[0]?.state).toBe("updated");
    expect(
      JSON.parse(await readFile(path.join(project, settings), "utf8"))
    ).toEqual({
      policy: "new",
      local: true,
      list: ["consumer", "starter", "added"],
    });
  });
});
