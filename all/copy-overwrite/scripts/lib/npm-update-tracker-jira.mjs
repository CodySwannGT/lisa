// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * @file npm-update-tracker-jira.mjs
 * @description Jira REST v3 tracker adapter for the npm updater (CodySwannGT/lisa#4859).
 * Tickets are normalized into the GitHub-issue record the claim, hold, quality and
 * checkpoint checks already read; managed text is stored as one ADF code block.
 * @module npm-updater
 */
import { required } from "./npm-update-invariants.mjs";
import { sha256 } from "./github-attestation-verifier.mjs";
import { trackerContract } from "../lisa-work-item.mjs";
import {
  trackerCredentials,
  jsonCall,
  adfCodeBlock,
  adfText,
  adfProse,
  lifecycleName,
  vocabularyRefusal,
  withinJiraLimit,
  strandedRefusal,
  vendorLabels,
} from "./npm-update-tracker-wire.mjs";

const API = "/rest/api/3";
const FIELDS =
  "summary,description,status,issuetype,priority,labels,assignee,subtasks,issuelinks";

/** Done-category statuses are closed history, never claimable. */
function stateOf(status) {
  return status?.statusCategory?.key === "done" ? "closed" : "open";
}

/** Issue type and priority surface as the label names the shared checks require. */
function typeLabels(fields) {
  const type = fields.issuetype ?? {};
  return [
    type.subtask ? "type:Sub-task" : `type:${type.name}`,
    ...(fields.priority?.name === "Medium" ? ["priority:medium"] : []),
  ];
}

/** An account's comment is managed only when it is the API credential's own account. */
function commentRecord(comment) {
  return {
    id: String(comment.id),
    body: adfText(comment.body),
    prose: adfProse(comment.body),
    user: {
      id: comment.author?.accountId,
      type: comment.author?.accountType === "app" ? "Bot" : "User",
    },
  };
}

export class JiraTracker {
  constructor(config, env, transport = globalThis.fetch) {
    const credentials = trackerCredentials(config, env);
    this.provider = "jira";
    this.key = config.jira.project.trim().toUpperCase();
    this.lifecycle = trackerContract(config).lifecycle;
    this.baseUrl = credentials.baseUrl;
    this.authorization = credentials.authorization;
    this.transport = transport;
  }
  call(path, purpose, method = "GET", body) {
    return jsonCall(
      this.transport,
      `${this.baseUrl}${API}${path}`,
      { method, body, authorization: this.authorization },
      purpose
    );
  }
  ref(number) {
    return `${this.key}-${number}`;
  }
  /** The decimal ticket number of an exact key in the configured project. */
  numberOf(key) {
    const match = new RegExp(`^${this.key}-([1-9]\\d*)$`).exec(String(key));
    required(match, "tracker search reply differs");
    return Number(match[1]);
  }
  async myself() {
    this.accountId ??= (await this.call("/myself", "unclassified"))?.accountId;
    required(
      typeof this.accountId === "string",
      "tracker identity unavailable"
    );
    return this.accountId;
  }
  async issue(number) {
    required(
      Number.isSafeInteger(number) && number > 0,
      "invalid live issue number"
    );
    const ticket = await this.call(
      `/issue/${this.ref(number)}?fields=${FIELDS}`,
      "issue"
    );
    required(ticket?.key === this.ref(number), "live issue scope differs");
    const fields = ticket.fields ?? {};
    return {
      number,
      title: fields.summary,
      body: adfText(fields.description),
      state: stateOf(fields.status),
      labels: [
        lifecycleName(this.lifecycle, fields.status?.name),
        ...typeLabels(fields),
        ...vendorLabels(this.lifecycle, fields.labels),
      ].map(name => ({ name })),
      assignees: fields.assignee
        ? [
            {
              login: fields.assignee.accountId,
              type:
                fields.assignee.accountType === "atlassian" ? "User" : "App",
            },
          ]
        : [],
      comments: await this.comments(number),
      children: fields.subtasks ?? [],
      blockers: (fields.issuelinks ?? [])
        .filter(
          link => link.type?.inward === "is blocked by" && link.inwardIssue
        )
        .map(link => ({ state: stateOf(link.inwardIssue.fields?.status) })),
    };
  }
  async comments(number) {
    const entries = [];
    for (let page = 0; page < 20; page++) {
      const reply = await this.call(
        `/issue/${this.ref(number)}/comment?startAt=${entries.length}&maxResults=100`,
        "issue-comments"
      );
      required(Array.isArray(reply?.comments), "provider page is not an array");
      entries.push(...reply.comments.map(commentRecord));
      if (!reply.comments.length || entries.length >= reply.total)
        return entries;
    }
    throw new Error("npm updater: provider pagination exceeded bound");
  }
  async search(jql) {
    const reply = await this.call("/search/jql", "issue-search", "POST", {
      jql,
      fields: ["status"],
      maxResults: 100,
    });
    required(Array.isArray(reply?.issues), "tracker search reply differs");
    return {
      incomplete_results: reply.isLast !== true,
      total_count: reply.issues.length,
      items: reply.issues.map(item => ({
        number: this.numberOf(item.key),
        state: stateOf(item.fields?.status),
      })),
    };
  }
  /** The exact selection label, not full-text ranking, finds a prior proposal. */
  searchPrior(proposal) {
    return this.search(
      `project = "${this.key}" AND labels = "lisa-npm-${proposal.selectionKey}"`
    );
  }
  async relationships() {
    const query = `project = "${this.key}" AND (summary ~ "npm" OR description ~ "npm")`;
    return { ...(await this.search(query)), query };
  }
  async vocabulary() {
    const types = await this.call(
      `/project/${this.key}/statuses`,
      "unclassified"
    );
    const task = (Array.isArray(types) ? types : []).find(
      type => type.name === "Task"
    );
    const priorities = await this.call("/priority", "unclassified");
    return [
      ...(task ? ["type:Task"] : []),
      ...((Array.isArray(priorities) ? priorities : []).some(
        priority => priority.name === "Medium"
      )
        ? ["priority:medium"]
        : []),
      ...(task?.statuses ?? []).map(status =>
        lifecycleName(this.lifecycle, status.name)
      ),
    ];
  }
  async ensureRole() {
    throw vocabularyRefusal("Jira");
  }
  async createLeaf(draft, proposal) {
    const fields = {
      project: { key: this.key },
      issuetype: { name: "Task" },
      summary: draft.title,
      description: adfCodeBlock(withinJiraLimit(draft.body)),
      labels: [`lisa-npm-${proposal.selectionKey}`],
      priority: { name: "Medium" },
      assignee: { accountId: draft.assignees[0] },
    };
    const created = await this.call("/issue", "issue", "POST", { fields });
    const number = this.numberOf(created?.key);
    try {
      await this.moveTo(number, this.lifecycle.ready);
    } catch {
      throw strandedRefusal(this.ref(number), this.lifecycle.ready);
    }
    return { number };
  }
  /** Exactly one workflow transition must reach the named status; none is ever guessed. */
  async moveTo(number, name) {
    const current = await this.call(
      `/issue/${this.ref(number)}?fields=status`,
      "issue"
    );
    if (current?.fields?.status?.name?.toLowerCase() === name.toLowerCase())
      return;
    const path = `/issue/${this.ref(number)}/transitions`;
    const options = (await this.call(path, "issue"))?.transitions ?? [];
    const matches = options.filter(
      option => option.to?.name?.toLowerCase() === name.toLowerCase()
    );
    if (matches.length !== 1) throw vocabularyRefusal("Jira");
    await this.call(path, "issue", "POST", {
      transition: { id: matches[0].id },
    });
  }
  async assignable(accountId) {
    const users = await this.call(
      `/user/assignable/search?project=${encodeURIComponent(this.key)}&accountId=${encodeURIComponent(accountId)}`,
      "unclassified"
    );
    required(
      Array.isArray(users) &&
        users.length === 1 &&
        users[0].accountId === accountId &&
        users[0].active === true,
      "trusted maintainer is not currently assignable"
    );
  }
  async assign(number, accountId) {
    await this.call(`/issue/${this.ref(number)}/assignee`, "issue", "PUT", {
      accountId,
    });
  }
  async transition(issue, roles) {
    await this.moveTo(issue.number, roles.claimed);
  }
  async comment(number, text) {
    const created = await this.call(
      `/issue/${this.ref(number)}/comment`,
      "issue-comments",
      "POST",
      { body: adfCodeBlock(withinJiraLimit(text)) }
    );
    required(
      /^[1-9]\d*$/.test(String(created?.id)) && adfText(created.body) === text,
      "checkpoint write readback differs"
    );
    return created;
  }
  /** The issue-scoped comment path is itself the scope proof: Jira answers 404 elsewhere. */
  async durableComment(number, text) {
    const created = await this.comment(number, text);
    const read = await this.call(
      `/issue/${this.ref(number)}/comment/${created.id}`,
      "issue-comment"
    );
    required(
      String(read?.id) === String(created.id) && adfText(read.body) === text,
      "checkpoint immediate readback differs"
    );
  }
  /** The credential's own account, whether a person or an app/service account. */
  async isManagedActor(user) {
    return typeof user?.id === "string" && user.id === (await this.myself());
  }
  async proveClaim(descriptor) {
    const number = this.numberOf(descriptor.workItem);
    required(
      /^[1-9]\d*$/.test(String(descriptor.claimCommentId)),
      "current tracker claim differs"
    );
    const comment = await this.call(
      `/issue/${this.ref(number)}/comment/${descriptor.claimCommentId}`,
      "issue-comment"
    );
    required(
      String(comment?.id) === descriptor.claimCommentId &&
        comment.author?.accountId === (await this.myself()) &&
        sha256(adfText(comment.body)) === descriptor.claimSha256,
      "current tracker claim differs"
    );
  }
}
