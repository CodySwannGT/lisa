/** Resolve the issue and optional Project service before selecting provider reads. */
import { isJsonObject, type JsonObject } from "../sync/json-path.js";
import { readConfinedMergedConfig } from "./confined-project-read.js";

const LOGIN = /^(?!-)[a-z\d_-]+$/iu;
const REPO = /^(?!\.{1,2}$)[a-z\d_.-]+$/iu;
const QUALIFIED = /^([a-z\d_-]+)\/([a-z\d_.-]+)#([1-9]\d*)$/iu;
const ISSUE_URL =
  /^https:\/\/github\.com\/([a-z\d_-]+)\/([a-z\d_.-]+)\/issues\/([1-9]\d*)\/?$/iu;
const NUMBER = /^#?([1-9]\d*)$/u;

/** The native repository identity for a read. */
export interface GitHubIssueRef {
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
}

/** A Project reference that has passed local configuration validation. */
export interface GitHubReaderProject {
  readonly kind: "organization" | "user";
  readonly login: string;
  readonly number: number;
  readonly required: boolean;
}

/**
 * Accept an absent setting and refuse a present value of the wrong shape.
 * @param value - Effective configuration value.
 * @param field - Configuration key for diagnostics.
 * @returns The configuration object, or undefined when absent.
 */
function optionalObject(value: unknown, field: string): JsonObject | undefined {
  if (value === undefined || isJsonObject(value)) return value;
  throw new Error(`${field} must be an object`);
}

/**
 * Verify names before using them in repository paths or GraphQL variables.
 * @param owner - Repository owner.
 * @param repo - Repository name.
 * @returns The repository identity.
 */
function repository(owner: unknown, repo: unknown) {
  if (
    typeof owner !== "string" ||
    !LOGIN.test(owner) ||
    typeof repo !== "string" ||
    !REPO.test(repo)
  ) {
    throw new Error(
      "A GitHub repository needs a valid owner and repository name"
    );
  }
  return { owner, repo };
}

/**
 * Parse the approved GitHub issue argument forms.
 * @param input - Issue number, qualified reference or URL.
 * @param github - Effective GitHub configuration.
 * @returns The selected repository and issue number.
 */
function issueRef(input: string, github: JsonObject): GitHubIssueRef {
  const value = input.trim();
  const ref = QUALIFIED.exec(value) ?? ISSUE_URL.exec(value);
  const number = Number(ref?.[3] ?? NUMBER.exec(value)?.[1]);
  if (!Number.isSafeInteger(number)) {
    throw new Error(
      "Use an issue number, owner/repo#number, or a GitHub issue URL"
    );
  }
  return {
    ...repository(ref?.[1] ?? github.org, ref?.[2] ?? github.repo),
    number,
  };
}

/**
 * Resolve the documented ProjectV2 block and its repository namespace.
 * @param github - Effective GitHub configuration.
 * @returns Validated Project settings when configured.
 */
function projectSettings(github: JsonObject): GitHubReaderProject | undefined {
  const projects = optionalObject(github.projects, "github.projects");
  const configured = optionalObject(projects?.v2, "github.projects.v2");
  if (configured === undefined) return undefined;
  const tracked = repository(github.org, github.repo);
  const owner = optionalObject(configured.owner, "github.projects.v2.owner");
  const { kind, slug } = owner ?? {};
  const { number, required } = configured;
  if (kind !== "organization" && kind !== "user") {
    throw new Error(
      "github.projects.v2.owner.kind must be organization or user"
    );
  }
  if (
    typeof slug !== "string" ||
    slug.toLowerCase() !== tracked.owner.toLowerCase()
  ) {
    throw new Error("github.projects.v2.owner.slug must match github.org");
  }
  if (
    typeof number !== "number" ||
    !Number.isSafeInteger(number) ||
    number <= 0
  ) {
    throw new Error("github.projects.v2.number must be a positive integer");
  }
  if (required !== undefined && typeof required !== "boolean") {
    throw new Error("github.projects.v2.required must be true or false");
  }
  return { kind, login: slug, number, required: required ?? false };
}

/**
 * Resolve and validate the effective configuration before any provider calls.
 * @param root - Current Lisa checkout.
 * @param input - Issue argument from the caller.
 * @returns Independent repository and optional Project identities.
 */
export async function resolveGitHubReaderTarget(root: string, input: string) {
  const config = await readConfinedMergedConfig(root, true);
  const github = optionalObject(config.github, "github") ?? {};
  return { issue: issueRef(input, github), project: projectSettings(github) };
}
