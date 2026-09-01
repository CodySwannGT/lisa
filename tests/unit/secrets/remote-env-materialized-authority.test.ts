/**
 * Fail-closed RED cases for the materialized environment artifact authority.
 *
 * Every row reaches the real SessionStart asset. The project hook is the sink:
 * an unusable artifact must stop before that boundary with a short redacted
 * diagnostic, and shell-shaped artifact bytes must never execute.
 * @module tests/unit/secrets/remote-env-materialized-authority
 */
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  artifactIdentity,
  createMaterializedFixture,
  type MaterializedFixtureOptions,
  readFixtureFile,
  runMaterializedSession,
} from "../../helpers/remote-env-materialized-fixture.js";

const ENVFILE_MODULE = path.resolve(
  "plugins/src/base/skills/lisa-secrets-access/scripts/envfile.mjs"
);
const AUTHORITY_LAYOUTS = [
  {
    label: "plugin-sibling",
    path: path.resolve(
      "plugins/src/base/skills/lisa-setup-remote-env/assets/" +
        "materialized-env-authority.mjs"
    ),
  },
  {
    label: "fresh-installed",
    path: path.resolve(
      "scripts/lisa-remote-env/materialized-env-authority.mjs"
    ),
  },
] as const;
/** Immutable lstat facts admitted by the standalone authority decision. */
interface AuthorityFacts {
  readonly directoryMode: number;
  readonly directoryType: "directory";
  readonly directoryUid: number;
  readonly expectedUid: number;
  readonly fileMode: number;
  readonly fileType: "file";
  readonly fileUid: number;
  readonly ownership: Readonly<{
    readonly directoryUid: number;
    readonly expectedUid: number;
    readonly fileUid: number;
  }>;
}

/** Pure verdict returned before the CLI reads any artifact bytes. */
interface AuthorityDecision {
  readonly accepted: boolean;
  readonly reason?: string;
}
/** Runtime contract shared by the plugin asset and its installed copy. */
interface AuthorityLayoutModule {
  readonly createMaterializedEnvAuthority: (
    ownersMatch: (facts: AuthorityFacts["ownership"]) => boolean
  ) => (facts: AuthorityFacts) => AuthorityDecision;
  readonly validateMaterializedEnvAuthority: (
    facts: AuthorityFacts
  ) => AuthorityDecision;
}

/** Self-contained owner decision exported by both authority layouts. */
const OWNER_EXPORT = new RegExp(
  "export\\s+(?:function\\s+materializedOwnersMatch\\b|" +
    "const\\s+materializedOwnersMatch\\s*=)",
  "u"
);
/** Reverse binding that keeps envfile consumers on the canonical decision. */
const ENVFILE_REEXPORT = new RegExp(
  "export\\s*\\{\\s*materializedOwnersMatch\\s*\\}\\s*" +
    "from\\s*[\"'][^\"']*materialized-env-authority\\.mjs[\"']",
  "u"
);
const DEFAULT_AUTHORITY = new RegExp(
  "export\\s+const\\s+validateMaterializedEnvAuthority\\s*=\\s*" +
    "createMaterializedEnvAuthority\\(\\s*materializedOwnersMatch\\s*\\);",
  "u"
);

/**
 * Build deeply immutable lstat facts for the production authority decision.
 * @param fixture - Isolated materialized-environment filesystem.
 * @param fileUid - Optional adversarial file owner.
 * @returns Frozen directory, file, and owner-predicate facts.
 */
function authorityFacts(
  fixture: ReturnType<typeof createMaterializedFixture>,
  fileUid?: number
): AuthorityFacts {
  const identity = artifactIdentity(fixture);
  const expectedUid = process.getuid?.() ?? identity.fileUid;
  const ownership = Object.freeze({
    directoryUid: identity.directoryUid,
    expectedUid,
    fileUid: fileUid ?? identity.fileUid,
  });
  return Object.freeze({
    directoryMode: identity.directoryMode,
    directoryType: "directory" as const,
    directoryUid: identity.directoryUid,
    expectedUid,
    fileMode: identity.fileMode,
    fileType: "file" as const,
    fileUid: fileUid ?? identity.fileUid,
    ownership,
  });
}

/**
 * Import one real authority module without creating a production test seam.
 * @param file - Canonical or freshly installed module path.
 * @returns The production pure-decision exports.
 */
async function authorityLayout(file: string): Promise<AuthorityLayoutModule> {
  return import(pathToFileURL(file).href) as Promise<AuthorityLayoutModule>;
}

/** Label, fixture options, and expected bounded refusal reason. */
type RefusalCase = readonly [
  label: string,
  options: MaterializedFixtureOptions,
  reason: RegExp,
];

const cases = [
  ["missing", { artifact: "missing" }, /missing/i],
  [
    "unreadable mode",
    { artifact: "unreadable" },
    /unreadable|mode|permission/i,
  ],
  ["file mode", { artifact: "file-mode" }, /mode|permission/i],
  [
    "directory mode",
    { artifact: "directory-mode" },
    /directory.*mode|permission/i,
  ],
  ["file symlink", { artifact: "file-symlink" }, /symlink|identity/i],
  ["directory symlink", { artifact: "directory-symlink" }, /symlink|identity/i],
  ["non-regular file", { artifact: "not-regular" }, /regular file|file type/i],
  [
    "invalid command",
    { artifact: "invalid-command" },
    /invalid|format|syntax/i,
  ],
  ["truncated value", { artifact: "truncated" }, /invalid|format|syntax/i],
  [
    "traversal namespace",
    { namespace: "../escaped-namespace" },
    /namespace|traversal|unsafe/i,
  ],
] satisfies readonly RefusalCase[];

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("remote SessionStart materialized artifact authority", () => {
  it.each(cases)(
    "refuses $0 before the project hook and preserves redaction",
    (_label, options, reason) => {
      const fixture = createMaterializedFixture(options);
      roots.push(fixture.root);
      const profileBefore = readFileSync(`${fixture.home}/.profile`, "utf8");

      if (options.artifact === "invalid-command") {
        expect(readFileSync(fixture.valuesFile, "utf8")).toContain(
          "SHOULD_NOT_RUN"
        );
      }
      if (options.artifact === "unreadable") {
        expect(artifactIdentity(fixture).fileMode).toBe(0o000);
      }

      const run = runMaterializedSession(fixture);
      const diagnostic = run.stdout + run.stderr;

      expect(run.status).not.toBe(0);
      expect(diagnostic).toMatch(/Lisa.*materialized environment/i);
      expect(diagnostic).toMatch(reason);
      expect(Buffer.byteLength(diagnostic)).toBeLessThanOrEqual(1024);
      expect(diagnostic).not.toContain(fixture.value);
      expect(diagnostic).not.toContain("SHOULD_NOT_RUN");
      expect(diagnostic).not.toContain("ambient-must-lose");
      expect(readFixtureFile(fixture.hookLog)).toBe("");
      expect(readFixtureFile(fixture.profileLog)).toBe("");
      expect(readFixtureFile(fixture.hostileEffect)).toBe("");
      expect(readFileSync(`${fixture.home}/.profile`, "utf8")).toBe(
        profileBefore
      );
    }
  );

  it("rejects foreign ownership from immutable lstat facts", async () => {
    expect(readFileSync(ENVFILE_MODULE, "utf8")).toMatch(ENVFILE_REEXPORT);
    const { materializedOwnersMatch } = await import(ENVFILE_MODULE);
    const fixture = createMaterializedFixture();
    roots.push(fixture.root);
    const identity = artifactIdentity(fixture);
    const expectedUid = process.getuid?.() ?? identity.fileUid;
    const foreignUid = expectedUid === 0 ? 1 : 0;
    const facts = {
      directoryUid: identity.directoryUid,
      expectedUid,
      fileUid: identity.fileUid,
    };

    expect(materializedOwnersMatch(facts)).toBe(true);
    expect(materializedOwnersMatch({ ...facts, fileUid: foreignUid })).toBe(
      false
    );
    expect(
      materializedOwnersMatch({ ...facts, directoryUid: foreignUid })
    ).toBe(false);
    expect(readFixtureFile(fixture.hookLog)).toBe("");
  });

  it.each(AUTHORITY_LAYOUTS)(
    "binds the $label authority decision to the exported owner predicate",
    async layout => {
      const fixture = createMaterializedFixture();
      roots.push(fixture.root);
      const identity = artifactIdentity(fixture);
      const expectedUid = process.getuid?.() ?? identity.fileUid;
      const foreignUid = expectedUid === 0 ? 1 : 0;
      const source = readFileSync(layout.path, "utf8");
      const authority = await authorityLayout(layout.path);
      const owned = authorityFacts(fixture);
      const calls: AuthorityFacts["ownership"][] = [];
      const injected = authority.createMaterializedEnvAuthority(facts => {
        calls.push(facts);
        return false;
      });

      expect(source).toMatch(OWNER_EXPORT);
      expect(source).not.toMatch(/from\s*["'][^"']*envfile\.mjs["']/u);
      expect(source).toMatch(DEFAULT_AUTHORITY);
      expect(injected(owned)).toEqual({
        accepted: false,
        reason: "materialized environment file ownership mismatch",
      });
      expect(calls).toEqual([owned.ownership]);
      expect(authority.validateMaterializedEnvAuthority(owned)).toEqual({
        accepted: true,
      });
      expect(
        authority.validateMaterializedEnvAuthority(
          authorityFacts(fixture, foreignUid)
        )
      ).toEqual({
        accepted: false,
        reason: "materialized environment file ownership mismatch",
      });
      expect(readFixtureFile(fixture.hookLog)).toBe("");
    }
  );

  it("propagates the exact authority CLI foreign-owner refusal", () => {
    const fixture = createMaterializedFixture({
      authorityRefusal: "foreign-owner",
    });
    roots.push(fixture.root);

    const run = runMaterializedSession(fixture);
    const diagnostic = run.stdout + run.stderr;

    expect(run.status).toBe(77);
    expect(diagnostic).toContain(
      "Lisa materialized environment file ownership mismatch"
    );
    expect(diagnostic).not.toContain(fixture.value);
    expect(readFixtureFile(fixture.hookLog)).toBe("");
    expect(readFixtureFile(fixture.profileLog)).toBe("");
  });
});
