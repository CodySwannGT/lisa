import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runDoctor } from "../../../src/cli/doctor.js";

/** Lisa project marker file written into doctor test fixtures. */
const LISA_CONFIG_FILE = ".lisa.config.json";

/** Doctor check name for the legacy Codex overlay detection. */
const CODEX_OVERLAY_CHECK = "Codex overlay current?";

let tempDir: string | undefined;

/**
 * Resolve the temporary directory for one doctor test case.
 * @returns Temporary directory path
 */
async function getTempDir(): Promise<string> {
  tempDir ??= await mkdtemp(path.join(os.tmpdir(), "lisa-doctor-"));
  return tempDir;
}

afterEach(async () => {
  vi.restoreAllMocks();
  if (tempDir) {
    await rm(tempDir, { force: true, recursive: true });
    tempDir = undefined;
  }
});

describe("runDoctor", () => {
  it("emits structured JSON and warns on stale Lisa versions", async () => {
    const cwd = await getTempDir();
    await writeFile(path.join(cwd, LISA_CONFIG_FILE), "{}\n");
    const write = vi.fn();

    const result = await runDoctor(
      cwd,
      { json: true },
      {
        fetchImpl: vi.fn<typeof fetch>().mockResolvedValue({
          ok: true,
          json: async () => ({ is_template: true }),
        } as Response),
        runUpdateCheck: vi.fn(async () => ({
          current: "2.63.2",
          latest: "2.64.0",
          isOutdated: true,
        })),
        write,
      }
    );

    expect(result.checks).toContainEqual(
      expect.objectContaining({
        name: "Lisa version current?",
        status: "warn",
      })
    );
    expect(() => JSON.parse(write.mock.calls[0][0])).not.toThrow();
  });

  it("sets a failing exit code when config JSON is malformed", async () => {
    const cwd = await getTempDir();
    await writeFile(path.join(cwd, LISA_CONFIG_FILE), "{");
    const setExitCode = vi.fn();

    await runDoctor(
      cwd,
      { offline: true },
      { runUpdateCheck: vi.fn(), setExitCode, write: vi.fn() }
    );

    expect(setExitCode).toHaveBeenCalledWith(1);
  });

  it("warns when the legacy pre-2.198 Codex overlay is still present", async () => {
    const cwd = await getTempDir();
    await writeFile(path.join(cwd, LISA_CONFIG_FILE), "{}\n");
    await mkdir(path.join(cwd, ".codex", "hooks", "lisa"), {
      recursive: true,
    });
    await mkdir(path.join(cwd, ".codex", "skills", "lisa"), {
      recursive: true,
    });

    const result = await runDoctor(
      cwd,
      { offline: true },
      { runUpdateCheck: vi.fn(), write: vi.fn() }
    );

    expect(result.checks).toContainEqual(
      expect.objectContaining({
        name: CODEX_OVERLAY_CHECK,
        status: "warn",
        detail: expect.stringContaining(".codex/hooks/lisa"),
      })
    );
  });

  it("passes the Codex overlay check when .codex has no legacy directories", async () => {
    const cwd = await getTempDir();
    await writeFile(path.join(cwd, LISA_CONFIG_FILE), "{}\n");
    await mkdir(path.join(cwd, ".codex", "agents"), { recursive: true });

    const result = await runDoctor(
      cwd,
      { offline: true },
      { runUpdateCheck: vi.fn(), write: vi.fn() }
    );

    expect(result.checks).toContainEqual(
      expect.objectContaining({
        name: CODEX_OVERLAY_CHECK,
        status: "ok",
        detail: "No legacy project-level Codex overlay present",
      })
    );
  });

  it("passes the Codex overlay check when .codex is absent", async () => {
    const cwd = await getTempDir();
    await writeFile(path.join(cwd, LISA_CONFIG_FILE), "{}\n");

    const result = await runDoctor(
      cwd,
      { offline: true },
      { runUpdateCheck: vi.fn(), write: vi.fn() }
    );

    expect(result.checks).toContainEqual(
      expect.objectContaining({
        name: CODEX_OVERLAY_CHECK,
        status: "ok",
        detail: "No .codex directory present",
      })
    );
  });

  it("repairs instruction files in a Lisa project (AGENTS.md canonical + CLAUDE.md pointer)", async () => {
    const cwd = await getTempDir();
    await writeFile(path.join(cwd, LISA_CONFIG_FILE), "{}\n");

    const result = await runDoctor(
      cwd,
      { offline: true },
      { runUpdateCheck: vi.fn(), write: vi.fn() }
    );

    expect(result.checks).toContainEqual(
      expect.objectContaining({
        name: "Instruction files canonical?",
        status: "ok",
      })
    );
    const claude = await readFile(path.join(cwd, "CLAUDE.md"), "utf8");
    expect(claude).toContain("@AGENTS.md");
    expect(await readFile(path.join(cwd, "AGENTS.md"), "utf8")).toContain(
      "AGENTS.md"
    );
  });

  it("strips a legacy agy baked-rules block from AGENTS.md during doctor", async () => {
    const cwd = await getTempDir();
    await writeFile(path.join(cwd, LISA_CONFIG_FILE), "{}\n");
    await writeFile(
      path.join(cwd, "AGENTS.md"),
      "# AGENTS.md\n\nHost note.\n\n<!-- LISA_RULES_START -->\n\nbaked\n\n<!-- LISA_RULES_END -->\n"
    );

    await runDoctor(
      cwd,
      { offline: true },
      { runUpdateCheck: vi.fn(), write: vi.fn() }
    );

    const agents = await readFile(path.join(cwd, "AGENTS.md"), "utf8");
    expect(agents).not.toContain("LISA_RULES_START");
    expect(agents).toContain("Host note.");
  });

  it("skips instruction-file repair in a non-Lisa directory", async () => {
    const cwd = await getTempDir();

    const result = await runDoctor(
      cwd,
      { offline: true },
      { runUpdateCheck: vi.fn(), write: vi.fn() }
    );

    const check = result.checks.find(
      c => c.name === "Instruction files canonical?"
    );
    expect(check?.detail).toContain("skipped");
    // No files were created in the bare directory.
    expect(
      await readFile(path.join(cwd, "AGENTS.md"), "utf8").catch(() => null)
    ).toBeNull();
  });

  it("warns when starter repositories are missing or not templates", async () => {
    const cwd = await getTempDir();
    const result = await runDoctor(
      cwd,
      {},
      {
        fetchImpl: vi.fn<typeof fetch>().mockResolvedValue({
          ok: true,
          json: async () => ({ is_template: false }),
        } as Response),
        runUpdateCheck: vi.fn(async () => ({
          current: "2.63.2",
          latest: "2.63.2",
          isOutdated: false,
        })),
        write: vi.fn(),
      }
    );

    expect(result.checks).toContainEqual(
      expect.objectContaining({
        name: "Starter health",
        status: "warn",
      })
    );
  });
});
