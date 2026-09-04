/**
 * Detect references to downstream host projects in this repository's own files.
 *
 * Projects may mention Lisa; Lisa may not mention projects. This repository is
 * public and `dist/` is in the npm `files` allowlist, so a comment in `src/` is
 * published twice — on github.com and to every consumer that installs.
 *
 * **Two detectors, because one shape was never the whole problem.**
 *
 * The first is shape detection: allowlist the orgs that are legitimately
 * public, flag every other `github.com/owner/repo` or workflow `uses:`, and a
 * newly onboarded downstream project is caught without anyone remembering to
 * add it. That reach is real and it is kept.
 *
 * The second is a known-name check, added because the first measured zero
 * violations on a tree that had them. Every occurrence that actually happens is
 * a bare name in prose, in a code comment, or inside a local absolute path —
 * no `github.com` in front of it, and frequently no slash in it at all. Shape
 * detection cannot reach that without matching bare `a/b` everywhere, which
 * collides with file paths, date fractions and option syntax; a guard with
 * false positives gets disabled, which is worse than a known blind spot. A
 * fixed list has no false-positive problem to trade against, and the objection
 * to a list — that it publishes the names — is answered by storing digests
 * rather than names. See `./downstream-names.js`.
 * @module core/downstream-references
 */
import type { NameMatcher } from "./downstream-names.js";
import { findHostNames, hostNameEntries } from "./downstream-names.js";

/**
 * GitHub orgs this repository may legitimately name.
 *
 * Lisa's own org, the platforms it integrates with, and the vendors whose
 * actions and packages it pins. Anything outside this set is treated as a host
 * project until someone deliberately says otherwise.
 */
export const PUBLIC_ORGS: readonly string[] = [
  "codyswanngt",
  "actions",
  // The Rust community's Actions org. Named only as a lookalike fixture: it is
  // what proves the `actions` exemption is an owner allowlist rather than a
  // prefix match, which a substring check would silently get wrong.
  "actions-rs",
  "github",
  "anthropics",
  "openai",
  "oven-sh",
  "microsoft",
  "facebook",
  "vercel",
  "expo",
  "mobile-dev-inc",
  "coderabbitai",
  "getsentry",
  "snyk",
  "sonarsource",
  "gitguardian",
  "aws",
  "aws-actions",
  "docker",
  "denoland",
  "nodejs",
  "npm",
  "pnpm",
  "yarnpkg",
  "eslint",
  "prettier",
  "vitest-dev",
  "jestjs",
  "typescript-eslint",
  "biomejs",
  "astral-sh",
  "peter-evans",
  "dependabot",
  "renovatebot",
  "fossas",
  "zaproxy",
  "softprops",
  "reactivecircus",
  "webfactory",
  "slsa-framework",
  "hashicorp",
  "chinthakagodawita",
  "browser-actions",
  "googlechrome",
  "geowerkstatt",
  "ibm",
  "lopopolo",
  "canastro",
  "numman-ali",
  "ankitpokhrel",
  "enquirer",
  "oxc-project",
  "pypa",
  "bats-core",
  "jprichardson",
  "mbj",
  "steveyegge",
  "eyaltoledano",
  "piebald-ai",
  "gitleaks",
  "ruby",
  "grafana",
  "cli",
  "bitwarden",
  "import-js",
  "evanbacon",
  "stretchr",
  "noliran",
];

/**
 * Owners that are obviously stand-ins rather than real accounts.
 *
 * Documentation needs a worked example, and refusing one would push authors
 * toward using a real name instead — the opposite of the intent.
 */
export const PLACEHOLDER_OWNERS: readonly string[] = [
  "your_username",
  "your-org",
  "yourorg",
  "owner",
  "org",
  "example",
  "example-org",
  "acme",
  "acmeorga",
  "acmeorgb",
  "acmeorgc",
  "acmeorgd",
  "acme-secret-customer",
  "someone",
  "somebody",
  "vendor",
  "urlorg",
  "host",
  "myorg",
  "o",
];

/**
 * URL path segments that precede the owner rather than being it.
 *
 * `api.github.com/repos/<owner>/<repo>` and `github.com/orgs/<org>` both put a
 * fixed word where the owner would otherwise sit.
 */
const NOT_AN_OWNER: readonly string[] = [
  "repos",
  "orgs",
  "users",
  "packages",
  "advisories",
  "search",
  "gists",
  "apps",
  "en",
  "private",
  "public",
  "settings",
  "notifications",
  "sponsors",
  "features",
  "pricing",
];

/**
 * AWS account ids that are documentation placeholders rather than real ones.
 *
 * AWS's own docs use `123456789012`; the repeated-digit forms are unmistakably
 * synthetic. Any other 12-digit account id in an ARN is treated as real.
 */
export const PLACEHOLDER_ACCOUNTS: readonly string[] = [
  "123456789012",
  "210987654321",
  "345678901234",
  "456789012345",
  "111111111111",
  "222222222222",
  "333333333333",
  "000000000000",
];

/** One detected reference, with enough context to act on it. */
export interface DownstreamReference {
  /** 1-indexed line number. */
  readonly line: number;
  /** What was matched. */
  readonly match: string;
  /** Why it is a violation. */
  readonly reason: string;
}

// `owner/repo` as it appears in a URL or a workflow `uses:`. Deliberately not
// matching bare `a/b` anywhere in prose: that shape collides with file paths,
// date fractions and option syntax, and a guard with false positives gets
// disabled, which is worse than a guard with a known blind spot.
const OWNER_REPO =
  /(?:github\.com[/:]|uses:\s*)([A-Za-z0-9][\w.-]*)\/([\w.-]+)/gu;

/**
 * Whether a captured owner is something other than a real account name.
 * @param owner - The lowercased first path segment.
 * @returns True when it must not be treated as an org.
 */
function isNotAnOwner(owner: string): boolean {
  // A port (`git@github.com:22/...`) captures as digits.
  if (/^\d+$/u.test(owner)) {
    return true;
  }
  return NOT_AN_OWNER.includes(owner) || PLACEHOLDER_OWNERS.includes(owner);
}

const ARN_ACCOUNT = /arn:aws:[a-z0-9-]*:[a-z0-9-]*:(\d{12})/gu;
const SSO_ACCOUNT = /sso_account_id\s*=\s*(\d{12})/gu;

/**
 * Owner/repo references on one line that name a non-public org.
 * @param text - The line's text.
 * @param line - 1-indexed line number.
 * @returns Violations on this line.
 */
function ownerViolations(
  text: string,
  line: number
): readonly DownstreamReference[] {
  return [...text.matchAll(OWNER_REPO)]
    .filter(match => {
      const org = (match[1] ?? "").toLowerCase();
      return org !== "" && !PUBLIC_ORGS.includes(org) && !isNotAnOwner(org);
    })
    .map(match => ({
      line,
      match: `${match[1]}/${match[2]}`,
      reason: `"${match[1]}" is not an allowlisted public org — Lisa must not name a downstream project`,
    }));
}

/**
 * Real-looking AWS account ids on one line.
 * @param text - The line's text.
 * @param line - 1-indexed line number.
 * @returns Violations on this line.
 */
function accountViolations(
  text: string,
  line: number
): readonly DownstreamReference[] {
  return [ARN_ACCOUNT, SSO_ACCOUNT]
    .flatMap(pattern => [...text.matchAll(pattern)])
    .filter(match => !PLACEHOLDER_ACCOUNTS.includes(match[1] ?? ""))
    .map(match => ({
      line,
      match: match[1] ?? "",
      reason: "a real-looking AWS account id — use a documentation placeholder",
    }));
}

/**
 * Known host names spelled out on one line.
 * @param text - The line's text.
 * @param line - 1-indexed line number.
 * @param matcher - Prepared name matcher.
 * @returns Violations on this line.
 */
function nameViolations(
  text: string,
  line: number,
  matcher: NameMatcher
): readonly DownstreamReference[] {
  return findHostNames(text, matcher).map(match => ({
    line,
    match,
    reason:
      "names a downstream host project — write the evidence, not the identity",
  }));
}

/**
 * Find downstream-project references in one file's contents.
 * @param contents - The file's text.
 * @param matcher - Name matcher to use; defaults to the committed list plus
 *   anything the environment adds.
 * @returns Every violation found, in line order.
 */
export function findDownstreamReferences(
  contents: string,
  matcher: NameMatcher = hostNameEntries()
): readonly DownstreamReference[] {
  return contents
    .split("\n")
    .flatMap((text, index) => [
      ...ownerViolations(text, index + 1),
      ...accountViolations(text, index + 1),
      ...nameViolations(text, index + 1, matcher),
    ]);
}
