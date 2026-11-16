/**
 * Tests for open-ended tool discovery.
 *
 * The detector used to match script bodies against a fixed list, so it could
 * only re-find tools someone had already thought of — the set that needs a
 * detector least. An Expo project invoking `eas` from eight npm scripts produced
 * nothing, and `gitleaks` running on every commit produced nothing.
 *
 * Every case here is built on a real temporary project rather than a mock,
 * because the failure being prevented is about what is on disk.
 * @module tests/unit/secrets/detect-tooling-discovery
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  commandsIn,
  localFunctions,
  stripNonCommandSpans,
} from "../../../plugins/src/base/skills/lisa-detect-tooling/scripts/commands.mjs";
import {
  detectTooling,
  toolsDiscoveredInScripts,
  toolsFromGitHooks,
} from "../../../plugins/src/base/skills/lisa-detect-tooling/scripts/detect-tooling.mjs";

/** The hook path used by most fixtures here. */
const PRE_COMMIT = ".husky/pre-commit";

/** A minimal hook body that invokes the canonical undeclared tool. */
const GITLEAKS_HOOK = "#!/bin/sh\ngitleaks protect\n";

/** The Expo build script that the old allowlist could not see. */
const EAS_SCRIPT = "eas build --profile production";

/** Projects created for a single test, removed afterwards. */
const created: string[] = [];

/**
 * Build a throwaway project on disk.
 * @param files Relative path to file contents.
 * @returns The project root.
 */
function project(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-detect-"));
  created.push(root);
  for (const [relative, contents] of Object.entries(files)) {
    const full = path.join(root, relative);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, contents);
  }
  return root;
}

afterEach(() => {
  while (created.length > 0) {
    rmSync(created.pop() as string, { recursive: true, force: true });
  }
});

describe("commandsIn", () => {
  it("finds a tool nobody put on a list", () => {
    // The whole point. `eas` was in no allowlist and in eight npm scripts.
    expect(
      commandsIn("eas build --profile production --non-interactive")
    ).toContain("eas");
  });

  it("reads every command position, not just the first", () => {
    const found = commandsIn("gitleaks detect && sentry-cli releases new");
    expect(found).toContain("gitleaks");
    expect(found).toContain("sentry-cli");
  });

  it("treats a `command -v` guard as evidence", () => {
    // A guarded tool is STRONGER evidence than an unguarded one: when it is
    // absent the hook skips silently, so the commit succeeds having scanned
    // nothing. That invisibility is the failure.
    expect(
      commandsIn("if ! command -v gitleaks >/dev/null 2>&1; then\n  exit 0\nfi")
    ).toContain("gitleaks");
  });

  it("ignores what the package manager resolves", () => {
    const found = commandsIn("npx playwright test && bun run build");
    expect(found).not.toContain("playwright");
    expect(found).not.toContain("build");
    expect(found).not.toContain("bun");
  });

  it("ignores the runtime a probe is testing for", () => {
    // `command -v bun` is how a hook checks its own runtime. Reading probed
    // names without the normal filters proposed bun and yarn on every repo.
    expect(commandsIn("command -v bun >/dev/null")).toEqual([]);
  });

  it("ignores shell vocabulary and paths", () => {
    const found = commandsIn(
      'for f in *.ts; do\n  ./scripts/check.sh "$f"\ndone'
    );
    expect(found).toEqual([]);
  });

  it("ignores functions the script defines itself", () => {
    // This repository's pre-push hook defines `load_audit_cves` and calls it,
    // which reads exactly like a command invocation because it is one.
    const body = "load_audit_cves() {\n  echo hi\n}\nload_audit_cves\n";
    expect(localFunctions(body)).toContain("load_audit_cves");
    expect(commandsIn(body)).toEqual([]);
  });

  it("reads into a quoted `sh -c` payload", () => {
    // Frontend's eas:publish:e2e wraps its real command in exactly this shape.
    expect(commandsIn(`sh -c 'set -e; eas update --auto'`)).toContain("eas");
  });

  it("does not read embedded programs as commands", () => {
    // jq filter internals and `node -e` payloads are arguments, not commands.
    const found = commandsIn(
      `jq -r '.results | map(select(.status)) | length' file.json`
    );
    expect(found).toContain("jq");
    expect(found).not.toContain("map");
    expect(found).not.toContain("select");
    expect(found).not.toContain("length");
  });
});

describe("stripNonCommandSpans", () => {
  it("survives an apostrophe inside a comment", () => {
    // The regression that leaked JavaScript. A lone apostrophe in `# the
    // script's exit code` paired with the next real quote 28 lines later and
    // blanked everything between, exposing a node -e payload.
    const text = "# the script's exit code\ngitleaks detect\n";
    expect(stripNonCommandSpans(text)).toContain("gitleaks");
    expect(commandsIn(text)).toContain("gitleaks");
  });

  it("restarts quoting inside a command substitution", () => {
    // `$( )` opens a fresh quoting context. A flat scanner falls out of phase
    // on the first one and exposes the payload's own string literals.
    const text = `OUT="$(printf '%s' "$JSON" | node -e 'x("data")')"\ngitleaks detect`;
    const found = commandsIn(text);
    expect(found).toContain("gitleaks");
    expect(found).not.toContain("data");
  });
});

describe("toolsFromGitHooks", () => {
  it("reads .husky hooks", () => {
    const root = project({
      [PRE_COMMIT]: "#!/bin/sh\ngitleaks protect --staged\n",
    });
    expect([...toolsFromGitHooks(root).keys()]).toContain("gitleaks");
  });

  it("reads .git/hooks but skips the samples git ships", () => {
    const root = project({
      ".git/hooks/pre-push": "#!/bin/sh\ntrufflehog git file://.\n",
      ".git/hooks/pre-commit.sample": "#!/bin/sh\nsomethingelse --run\n",
    });
    const found = [...toolsFromGitHooks(root).keys()];
    expect(found).toContain("trufflehog");
    expect(found).not.toContain("somethingelse");
  });

  it("names the hook as evidence", () => {
    const root = project({
      [PRE_COMMIT]: GITLEAKS_HOOK,
    });
    expect(toolsFromGitHooks(root).get("gitleaks")).toContain(PRE_COMMIT);
  });

  it("returns nothing when a project has no hooks", () => {
    expect([...toolsFromGitHooks(project({})).keys()]).toEqual([]);
  });
});

describe("toolsDiscoveredInScripts", () => {
  it("finds a tool no allowlist mentions", () => {
    const found = toolsDiscoveredInScripts({
      scripts: { "eas:deploy": EAS_SCRIPT },
    });
    expect([...found.keys()]).toContain("eas");
    expect(found.get("eas")).toContain("eas:deploy");
  });
});

describe("detectTooling with discovery", () => {
  it("proposes eas for an Expo project that invokes it", () => {
    const root = project({
      "package.json": JSON.stringify({
        scripts: { "eas:deploy:production": EAS_SCRIPT },
      }),
      ".lisa.config.json": JSON.stringify({ remoteEnv: { tools: {} } }),
    });
    const names = detectTooling(root).map(p => p.name);
    expect(names).toContain("eas");
  });

  it("proposes gitleaks for a repo whose hook runs it", () => {
    const root = project({
      "package.json": "{}",
      ".husky/pre-commit":
        "#!/bin/sh\ncommand -v gitleaks && gitleaks protect\n",
    });
    expect(detectTooling(root).map(p => p.name)).toContain("gitleaks");
  });

  it("stays silent about a tool the manifest already declares", () => {
    const root = project({
      "package.json": JSON.stringify({
        scripts: { deploy: EAS_SCRIPT },
      }),
      ".lisa.config.json": JSON.stringify({
        remoteEnv: { tools: { install: [{ name: "eas" }] } },
      }),
    });
    expect(detectTooling(root).map(p => p.name)).not.toContain("eas");
  });

  it("stays silent about a binary node_modules already provides", () => {
    const root = project({
      "package.json": JSON.stringify({ scripts: { test: "jest --ci" } }),
      "node_modules/.bin/jest": "#!/bin/sh\n",
    });
    expect(detectTooling(root).map(p => p.name)).not.toContain("jest");
  });

  it("never proposes a coding agent, which belongs to the machine", () => {
    // Real evidence, wrong manifest: agents are installed by their vendor into
    // a version directory they manage, and lisa-setup-workstation owns that.
    const root = project({
      "package.json": "{}",
      ".husky/post-checkout": "#!/bin/sh\ntimeout 45 claude plugin install\n",
    });
    expect(detectTooling(root).map(p => p.name)).not.toContain("claude");
  });

  it("gives every proposal a reason and a source", () => {
    // A proposal without a reason is an assertion, and this program asserts
    // nothing.
    const root = project({
      "package.json": "{}",
      [PRE_COMMIT]: GITLEAKS_HOOK,
    });
    for (const proposal of detectTooling(root)) {
      expect(proposal.why).not.toBe("");
      expect(["curated", "discovered"]).toContain(proposal.source);
    }
  });

  it("marks a hook-discovered tool as discovered, not curated", () => {
    const root = project({
      "package.json": "{}",
      [PRE_COMMIT]: GITLEAKS_HOOK,
    });
    const found = detectTooling(root).find(p => p.name === "gitleaks");
    expect(found?.source).toBe("discovered");
    expect(found?.why).toContain("git hook");
  });
});
