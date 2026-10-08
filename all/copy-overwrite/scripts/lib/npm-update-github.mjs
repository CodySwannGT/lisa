// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Bounded trusted GitHub transport. @module npm-updater */
import { canonicalJson } from "../lisa-automation-provenance.mjs";
import { assertPinnedVerifier } from "./github-attestation-verifier.mjs";
import { required } from "./npm-update-contract.mjs";
import { runProcess } from "./npm-update-process.mjs";
import { gitObjectId } from "./npm-update-object.mjs";
import { proposalFileNames } from "./npm-update-contract.mjs";
import { executeCanonicalHelper } from "./npm-update-controller-factory.mjs";
/** Explicit minimum gh identity and token; no caller/candidate executable override. */
const HOST_OPTION = "--hostname";
const GITHUB_HOST = "github.com";
const TRANSPORT_PATH = "/usr/bin:/bin";
const NO_HOME = "/nonexistent";

export class GitHub {
  constructor(policy, token, execute = runProcess) {
    assertPinnedVerifier(policy);
    required(
      typeof token === "string" && token.length > 0,
      "job-scoped GitHub token is absent"
    );
    this.policy = policy;
    this.token = token;
    this.execute = execute;
  }
  async request(endpoint, method = "GET", body) {
    required(
      endpoint.startsWith(`repos/${this.policy.repository}/`) ||
        endpoint === `repos/${this.policy.repository}` ||
        endpoint.startsWith("search/issues?"),
      "provider endpoint outside configured repository"
    );
    const args = [
      "api",
      HOST_OPTION,
      GITHUB_HOST,
      "--method",
      method,
      endpoint,
    ];
    if (body) args.push("--input", "-");
    const result = await this.execute(this.policy.ghExecutable, args, {
      env: {
        PATH: TRANSPORT_PATH,
        GH_TOKEN: this.token,
        GH_HOST: GITHUB_HOST,
        HOME: NO_HOME,
        GIT_TERMINAL_PROMPT: "0",
      },
      input: body ? canonicalJson(body) : undefined,
      timeout: 30_000,
    });
    const bytes = result.stdout;
    required(bytes.length <= 3_145_728, "provider response exceeds bound");
    return bytes.length
      ? JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(bytes))
      : null;
  }
  async list(endpoint) {
    const entries = [];
    for (let page = 1; page <= 20; page++) {
      const batch = await this.request(
        `${endpoint}${endpoint.includes("?") ? "&" : "?"}per_page=100&page=${page}`
      );
      required(Array.isArray(batch), "provider page is not an array");
      entries.push(...batch);
      if (batch.length < 100) return entries;
    }
    throw new Error("npm updater: provider pagination exceeded bound");
  }
  /** Absence is a proved 404, never a read error interpreted as empty state. */
  async maybe(endpoint) {
    required(
      endpoint.startsWith(`repos/${this.policy.repository}/`),
      "recovery endpoint outside configured repository"
    );
    const result = await this.execute(
      this.policy.ghExecutable,
      ["api", HOST_OPTION, GITHUB_HOST, "--include", endpoint],
      {
        env: {
          PATH: TRANSPORT_PATH,
          GH_TOKEN: this.token,
          HOME: NO_HOME,
        },
        allowed: [0, 1],
        timeout: 30_000,
      }
    );
    const text = result.stdout.toString();
    const split = text.includes("\r\n\r\n") ? "\r\n\r\n" : "\n\n";
    const status = /^HTTP\/\S+ (\d+)\b/.exec(text);
    required(Boolean(status), "recovery provider status missing");
    if (status[1] === "404") return null;
    required(
      result.code === 0 && status[1] === "200",
      "recovery provider refused read"
    );
    return JSON.parse(text.slice(text.indexOf(split) + split.length));
  }
  async issue(number) {
    required(
      Number.isSafeInteger(number) && number > 0,
      "invalid live issue number"
    );
    const path = `repos/${this.policy.repository}/issues/${number}`;
    const issue = await this.request(path);
    issue.comments = await this.list(`${path}/comments`);
    issue.children = await this.list(`${path}/sub_issues`);
    issue.blockers = await this.list(`${path}/dependencies/blocked_by`);
    return issue;
  }
  async main(parent) {
    const repo = await this.request(`repos/${this.policy.repository}`);
    required(
      repo.full_name === this.policy.repository &&
        repo.default_branch === "main" &&
        String(repo.id) === this.policy.repositoryId &&
        String(repo.owner.id) === this.policy.ownerId,
      "actual repository identity differs"
    );
    const main = await this.request(
      `repos/${this.policy.repository}/git/ref/heads/main`
    );
    required(main.object?.sha === parent, "actual main parent changed");
    return repo;
  }
  async assignable(login) {
    const result = await this.execute(
      this.policy.ghExecutable,
      [
        "api",
        HOST_OPTION,
        GITHUB_HOST,
        "--include",
        `repos/${this.policy.repository}/assignees/${login}`,
      ],
      {
        env: {
          PATH: TRANSPORT_PATH,
          GH_TOKEN: this.token,
          HOME: NO_HOME,
        },
        timeout: 30_000,
      }
    );
    required(
      /^HTTP\/\S+ 204\b/m.test(result.stdout.toString()),
      "trusted maintainer is not currently assignable"
    );
  }
  /** Invoke the shipped tracker writer/validator, preserving configured full/trailer mode. */
  async workItem(cwd, args, authority) {
    required(
      ["backlink", "validate-pr"].includes(args[0]) &&
        args.every(value => typeof value === "string"),
      "unsupported traceability operation"
    );
    required(
      authority?.config && authority?.pr && authority?.descriptor,
      "authenticated publication controller authority is absent"
    );
    const phase =
      args[0] === "backlink"
        ? "publication-backlink"
        : "publication-validate-pr";
    return executeCanonicalHelper(
      { ...authority, cwd, token: this.token },
      phase,
      args[0],
      authority.pr,
      args
    );
  }
  /** Git API writes reproduce only the already qualified raw commit and complete tree. */
  async gitCommit(proposal, descriptor, commit, authorize, cwd) {
    const path = `repos/${this.policy.repository}/git`;
    const tree = [];
    for (const file of proposalFileNames(proposal)) {
      await authorize();
      const bytes = Buffer.from(proposal.files[file]);
      const blob = await this.request(`${path}/blobs`, "POST", {
        content: bytes.toString("base64"),
        encoding: "base64",
      });
      const sha = gitObjectId(cwd, "blob", bytes);
      required(blob.sha === sha, "provider blob bytes differ");
      tree.push({ path: file, mode: "100644", type: "blob", sha });
    }
    const parent = await this.request(`${path}/commits/${proposal.parent}`);
    await authorize();
    const built = await this.request(`${path}/trees`, "POST", {
      base_tree: parent.tree.sha,
      tree,
    });
    required(built.sha === descriptor.tree, "provider complete tree differs");
    await authorize();
    const created = await this.request(`${path}/commits`, "POST", {
      message: commit.message,
      tree: built.sha,
      parents: [proposal.parent],
      author: commit.author,
      committer: commit.committer,
    });
    required(
      created.sha === commit.sha,
      "provider raw commit cannot preserve the gated SHA"
    );
    return created;
  }
}
