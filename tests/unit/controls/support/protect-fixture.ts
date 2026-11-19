/**
 * Repositories and names the `lisa controls protect` suites share
 * (CodySwannGT/lisa#4993).
 *
 * Every suite runs the command against a throwaway fixture repository and the
 * in-memory platform in `./fake-github.ts`. Nothing here names or reaches a
 * real repository: the remote addresses are handed to the command as text and
 * never resolved.
 * @module tests/unit/controls/support/protect-fixture
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  protectRepository,
  type ProtectDependencies,
  type ProtectOptions,
} from "../../../../src/controls/protect.js";
import {
  MERGE_PROTECTION_CHANGE_PATH,
  type ProtectResult,
} from "../../../../src/controls/protect-types.js";
import {
  buildControlAuditFixture,
  type ControlAuditFixture,
} from "../../../helpers/control-audit-fixtures.js";
import {
  F_MIXED_GATES,
  F_PAVED_GATES,
  configFile,
  type GatesBlock,
} from "../../../helpers/control-register.js";
import type { FakeGithub } from "./fake-github.js";

/** The only repository the in-memory platform holds. */
export const REPO = "example-owner/example-repo";

/** A GitHub remote address for {@link REPO}. */
export const GITHUB_REMOTE = `https://github.com/${REPO}.git`;

/** The check the F-mixed declaration derives for a pull request. */
export const LINT_CHECK = "🔍 Quality Checks / 🧹 Lint";

/** The check the paved-road declaration awaits from another app. */
export const REVIEW_CHECK = "Review Bot";

/**
 * The paved-road declaration, awaiting its review check from any source: the
 * gate names the check and no app that has to report it.
 */
export const AWAITED_FROM_ANYONE: GatesBlock = {
  ...F_PAVED_GATES,
  "code-review": {
    "pull-request": { level: "required", await: REVIEW_CHECK },
  },
};

/** One check a write asked the platform to require. */
export interface SentCheck {
  readonly context: string;
  /** The app it is pinned to; absent when any source may report it. */
  readonly integration_id?: number;
}

/**
 * The checks every write asked the platform to require.
 * @param github - The in-memory platform
 * @returns The checks in each write, in order; nothing when none was sent
 */
export function sentChecks(github: FakeGithub): readonly SentCheck[] {
  return github.writes().flatMap(write => {
    const body = write.body as {
      readonly rules: readonly {
        readonly parameters?: {
          readonly required_status_checks?: readonly SentCheck[];
        };
      }[];
    };
    return body.rules.flatMap(
      rule => rule.parameters?.required_status_checks ?? []
    );
  });
}

/**
 * The check names every write asked the platform to require.
 * @param github - The in-memory platform
 * @returns The names, in order; nothing when no write was sent
 */
export function sentAsRequired(github: FakeGithub): readonly string[] {
  return sentChecks(github).map(check => check.context);
}

/** A workflow file, so the repository has something that can report a check. */
const WORKFLOW_FILES = {
  ".github/workflows/quality.yml": "name: quality\non: pull_request\n",
} as const;

/** How a protect fixture differs from F-mixed with its declaration. */
export interface ProtectFixtureOptions {
  /** The `gates` block; F-mixed's own by default. */
  readonly gates?: GatesBlock;
  /** Whether the repository holds a workflow folder. Default true. */
  readonly workflows?: boolean;
  /** Other top-level keys of `.lisa.config.json`. */
  readonly config?: Readonly<Record<string, unknown>>;
}

/**
 * Build F-mixed with a gates declaration and, by default, a workflow folder.
 * @param options - How it differs
 * @returns The repository
 */
export function protectFixture(
  options: ProtectFixtureOptions = {}
): ControlAuditFixture {
  const gates = options.gates ?? F_MIXED_GATES;
  const config =
    options.config === undefined
      ? configFile(gates)
      : `${JSON.stringify({ ...options.config, gates }, null, 2)}\n`;
  return buildControlAuditFixture("F-mixed", {
    extraFiles: {
      ".lisa.config.json": config,
      ...(options.workflows === false ? {} : WORKFLOW_FILES),
    },
  });
}

/**
 * Run the command's core against a repository and the in-memory platform.
 * @param repoPath - The repository root
 * @param github - The in-memory platform
 * @param options - The command's options
 * @param dependencies - Collaborators to replace beyond the platform
 * @returns The result document
 * @throws {Error} When the command could not produce a result
 */
export async function protect(
  repoPath: string,
  github: FakeGithub,
  options: ProtectOptions = {},
  dependencies: ProtectDependencies = {}
): Promise<ProtectResult> {
  const run = await protectRepository(repoPath, options, {
    gh: github.gh,
    readRemoteUrl: () => Promise.resolve(GITHUB_REMOTE),
    ...dependencies,
  });
  if (run.problems !== null) {
    throw new Error(`protect refused to run: ${run.problems.join(" | ")}`);
  }
  return run.result;
}

/**
 * Read the handover file a repository holds.
 * @param repoPath - The repository root
 * @returns Its content, or `null` when there is none
 */
export function handover(repoPath: string): string | null {
  const file = path.join(repoPath, MERGE_PROTECTION_CHANGE_PATH);
  return existsSync(file) ? readFileSync(file, "utf8") : null;
}
