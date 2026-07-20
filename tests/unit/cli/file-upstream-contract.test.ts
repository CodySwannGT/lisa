/**
 * RED contract for the executable `lisa file-upstream` projection (#1826).
 * @module tests/unit/cli/file-upstream-contract
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

import { afterEach, describe, expect, it } from "vitest";

const FILE_UPSTREAM_MODULE = "../../../src/cli/file-upstream-cmd.js";
const SURFACE = "plugins/src/base/skills/lisa-persist-learning/SKILL.md";
const OWNED_TEXT =
  "Route ONE candidate learning through the judgment gate and act on the verdict.";
const temporaryDirectories: string[] = [];
const INPUT_READ_ERROR = "file-upstream: input could not be read";
const STDIN_MUST_NOT_BE_READ = "stdin must not be read";

/** Injectable command boundaries used by this contract. */
interface FileUpstreamDependencies {
  readonly error: (message: string) => void;
  readonly log: (message: string) => void;
  readonly readStdin: () => Promise<string>;
}

/** Public command runner signature. */
type RunFileUpstream = (
  options: { readonly input?: string },
  dependencies: FileUpstreamDependencies
) => Promise<number>;

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

const PUBLIC_COMMIT = "90549e6dae19aa5e53b86908d5050d303b724f55";

const validIssueEvent = (): Record<string, unknown> => ({
  documentKind: "issue",
  failureClass: "stale-artifact-overwrite",
  lisaOwnedExcerpts: [{ file: SURFACE, text: OWNED_TEXT }],
  lisaSurface: SURFACE,
  redactedPlaceholders: ["<host-project>"],
  upstreamCommitRefs: [PUBLIC_COMMIT],
});

describe("lisa file-upstream executable projection", () => {
  it("prints a valid projected body through the public command implementation", async () => {
    const imported = (await import(FILE_UPSTREAM_MODULE)) as {
      readonly runFileUpstream: RunFileUpstream;
    };
    const out: string[] = [];
    const errors: string[] = [];
    const payload = JSON.stringify(validIssueEvent());

    const code = await imported.runFileUpstream(
      {},
      {
        error: message => errors.push(message),
        log: message => out.push(message),
        readStdin: async () => payload,
      }
    );

    expect(code).toBe(0);
    expect(errors).toHaveLength(0);
    expect(out.join("\n")).toContain(
      `<!-- [lisa-upstream-attribution] key=${SURFACE.toLowerCase()}#stale-artifact-overwrite -->`
    );
    expect(out.join("\n")).toContain(OWNED_TEXT);
  });

  it("rejects a caller-supplied Lisa root instead of trusting host files", async () => {
    const imported = (await import(FILE_UPSTREAM_MODULE)) as {
      readonly runFileUpstream: RunFileUpstream;
    };
    const out: string[] = [];
    const errors: string[] = [];
    const payload = JSON.stringify({
      ...validIssueEvent(),
      lisaRoot: "/host-project",
    });

    const code = await imported.runFileUpstream(
      {},
      {
        error: message => errors.push(message),
        log: message => out.push(message),
        readStdin: async () => payload,
      }
    );

    expect(code).not.toBe(0);
    expect(out).toHaveLength(0);
    expect(errors.join("\n")).toContain("lisaRoot");
    expect(errors.join("\n")).not.toContain("/host-project");
  });

  it("reads JSON from --input without consulting stdin", async () => {
    const imported = (await import(FILE_UPSTREAM_MODULE)) as {
      readonly runFileUpstream: RunFileUpstream;
    };
    const root = mkdtempSync(
      path.join(process.cwd(), ".lisa-file-upstream-input-")
    );
    const input = path.join(root, "event.json");
    temporaryDirectories.push(root);
    writeFileSync(input, JSON.stringify(validIssueEvent()), "utf8");
    const out: string[] = [];

    const code = await imported.runFileUpstream(
      { input },
      {
        error: () => undefined,
        log: message => out.push(message),
        readStdin: async () => {
          throw new Error(STDIN_MUST_NOT_BE_READ);
        },
      }
    );

    expect(code).toBe(0);
    expect(out.join("\n")).toContain("## What failed for the operator");
  });

  it("returns one with empty stdout and sanitized stderr for malformed JSON", async () => {
    const imported = (await import(FILE_UPSTREAM_MODULE)) as {
      readonly runFileUpstream: RunFileUpstream;
    };
    const out: string[] = [];
    const errors: string[] = [];

    const code = await imported.runFileUpstream(
      {},
      {
        error: message => errors.push(message),
        log: message => out.push(message),
        readStdin: async () => "{private-host-payload",
      }
    );

    expect(code).toBe(1);
    expect(out).toHaveLength(0);
    expect(errors).toEqual(["file-upstream: input is not valid JSON"]);
  });

  it("rejects oversized injected stdin before parsing", async () => {
    const imported = (await import(FILE_UPSTREAM_MODULE)) as {
      readonly runFileUpstream: RunFileUpstream;
    };
    const out: string[] = [];
    const errors: string[] = [];

    const code = await imported.runFileUpstream(
      {},
      {
        error: message => errors.push(message),
        log: message => out.push(message),
        readStdin: async () => "x".repeat(64 * 1024 + 1),
      }
    );

    expect(code).toBe(1);
    expect(out).toHaveLength(0);
    expect(errors).toEqual([INPUT_READ_ERROR]);
  });

  it("rejects adversarial tiny-chunk streams before unbounded accumulation", async () => {
    const imported = (await import(FILE_UPSTREAM_MODULE)) as {
      readonly readBoundedInputStream: (
        stream: AsyncIterable<Buffer>
      ) => Promise<string>;
    };
    const chunks = Array.from({ length: 1025 }, () => Buffer.from("x"));

    await expect(
      imported.readBoundedInputStream(Readable.from(chunks))
    ).rejects.toThrow("input contains too many chunks");
  });

  it("rejects oversized and symlink --input files without echoing paths", async () => {
    const imported = (await import(FILE_UPSTREAM_MODULE)) as {
      readonly runFileUpstream: RunFileUpstream;
    };
    const root = mkdtempSync(
      path.join(process.cwd(), ".lisa-file-upstream-safety-")
    );
    temporaryDirectories.push(root);
    const oversized = path.join(root, "private-customer-oversized.json");
    const symlink = path.join(root, "private-customer-link.json");
    writeFileSync(oversized, Buffer.alloc(64 * 1024 + 1));
    symlinkSync(oversized, symlink);

    for (const input of [oversized, symlink]) {
      const out: string[] = [];
      const errors: string[] = [];
      const code = await imported.runFileUpstream(
        { input },
        {
          error: message => errors.push(message),
          log: message => out.push(message),
          readStdin: async () => {
            throw new Error(STDIN_MUST_NOT_BE_READ);
          },
        }
      );

      expect(code).toBe(1);
      expect(out).toHaveLength(0);
      expect(errors).toEqual([INPUT_READ_ERROR]);
      expect(errors.join("\n")).not.toContain("private-customer");
    }
  });

  it("rejects a FIFO --input without blocking", async () => {
    const imported = (await import(FILE_UPSTREAM_MODULE)) as {
      readonly runFileUpstream: RunFileUpstream;
    };
    const root = mkdtempSync(
      path.join(process.cwd(), ".lisa-file-upstream-fifo-")
    );
    temporaryDirectories.push(root);
    const input = path.join(root, "private-customer-pipe.json");
    execFileSync("/usr/bin/mkfifo", [input]);
    const out: string[] = [];
    const errors: string[] = [];

    const code = await imported.runFileUpstream(
      { input },
      {
        error: message => errors.push(message),
        log: message => out.push(message),
        readStdin: async () => {
          throw new Error(STDIN_MUST_NOT_BE_READ);
        },
      }
    );

    expect(code).toBe(1);
    expect(out).toHaveLength(0);
    expect(errors).toEqual([INPUT_READ_ERROR]);
    expect(errors.join("\n")).not.toContain("private-customer");
  });

  it.each([
    [
      "hostIssueLink",
      () => ({
        ...validIssueEvent(),
        hostIssueLink: [
          "https://github.com/acme/project/issues/1?",
          "to",
          "ken=1234567890123456",
        ].join(""),
      }),
    ],
    [
      "lisaOwnedExcerpts",
      () => ({
        ...validIssueEvent(),
        lisaOwnedExcerpts: [
          {
            file: SURFACE,
            text: ["gh", "p_123456789012345678901234567890"].join(""),
          },
        ],
      }),
    ],
  ] as const)(
    "attributes fragment-assembled canaries to %s with empty stdout",
    async (field, event) => {
      const imported = (await import(FILE_UPSTREAM_MODULE)) as {
        readonly runFileUpstream: RunFileUpstream;
      };
      const out: string[] = [];
      const errors: string[] = [];
      const code = await imported.runFileUpstream(
        {},
        {
          error: message => errors.push(message),
          log: message => out.push(message),
          readStdin: async () => JSON.stringify(event()),
        }
      );

      expect(code).toBe(1);
      expect(out).toHaveLength(0);
      expect(errors).toEqual([`file-upstream: rejected field ${field}`]);
      expect(errors.join("\n")).not.toContain("unknownField");
    }
  );
});
