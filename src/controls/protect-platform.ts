/**
 * Where a repository is hosted, and whether `lisa controls protect` may talk
 * to that platform at all.
 *
 * Merge protection is changed on GitHub only. Two things say where a
 * repository is hosted: the address of its `origin` remote, and any
 * pull-request `executor.platform` its gates declaration names. A request is
 * sent only when the remote is `github.com` and the declaration does not name
 * another platform. In every other case — another platform, a self-hosted
 * GitHub, no remote, or the two disagreeing — nothing is sent, and the change
 * is handed to an administrator instead.
 * @module controls/protect-platform
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  GITHUB_PLATFORM,
  PULL_REQUEST_MOMENT,
  UNKNOWN_PLATFORM,
  type PlatformFacts,
} from "./protect-types.js";

const run = promisify(execFile);

/** A self-hosted GitHub: the same settings, but not reached by this command. */
export const GITHUB_ENTERPRISE_PLATFORM = "github-enterprise";

/** How long reading the remote address may take. */
const GIT_TIMEOUT_MS = 5000;

/** The only host this command sends requests for. */
const GITHUB_HOST = "github.com";

/** One owner or repository name, as the platform allows it. */
const REPOSITORY_PART = /^[\w.-]{1,100}$/u;

/** Platforms recognised by a word in the host name, most specific first. */
const HOST_WORDS: readonly (readonly [string, string])[] = [
  ["gitlab", "gitlab"],
  ["bitbucket", "bitbucket"],
  ["dev.azure.com", "azure-devops"],
  ["visualstudio.com", "azure-devops"],
  ["github", GITHUB_ENTERPRISE_PLATFORM],
];

/** How each known platform is written in a sentence. */
const PLATFORM_LABELS: Readonly<Record<string, string>> = {
  [GITHUB_PLATFORM]: "GitHub",
  [GITHUB_ENTERPRISE_PLATFORM]: "GitHub (self-hosted)",
  gitlab: "GitLab",
  bitbucket: "Bitbucket",
  "azure-devops": "Azure DevOps",
};

/**
 * Write a platform's name the way a person would.
 * @param name - The platform as the result document names it
 * @returns For example `GitLab`; a name this command does not know as it is
 */
export function platformLabel(name: string): string {
  return PLATFORM_LABELS[name] ?? name;
}

/** A remote address, taken apart. */
export interface RemoteAddress {
  /** The host, in lower case, without a port or a user. */
  readonly host: string;
  /** The path after the host, without a leading `/` or a trailing `.git`. */
  readonly path: string;
}

/**
 * Tidy the path of a remote address.
 * @param remotePath - The path as the address writes it
 * @returns It without surrounding `/` or a trailing `.git`
 */
function tidyPath(remotePath: string): string {
  const parts = remotePath.split("/").filter(part => part !== "");
  const joined = parts.join("/");
  return joined.endsWith(".git") ? joined.slice(0, -".git".length) : joined;
}

/**
 * Take apart the short `user@host:path` form of a remote address.
 * @param address - The remote address
 * @returns The host and path, or `null` when it is not that form
 */
function parseShortAddress(address: string): RemoteAddress | null {
  const colon = address.indexOf(":");
  if (colon === -1) return null;
  const authority = address.slice(0, colon);
  const host = authority.slice(authority.lastIndexOf("@") + 1).toLowerCase();
  const remotePath = address.slice(colon + 1);
  const usable =
    host !== "" &&
    !host.includes("/") &&
    remotePath !== "" &&
    !remotePath.startsWith("/");
  return usable ? { host, path: tidyPath(remotePath) } : null;
}

/**
 * Take a git remote address apart.
 *
 * Understands `https://host/path`, `ssh://user@host:port/path` and the short
 * `user@host:path` form. A local path or anything else answers `null`.
 * @param url - The remote address
 * @returns The host and path, or `null` when it names no host
 */
export function parseRemoteAddress(url: string): RemoteAddress | null {
  const trimmed = url.trim();
  if (trimmed === "" || trimmed.includes(" ")) return null;
  if (!trimmed.includes("://")) return parseShortAddress(trimmed);
  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();
    return host === "" ? null : { host, path: tidyPath(parsed.pathname) };
  } catch {
    return null;
  }
}

/**
 * Name the platform a host belongs to.
 * @param host - The remote's host, in lower case
 * @returns The platform, or {@link UNKNOWN_PLATFORM}
 */
export function platformOfHost(host: string): string {
  if (host === GITHUB_HOST || host === `www.${GITHUB_HOST}`) {
    return GITHUB_PLATFORM;
  }
  const known = HOST_WORDS.find(([word]) => host.includes(word));
  return known === undefined ? UNKNOWN_PLATFORM : known[1];
}

/**
 * Normalise a platform name the declaration gives.
 * @param declared - The name as written
 * @returns `github` for any GitHub spelling; otherwise the name in lower case
 */
function declaredPlatform(declared: string): string {
  const name = declared.trim().toLowerCase();
  return name.includes(GITHUB_PLATFORM) ? GITHUB_PLATFORM : name;
}

/**
 * The platforms the declaration names for its pull-request executors.
 *
 * Read tolerantly: the key is optional, and a gate, a moment or an executor
 * of any other shape is passed over rather than refused. Validating it is the
 * declaration's job, not this command's.
 * @param gates - The `gates` block
 * @returns Each distinct platform, normalised, in declaration order
 */
export function declaredExecutorPlatforms(
  gates: Readonly<Record<string, unknown>>
): readonly string[] {
  const names = Object.values(gates).flatMap(gate => {
    const moment =
      gate !== null && typeof gate === "object"
        ? (Reflect.get(gate, PULL_REQUEST_MOMENT) as unknown)
        : undefined;
    const executor =
      moment !== null && typeof moment === "object"
        ? (Reflect.get(moment, "executor") as unknown)
        : undefined;
    const platform =
      executor !== null && typeof executor === "object"
        ? (Reflect.get(executor, "platform") as unknown)
        : undefined;
    return typeof platform === "string" && platform.trim() !== ""
      ? [declaredPlatform(platform)]
      : [];
  });
  return [...new Set(names)];
}

/**
 * Read `owner/name` from a remote path.
 * @param remotePath - The path after the host
 * @returns The repository, or `null` when the path is not exactly two names
 */
function repositoryOf(remotePath: string): string | null {
  const parts = remotePath.split("/");
  return parts.length === 2 && parts.every(part => REPOSITORY_PART.test(part))
    ? parts.join("/")
    : null;
}

/**
 * Say where a repository is hosted when its remote names GitHub.
 * @param repository - `owner/name`, or `null` when the address gives none
 * @param others - Platforms the declaration names that are not GitHub
 * @returns The facts
 */
function githubFacts(
  repository: string | null,
  others: readonly string[]
): PlatformFacts {
  const base = {
    name: GITHUB_PLATFORM,
    repository,
    detected_from: "remote",
  } as const;
  if (others.length > 0) {
    return {
      ...base,
      reachable: false,
      note: `The remote address is on GitHub, but the gates declaration names a pull-request executor on ${others.map(platformLabel).join(", ")}. The two disagree, so nothing was sent.`,
    };
  }
  return repository === null
    ? {
        ...base,
        reachable: false,
        note: "The remote address is on GitHub but does not name one repository as owner/name, so nothing was sent.",
      }
    : { ...base, reachable: true, note: null };
}

/**
 * Say where a repository is hosted and whether a request may be sent.
 * @param remoteUrl - The address of the `origin` remote, or `null` for none
 * @param gates - The `gates` block of the declaration
 * @returns The platform facts
 */
export function detectPlatform(
  remoteUrl: string | null,
  gates: Readonly<Record<string, unknown>>
): PlatformFacts {
  const declared = declaredExecutorPlatforms(gates);
  const others = declared.filter(name => name !== GITHUB_PLATFORM);
  const address = remoteUrl === null ? null : parseRemoteAddress(remoteUrl);
  const remote =
    address === null ? UNKNOWN_PLATFORM : platformOfHost(address.host);
  if (remote === GITHUB_PLATFORM) {
    return githubFacts(repositoryOf(address?.path ?? ""), others);
  }
  if (remote !== UNKNOWN_PLATFORM) {
    return {
      name: remote,
      repository: address?.path ?? null,
      detected_from: "remote",
      reachable: false,
      note:
        remote === GITHUB_ENTERPRISE_PLATFORM
          ? "This repository is on a self-hosted GitHub. This command changes merge protection on github.com only, so nothing was sent."
          : `This repository is hosted on ${platformLabel(remote)}. This command changes merge protection on GitHub only, so nothing was sent.`,
    };
  }
  const [named] = declared;
  return named === undefined
    ? {
        name: UNKNOWN_PLATFORM,
        repository: null,
        detected_from: "none",
        reachable: false,
        note: "Nothing says where this repository is hosted: it has no origin remote on a known platform, and the gates declaration names no pull-request executor platform. Nothing was sent.",
      }
    : {
        name: named,
        repository: null,
        detected_from: "declaration",
        reachable: false,
        note: `The gates declaration names a pull-request executor on ${platformLabel(named)}, and the remote address does not say which repository that is. Nothing was sent.`,
      };
}

/**
 * Read the configured address of a repository's `origin` remote.
 *
 * The configured value, not the one git would connect to after rewriting: the
 * question is where the repository lives, not how this machine reaches it.
 * @param root - Real path of the repository
 * @returns The address, or `null` when there is no such remote or no git
 */
export async function readOriginUrl(root: string): Promise<string | null> {
  try {
    const { stdout } = await run(
      "git",
      ["config", "--get", "remote.origin.url"],
      { cwd: root, encoding: "utf8", timeout: GIT_TIMEOUT_MS }
    );
    const url = stdout.trim();
    return url === "" ? null : url;
  } catch {
    return null;
  }
}
