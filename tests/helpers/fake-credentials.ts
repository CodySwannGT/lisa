/**
 * Made-up values shaped like each kind of credential, for the suites that
 * check the control commands keep secret values out of what they write.
 *
 * Nothing shaped like a credential is written in this file or in any suite.
 * Every value is assembled when the test runs, from fragments too short to
 * be a credential and from {@link fakeCredential}'s arithmetic sequence, so
 * a suite gets the same value every time and no file holds it
 * (CodySwannGT/lisa#4999).
 * @module tests/helpers/fake-credentials
 */
import { fakeCredential } from "./audit-probes.js";

/** One made-up credential: what a scan calls it and how to make it. */
export interface FakeCredential {
  /** The kind a scan reports it as. */
  readonly kind: string;
  /** What it is, for a test's name. */
  readonly label: string;
  /** Assembles the value. */
  readonly make: () => string;
}

/**
 * Join fragments into one value.
 * @param fragments - Pieces, each too short to be a credential
 * @returns The value
 */
function joined(...fragments: readonly string[]): string {
  return fragments.join("");
}

/**
 * A made-up private key block.
 * @returns The block, with its first and last line
 */
function privateKey(): string {
  const dashes = "-".repeat(5);
  const label = ["PRIVATE", "KEY"].join(" ");
  return [
    `${dashes}BEGIN ${label}${dashes}`,
    fakeCredential(64, 7),
    fakeCredential(64, 9),
    `${dashes}END ${label}${dashes}`,
  ].join("\n");
}

/** One made-up value of every provider-specific shape the scan knows. */
export const FAKE_CREDENTIALS: readonly FakeCredential[] = [
  { kind: "PRIVATE_KEY", label: "a private key block", make: privateKey },
  {
    kind: "URL_CREDENTIALS",
    label: "a web address with a user name and password",
    make: () =>
      joined("https:", "//deploy:", fakeCredential(24), "@example.invalid/x"),
  },
  {
    kind: "API_KEY",
    label: "a payment provider's live key",
    make: () => joined("sk", "_live_", fakeCredential(24)),
  },
  {
    kind: "GITHUB_TOKEN",
    label: "a GitHub personal token",
    make: () => joined("gh", "p_", fakeCredential(36)),
  },
  {
    kind: "GITHUB_TOKEN",
    label: "a GitHub fine-grained token",
    make: () => joined("github", "_pat_", fakeCredential(40)),
  },
  {
    kind: "AWS_ACCESS_KEY",
    label: "an AWS access key id",
    make: () => joined("AK", "IA", fakeCredential(16).toUpperCase()),
  },
  {
    kind: "SLACK_TOKEN",
    label: "a Slack bot token",
    make: () => joined("xo", "xb-", fakeCredential(24)),
  },
  {
    kind: "JWT",
    label: "a signed web token",
    make: () =>
      joined("ey", "J", fakeCredential(20), ".", fakeCredential(20, 3)),
  },
  {
    kind: "OAUTH_TOKEN",
    label: "an OAuth access token",
    make: () => joined("ya", "29.", fakeCredential(30)),
  },
  {
    kind: "GOOGLE_API_KEY",
    label: "a Google API key",
    make: () => joined("AI", "za", fakeCredential(35)),
  },
  {
    kind: "GITLAB_TOKEN",
    label: "a GitLab token",
    make: () => joined("gl", "pat-", fakeCredential(20)),
  },
  {
    kind: "NPM_TOKEN",
    label: "an npm token",
    make: () => joined("np", "m_", fakeCredential(36)),
  },
  {
    kind: "SHOPIFY_TOKEN",
    label: "a Shopify token",
    make: () => joined("sh", "pat_", fakeCredential(32)),
  },
  {
    kind: "SENDGRID_KEY",
    label: "a SendGrid key",
    make: () => joined("S", "G.", fakeCredential(22), ".", fakeCredential(43)),
  },
  {
    kind: "HUGGINGFACE_TOKEN",
    label: "a Hugging Face token",
    make: () => joined("h", "f_", fakeCredential(34)),
  },
  {
    kind: "API_KEY",
    label: "a model provider's key",
    make: () => joined("sk", "-ant-", fakeCredential(40)),
  },
  {
    kind: "DIGITALOCEAN_TOKEN",
    label: "a DigitalOcean token",
    make: () => joined("do", "p_v1_", fakeCredential(64)),
  },
  {
    kind: "PYPI_TOKEN",
    label: "a PyPI token",
    make: () => joined("py", "pi-", fakeCredential(60)),
  },
];

/**
 * The made-up GitHub token most suites seed.
 * @returns The token
 */
export function fakeGithubToken(): string {
  return joined("gh", "p_", fakeCredential(36));
}

/**
 * Lower-case hexadecimal, forty characters by default: the form of a commit
 * hash.
 * @param seed - Start of the sequence; change it to get a different hash
 * @param length - How many characters to produce
 * @returns The made-up hash
 */
export function fakeHex(seed = 5, length = 40): string {
  return Array.from({ length }, (_unused, index) =>
    (((seed + index) * (seed + index + 13) + index * 7) % 16).toString(16)
  ).join("");
}
