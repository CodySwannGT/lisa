/**
 * Read a repository's merge protection for the audit: one harmless read of
 * the hosting platform, returned as a probe entry ready for the report.
 *
 * The audit has to say whether the required checks are enforced where an
 * agent cannot skip them. That is a setting the hosting platform holds, so
 * the audit can only answer by reading it, and when it cannot read it the
 * honest answer is "unknown, and here is the access that is missing".
 *
 * ## Why this is not `lisa controls protect`
 *
 * `protect` answers a different question: does the platform require the
 * checks the control register derives? It reads the platform only when the
 * register derives a check, so in a repository that has no register yet,
 * which is every repository being audited for the first time, it sends
 * nothing. It also writes a handover file, and the audit may change nothing
 * but its report. This read is built from the same parts as `protect` (where
 * the repository is hosted, the one recorded door for requests, the shipped
 * reconciler's reader, the ruleset matcher) and differs in exactly those two
 * ways: it reads whether or not there is a register, and it writes nothing.
 *
 * ## What it may send
 *
 * Reads, and only to github.com. Every request goes through the recording
 * door of `./protect-requests.ts` by its read side, which refuses anything
 * that is not a read without sending it. On any other platform nothing is
 * sent at all, and the probe says so.
 * @module controls/merge-protection-read
 */
import {
  HOSTING_PLATFORM_PROBE_ID,
  SERVER_SIDE_AUTHORITY,
  type AuditProbe,
} from "./audit-probe-types.js";
import { governing } from "./protect-live.js";
import {
  loadProtectionModules,
  type GhRunner,
  type LivePolicyRead,
  type ProtectionModules,
} from "./protect-modules.js";
import {
  detectPlatform,
  platformLabel,
  readOriginUrl,
} from "./protect-platform.js";
import { recordRequests } from "./protect-requests.js";
import {
  GITHUB_PLATFORM,
  UNKNOWN_PLATFORM,
  type PlatformFacts,
  type SentRequest,
} from "./protect-types.js";

/** The format version of the document this read returns. */
export const MERGE_PROTECTION_SCHEMA_VERSION = 1;

/** What the settings cover, said with every successful read. */
export const MERGE_PROTECTION_NOTE =
  "These are the rulesets enforced on the branch, the same settings the enforce step compares and changes. Branch protection rules of the older kind, if this repository uses them, are not read.";

/** One check the platform requires before a merge. */
export interface RequiredCheckRead {
  /** The exact name the platform matches on. */
  readonly context: string;
  /** The ruleset that requires it. */
  readonly ruleset: string;
}

/** What the platform enforces on the branch. */
export interface MergeProtectionSettings {
  /** The rulesets enforced on the branch, by name. */
  readonly rulesets: readonly string[];
  /** Every check those rulesets require. Empty when they require none. */
  readonly required_checks: readonly RequiredCheckRead[];
  /** What was read and what was not. */
  readonly note: string;
}

/** The document the read returns. */
export interface MergeProtectionRead {
  readonly schema_version: typeof MERGE_PROTECTION_SCHEMA_VERSION;
  /** Where the repository is hosted, and how that was learned. */
  readonly platform: PlatformFacts;
  /** The default branch, when the platform named it. */
  readonly branch: string | null;
  /**
   * The probe to copy into the audit report's `probes`, as it is. `null`
   * when nothing says where the repository is hosted, so there is no outside
   * system to probe.
   */
  readonly probe: AuditProbe | null;
  /** The settings that were read; `null` unless the probe is `reachable`. */
  readonly merge_protection: MergeProtectionSettings | null;
  /** Every request, in the order it was made. */
  readonly requests: readonly SentRequest[];
}

/** What the read needs from outside, each replaceable in a test. */
export interface MergeProtectionDependencies {
  /** Sends one request to the platform. The real `gh` by default. */
  readonly gh?: GhRunner;
  /** Reads the address of the `origin` remote. */
  readonly readRemoteUrl?: (root: string) => Promise<string | null>;
  /** Loads the shipped ruleset scripts. */
  readonly loadModules?: () => Promise<ProtectionModules>;
}

/** The access a read of GitHub needs, by why the read failed. */
const GITHUB_ACCESS = {
  notInstalled:
    "the GitHub command-line tool (gh) installed on this machine and signed in with an account that can read this repository on GitHub",
  signedOut:
    "the GitHub command-line tool (gh) signed in with an account that can read this repository on GitHub",
  refused:
    "read access to this repository on GitHub for the account the GitHub command-line tool (gh) is signed in with",
} as const;

/**
 * Say what a platform is, in plain words.
 * @param platform - Where the repository is hosted
 * @returns The sentence a probe carries as its `system`
 */
function systemOf(platform: PlatformFacts): string {
  return `${platformLabel(platform.name)}, where this repository is hosted and its merge settings are kept`;
}

/**
 * Write the requests that were sent as one line.
 * @param requests - The recorded requests
 * @returns Each as its method and path, in order
 */
function requestLine(requests: readonly SentRequest[]): string {
  return requests
    .filter(request => request.sent)
    .map(request => `${request.method} ${request.path}`)
    .join("; ");
}

/**
 * Say what would let a platform that was not asked anything be read.
 * @param platform - Where the repository is hosted
 * @returns The access, in plain words
 */
function accessWithoutRequest(platform: PlatformFacts): string {
  if (platform.name !== GITHUB_PLATFORM) {
    return `a way to read this repository's protected-branch settings on ${platformLabel(platform.name)}, such as that platform's own command-line tool signed in with an account that can see them`;
  }
  return platform.repository === null
    ? "a git remote named origin whose address names this repository on GitHub as owner/name"
    : "the gates declaration and the remote address to name the same hosting platform, so that it is known which one to read";
}

/**
 * The probe of a platform that was not asked anything.
 * @param platform - Where the repository is hosted
 * @returns The probe
 */
function notAttempted(platform: PlatformFacts): AuditProbe {
  const label = platformLabel(platform.name);
  const ownReason =
    platform.name === GITHUB_PLATFORM || platform.detected_from !== "remote";
  return {
    id: HOSTING_PLATFORM_PROBE_ID,
    system: systemOf(platform),
    needed_by: [SERVER_SIDE_AUTHORITY],
    result: "not-attempted",
    reason:
      ownReason && platform.note !== null
        ? platform.note
        : `Lisa has no built-in way to read merge settings on ${label}, so no request was sent.`,
    access_needed: accessWithoutRequest(platform),
  };
}

/**
 * Say what access a failed read of GitHub needs.
 * @param reason - Why the reconciler's reader gave up
 * @param modules - The shipped scripts, which name the reasons
 * @returns The access, in plain words
 */
function githubAccess(reason: string, modules: ProtectionModules): string {
  const reasons = modules.reconcile.UNPROVEN;
  if (reason === reasons.NO_CLI) return GITHUB_ACCESS.notInstalled;
  return reason === reasons.UNAUTHENTICATED
    ? GITHUB_ACCESS.signedOut
    : GITHUB_ACCESS.refused;
}

/**
 * Turn a read of GitHub into the document.
 * @param platform - Where the repository is hosted
 * @param live - What the reconciler's reader returned
 * @param requests - The requests that were made
 * @param modules - The shipped scripts
 * @returns The document
 */
function githubRead(
  platform: PlatformFacts,
  live: LivePolicyRead,
  requests: readonly SentRequest[],
  modules: ProtectionModules
): MergeProtectionRead {
  const base = {
    schema_version: MERGE_PROTECTION_SCHEMA_VERSION,
    platform,
    requests,
  } as const;
  const probe = {
    id: HOSTING_PLATFORM_PROBE_ID,
    system: systemOf(platform),
    needed_by: [SERVER_SIDE_AUTHORITY],
  } as const;
  const request = requestLine(requests);
  const unreachable = (
    observed: string,
    access: string
  ): MergeProtectionRead => ({
    ...base,
    branch: null,
    probe: {
      ...probe,
      result: "unreachable",
      request,
      observed_error: observed,
      access_needed: access,
    },
    merge_protection: null,
  });
  if (!live.ok) {
    return unreachable(
      live.unproven.detail === "" ? live.unproven.reason : live.unproven.detail,
      githubAccess(live.unproven.reason, modules)
    );
  }
  const branch = live.settings.default_branch;
  if (typeof branch !== "string" || branch === "") {
    return unreachable(
      "The platform answered, but its answer does not name the repository's default branch.",
      GITHUB_ACCESS.refused
    );
  }
  const enforced = governing(live.rulesets, branch, branch, modules);
  return {
    ...base,
    branch,
    probe: { ...probe, result: "reachable", request },
    merge_protection: {
      rulesets: enforced.map(ruleset => String(ruleset.name)),
      required_checks: modules.reconcile
        .liveContexts(enforced)
        .map(({ context, ruleset }) => ({ context, ruleset })),
      note: MERGE_PROTECTION_NOTE,
    },
  };
}

/**
 * Read the `gates` block a repository declares, when it declares one.
 *
 * Only the platform a pull-request executor names is taken from it. A
 * repository being audited usually has no declaration, and one that cannot
 * be read is the configure step's to report, not this read's.
 * @param root - Real path of the repository
 * @param modules - The shipped scripts
 * @returns The block, or an empty one
 */
function declaredGates(
  root: string,
  modules: ProtectionModules
): Readonly<Record<string, unknown>> {
  try {
    return modules.gates.readGates(root).gates;
  } catch {
    return {};
  }
}

/**
 * Read a repository's merge protection, changing and writing nothing.
 * @param root - Real path of the repository
 * @param dependencies - Replaceable collaborators
 * @returns The document: the probe, and the settings when they were read
 * @throws {Error} When this copy of Lisa does not hold the shipped scripts
 */
export async function readMergeProtection(
  root: string,
  dependencies: MergeProtectionDependencies = {}
): Promise<MergeProtectionRead> {
  const modules = await (dependencies.loadModules ?? loadProtectionModules)();
  const platform = detectPlatform(
    await (dependencies.readRemoteUrl ?? readOriginUrl)(root),
    declaredGates(root, modules)
  );
  if (!platform.reachable || platform.repository === null) {
    return {
      schema_version: MERGE_PROTECTION_SCHEMA_VERSION,
      platform,
      branch: null,
      probe: platform.name === UNKNOWN_PLATFORM ? null : notAttempted(platform),
      merge_protection: null,
      requests: [],
    };
  }
  const log = recordRequests(dependencies.gh ?? modules.reconcile.ghRunner);
  const live = modules.reconcile.readLivePolicy({
    repo: platform.repository,
    gh: log.read,
  });
  return githubRead(platform, live, log.requests(), modules);
}
