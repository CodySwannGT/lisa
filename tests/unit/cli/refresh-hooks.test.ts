/** Scoped hook refresh must preserve dirty host files and unknown hook bytes. */
import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
  rm,
  symlink,
  chmod,
  rename,
  link,
} from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProgram } from "../../../src/cli/index.js";
import {
  fixture,
  cleanupFixtures,
  BOTH_GUARDS,
  DIRTY_TEXT,
  PARITY,
  HOOK_DIRECTORY,
  COPY_DIRECTORY,
  DEDUPE,
  DEDUPE_NAME,
  OLD_PARITY,
  OLD_DEDUPE,
  CONFIG_TEXT,
  hookNames,
} from "./refresh-hooks-fixture.js";

const observation = vi.hoisted(() => {
  const state: {
    before?: (filename: string) => Promise<void>;
    after?: (filename: string) => Promise<void>;
    checked?: (filename: string) => Promise<void>;
    handles: { readonly fd: number }[];
  } = { handles: [] };
  return state;
});

// Native operations and results remain genuine; callbacks only interleave
// owned filesystem mutations at the actual operation boundary.
vi.mock("node:fs/promises", async importOriginal => {
  const native = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...native,
    copyFile: async (...args: Parameters<typeof native.copyFile>) => {
      await observation.before?.(String(args[1]));
      const result = await native.copyFile(...args);
      await observation.after?.(String(args[1]));
      return result;
    },
    lstat: async (...args: Parameters<typeof native.lstat>) => {
      const result = await native.lstat(...args);
      await observation.checked?.(String(args[0]));
      return result;
    },
    open: async (...args: Parameters<typeof native.open>) => {
      const handle = await native.open(...args);
      const nativeWrite = handle.write;
      observation.handles.push(handle);
      vi.spyOn(handle, "write").mockImplementation(async (...writeArgs) => {
        await observation.before?.(String(args[0]));
        const result = await Reflect.apply(nativeWrite, handle, writeArgs);
        await observation.after?.(String(args[0]));
        return result;
      });
      return handle;
    },
  };
});

afterEach(async () => {
  delete observation.before;
  delete observation.after;
  delete observation.checked;
  observation.handles.length = 0;
  vi.restoreAllMocks();
  await cleanupFixtures();
});

describe("supported scoped hook refresh", () => {
  it("registers a separate command instead of routing through full apply", async () => {
    const calls: string[][] = [];
    const program = createProgram({
      refreshHooks: async (destination, _dependencies, selection) => {
        calls.push([destination, selection ?? ""]);
      },
      runUpdateCheck: async () => ({
        current: "0",
        latest: null,
        isOutdated: false,
        reason: "skipped",
      }),
      printUpdateWarning: () => undefined,
    }).exitOverride();
    expect(program.commands.map(command => command.name())).toContain(
      "refresh-hooks"
    );
    await program.parseAsync(
      ["refresh-hooks", "/literal-host", "--guards", BOTH_GUARDS],
      { from: "user" }
    );
    expect(calls).toEqual([["/literal-host", BOTH_GUARDS]]);
  });

  it("updates only the guard and companions and repeats without drift", async () => {
    const { refreshHooks } =
      await import("../../../src/cli/refresh-hooks-cmd.js");
    const input = await fixture();
    await refreshHooks(input.host, input, BOTH_GUARDS);
    await refreshHooks(input.host, input, BOTH_GUARDS);
    for (const name of hookNames)
      expect(
        await readFile(path.join(input.host, HOOK_DIRECTORY, name), "utf8")
      ).toBe(`# current ${name}\n`);
    expect(await readFile(path.join(input.host, "dirty.txt"), "utf8")).toBe(
      DIRTY_TEXT
    );
    expect(
      await readFile(path.join(input.host, ".lisa.config.json"), "utf8")
    ).toBe(CONFIG_TEXT);
  });

  it("rejects unknown, ambiguous and duplicate cohort selections", async () => {
    const { hookCohort } =
      await import("../../../src/cli/refresh-hooks-cmd.js");
    for (const value of [
      "",
      "all",
      "../parity-safety-net",
      "parity-safety-net,parity-safety-net",
      "parity-safety-net, block-no-verify",
    ]) {
      expect(() => hookCohort(value)).toThrow("closed guards");
    }
    expect(hookCohort("block-no-verify")).toEqual([
      "block-no-verify.sh",
      DEDUPE_NAME,
    ]);
  });

  it("refuses unknown host content before refreshing any companion", async () => {
    const { refreshHooks } =
      await import("../../../src/cli/refresh-hooks-cmd.js");
    const input = await fixture();
    await writeFile(path.join(input.host, DEDUPE), "host custom authority\n");
    await expect(refreshHooks(input.host, input)).rejects.toThrow("preserved");
    expect(await readFile(path.join(input.host, PARITY), "utf8")).toBe(
      OLD_PARITY
    );
  });

  it("refuses symlink companions and unstamped packages before writes", async () => {
    const { refreshHooks } =
      await import("../../../src/cli/refresh-hooks-cmd.js");
    const input = await fixture();
    const target = path.join(input.host, DEDUPE);
    await rm(target);
    await symlink(path.join(input.host, "dirty.txt"), target);
    await expect(refreshHooks(input.host, input)).rejects.toThrow("regular");
    await writeFile(
      path.join(input.packageDir, "package.json"),
      '{"name":"@codyswann/lisa","version":"4.71.2"}'
    );
    await expect(refreshHooks(input.host, input)).rejects.toThrow("released");
    expect(await readFile(path.join(input.host, "dirty.txt"), "utf8")).toBe(
      DIRTY_TEXT
    );
  });
  it("refuses an unwritable companion before any descriptor write", async () => {
    const { refreshHooks } =
      await import("../../../src/cli/refresh-hooks-cmd.js");
    const input = await fixture();
    await chmod(
      path.join(input.host, "scripts/lisa-hooks/parity-safety-net-heredoc.py"),
      0o444
    );
    await expect(refreshHooks(input.host, input)).rejects.toThrow();
    expect(await readFile(path.join(input.host, DEDUPE), "utf8")).toBe(
      OLD_DEDUPE
    );
    expect(await readFile(path.join(input.host, "dirty.txt"), "utf8")).toBe(
      DIRTY_TEXT
    );
  });

  it("preserves host-ahead capabilities even when their bytes are recorded", async () => {
    const { refreshHooks } =
      await import("../../../src/cli/refresh-hooks-cmd.js");
    const input = await fixture();
    const bytes = Buffer.from(
      "# lisa-guard-capabilities: host-only-protection\n"
    );
    input.ledger[PARITY] = [
      ...(input.ledger[PARITY] ?? []),
      createHash("sha256").update(bytes).digest("hex"),
    ];
    await writeFile(path.join(input.host, PARITY), bytes);
    await expect(refreshHooks(input.host, input)).rejects.toThrow("host-ahead");
    expect(await readFile(path.join(input.host, PARITY))).toEqual(bytes);
  });

  it("refuses unrecorded package bytes before any host write", async () => {
    const { refreshHooks } =
      await import("../../../src/cli/refresh-hooks-cmd.js");
    const input = await fixture();
    await writeFile(
      path.join(input.packageDir, COPY_DIRECTORY, PARITY),
      "unrecorded package hook\n"
    );
    await expect(refreshHooks(input.host, input)).rejects.toThrow(
      "not recorded shipping source"
    );
    expect(await readFile(path.join(input.host, PARITY), "utf8")).toBe(
      OLD_PARITY
    );
  });

  it("refuses a native hardlinked host hook and closes preflight handles", async () => {
    const { refreshHooks } =
      await import("../../../src/cli/refresh-hooks-cmd.js");
    const input = await fixture();
    const target = path.join(input.host, PARITY);
    const foreign = path.join(path.dirname(input.host), "foreign-hook");
    await link(target, foreign);
    await expect(refreshHooks(input.host, input)).rejects.toThrow(
      "single-link"
    );
    expect(await readFile(foreign, "utf8")).toBe(OLD_PARITY);
    expect(observation.handles.length).toBeGreaterThan(0);
    expect(observation.handles.every(handle => handle.fd === -1)).toBe(true);
  });

  it.each(["leaf", "ancestor", "source", "mode", "custom"])(
    "confines real %s replacement and rollback to original owned files",
    async kind => {
      const { refreshHooks } =
        await import("../../../src/cli/refresh-hooks-cmd.js");
      const input = await fixture();
      const hooks = path.join(input.host, HOOK_DIRECTORY);
      const foreign = path.join(path.dirname(input.host), "foreign");
      const saved = `${hooks}-original`;
      const target = path.join(input.host, PARITY);
      const source = path.join(input.packageDir, COPY_DIRECTORY, PARITY);
      let fired = false;
      let foreignWritten = false;
      await mkdir(foreign);
      for (const name of hookNames)
        await writeFile(path.join(foreign, name), `# old ${name}\n`);
      if (kind === "source")
        await writeFile(
          path.join(foreign, "source"),
          "# current parity-safety-net.sh\n"
        );
      observation.before = async filename => {
        if (kind !== "leaf" || filename !== target || fired) return;
        fired = true;
        await rm(target);
        await symlink(path.join(foreign, "parity-safety-net.sh"), target);
      };
      observation.checked = async filename => {
        if (kind !== "source" || filename !== source || fired) return;
        fired = true;
        await rm(source);
        await symlink(path.join(foreign, "source"), source);
      };
      observation.after = async filename => {
        if (
          (await readFile(
            path.join(foreign, "parity-safety-net.sh"),
            "utf8"
          )) !== OLD_PARITY
        )
          foreignWritten = true;
        if (filename !== path.join(hooks, DEDUPE_NAME) || fired) return;
        if (kind === "ancestor") {
          fired = true;
          await rename(hooks, saved);
          await symlink(foreign, hooks);
        } else if (kind === "mode") {
          fired = true;
          await chmod(path.join(hooks, "parity-safety-net-heredoc.py"), 0o444);
        } else if (kind === "custom") {
          fired = true;
          await writeFile(filename, "concurrent custom work\n");
        }
      };
      await expect(refreshHooks(input.host, input)).rejects.toThrow();
      expect(fired).toBe(true);
      expect(foreignWritten).toBe(false);
      expect(await readFile(path.join(input.host, "dirty.txt"), "utf8")).toBe(
        DIRTY_TEXT
      );
      if (kind === "ancestor" || kind === "mode")
        expect(
          await readFile(
            path.join(kind === "ancestor" ? saved : hooks, DEDUPE_NAME),
            "utf8"
          )
        ).toBe(OLD_DEDUPE);
      if (kind === "custom")
        expect(await readFile(path.join(hooks, DEDUPE_NAME), "utf8")).toBe(
          "concurrent custom work\n"
        );
      expect(observation.handles.every(handle => handle.fd === -1)).toBe(true);
    }
  );
});
