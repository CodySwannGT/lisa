// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * @file npm-update-tracker-linear.mjs
 * @description Linear GraphQL tracker adapter for the npm updater (CodySwannGT/lisa#4859).
 * Issues are normalized into the GitHub-issue record the claim, hold, quality and
 * checkpoint checks already read; managed text is stored inside one exact fence.
 * @module npm-updater
 */
import { required } from "./npm-update-invariants.mjs";
import { sha256 } from "./github-attestation-verifier.mjs";
import { trackerContract } from "../lisa-work-item.mjs";
import {
  trackerCredentials,
  jsonCall,
  fence,
  unfence,
  lifecycleName,
  vocabularyRefusal,
  vendorLabels,
  linearClosed as closed,
  linearSearchResult as searchResult,
  completeLinearConnections as completeConnections,
} from "./npm-update-tracker-wire.mjs";

const VIEWER = "query LisaNpmViewer { viewer { id } }";
const TEAM =
  "query LisaNpmTeam($key: String!) { teams(filter: { key: { eq: $key } }) { nodes { id key states { nodes { id name type } } } } }";
const MEMBER =
  "query LisaNpmMember($id: String!, $key: String!) { user(id: $id) { id active teams(filter: { key: { eq: $key } }) { nodes { id } } } }";
const ISSUES =
  "query LisaNpmIssues($filter: IssueFilter!) { issues(filter: $filter, first: 100, includeArchived: true) { nodes { number archivedAt state { type } } pageInfo { hasNextPage } } }";
const ISSUE =
  "query LisaNpmIssue($id: String!) { issue(id: $id) { id identifier number title description priority archivedAt state { name type } assignee { id } labels(first: 100) { nodes { name } pageInfo { hasNextPage } } children(first: 100) { nodes { id } pageInfo { hasNextPage } } inverseRelations(first: 100) { nodes { type issue { state { type } archivedAt } } pageInfo { hasNextPage } } } }";
const COMMENTS =
  "query LisaNpmComments($id: String!, $after: String) { issue(id: $id) { comments(first: 100, after: $after) { nodes { id body user { id } botActor { id } } pageInfo { hasNextPage endCursor } } } }";
const COMMENT =
  "query LisaNpmComment($id: String!) { comment(id: $id) { id body user { id } issue { identifier } } }";
const CREATE =
  "mutation LisaNpmIssueCreate($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { number identifier } } }";
const UPDATE =
  "mutation LisaNpmIssueUpdate($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success } }";
const COMMENT_CREATE =
  "mutation LisaNpmCommentCreate($input: CommentCreateInput!) { commentCreate(input: $input) { success comment { id body issue { identifier } } } }";
/** Linear's priority scale: 3 is Medium. */
const MEDIUM = 3;

/** The API key's own user is the only identity a Linear write can prove. */
function commentRecord(node) {
  return {
    id: node.id,
    body: unfence(node.body),
    user: node.user
      ? { id: node.user.id, type: "User" }
      : { id: node.botActor?.id, type: "Bot" },
  };
}

export class LinearTracker {
  constructor(config, env, transport = globalThis.fetch) {
    const credentials = trackerCredentials(config, env);
    this.provider = "linear";
    this.key = config.linear.teamKey.trim().toUpperCase();
    this.lifecycle = trackerContract(config).lifecycle;
    this.url = credentials.baseUrl;
    this.authorization = credentials.authorization;
    this.transport = transport;
    this.ids = new Map();
  }
  async graphql(query, variables, purpose) {
    const reply = await jsonCall(
      this.transport,
      this.url,
      {
        method: "POST",
        authorization: this.authorization,
        body: { query, variables },
      },
      purpose
    );
    required(
      reply && !reply.errors && reply.data,
      "tracker provider refused request"
    );
    return reply.data;
  }
  /** One operation's single top-level field. */
  async field(query, variables, name) {
    return (await this.graphql(query, variables, "unclassified"))[name];
  }
  ref(number) {
    return `${this.key}-${number}`;
  }
  async viewer() {
    this.viewerId ??= (
      await this.graphql(VIEWER, {}, "unclassified")
    ).viewer?.id;
    required(typeof this.viewerId === "string", "tracker identity unavailable");
    return this.viewerId;
  }
  async team() {
    if (this.teamNode) return this.teamNode;
    const nodes = (await this.graphql(TEAM, { key: this.key }, "repository"))
      .teams?.nodes;
    required(
      Array.isArray(nodes) && nodes.length === 1 && nodes[0].key === this.key,
      "configured Linear team differs"
    );
    this.teamNode = nodes[0];
    return this.teamNode;
  }
  async stateId(name) {
    const matches = (await this.team()).states.nodes.filter(
      state => state.name.toLowerCase() === name.toLowerCase()
    );
    if (matches.length !== 1) throw vocabularyRefusal("Linear");
    return matches[0].id;
  }
  /** Mutations address the issue by its stable id, learned from an exact identifier read. */
  async issueId(number) {
    if (!this.ids.has(number)) await this.issue(number);
    return this.ids.get(number);
  }
  async issue(number) {
    required(
      Number.isSafeInteger(number) && number > 0,
      "invalid live issue number"
    );
    const node = (await this.graphql(ISSUE, { id: this.ref(number) }, "issue"))
      .issue;
    required(
      node?.identifier === this.ref(number) && node.number === number,
      "live issue scope differs"
    );
    completeConnections(node);
    this.ids.set(number, node.id);
    return {
      number,
      title: node.title,
      body: unfence(node.description),
      state: closed(node) ? "closed" : "open",
      labels: [
        lifecycleName(this.lifecycle, node.state?.name),
        "type:Task",
        ...(node.priority === MEDIUM ? ["priority:medium"] : []),
        ...vendorLabels(
          this.lifecycle,
          (node.labels?.nodes ?? []).map(label => label.name)
        ),
      ].map(name => ({ name })),
      assignees: node.assignee
        ? [{ login: node.assignee.id, type: "User" }]
        : [],
      comments: await this.comments(number),
      children: node.children?.nodes ?? [],
      blockers: (node.inverseRelations?.nodes ?? [])
        .filter(relation => relation.type === "blocks")
        .map(relation => ({
          state: closed(relation.issue) ? "closed" : "open",
        })),
    };
  }
  async comments(number) {
    const entries = [];
    let after = null;
    for (let page = 1; page <= 20; page++) {
      const connection = (
        await this.graphql(
          COMMENTS,
          { id: this.ref(number), after },
          "issue-comments"
        )
      ).issue?.comments;
      required(
        Array.isArray(connection?.nodes),
        "provider page is not an array"
      );
      entries.push(...connection.nodes.map(commentRecord));
      if (!connection.pageInfo?.hasNextPage) return entries;
      after = connection.pageInfo.endCursor;
    }
    throw new Error("npm updater: provider pagination exceeded bound");
  }
  async searchPrior(proposal) {
    const filter = {
      team: { key: { eq: this.key } },
      description: { contains: `Selection key: ${proposal.selectionKey}` },
    };
    return searchResult(
      (await this.graphql(ISSUES, { filter }, "issue-search")).issues
    );
  }
  async relationships() {
    const filter = {
      team: { key: { eq: this.key } },
      or: [
        { title: { containsIgnoreCase: "npm" } },
        { description: { containsIgnoreCase: "npm" } },
      ],
    };
    return {
      ...searchResult(
        (await this.graphql(ISSUES, { filter }, "issue-search")).issues
      ),
      query: `Linear team ${this.key}: title or description contains "npm", all states`,
    };
  }
  async vocabulary() {
    const states = (await this.team()).states.nodes.map(state =>
      lifecycleName(this.lifecycle, state.name)
    );
    return ["type:Task", "priority:medium", ...states];
  }
  async ensureRole() {
    throw vocabularyRefusal("Linear");
  }
  async createLeaf(draft) {
    const input = {
      teamId: (await this.team()).id,
      title: draft.title,
      description: fence(draft.body),
      stateId: await this.stateId(this.lifecycle.ready),
      priority: MEDIUM,
      assigneeId: draft.assignees[0],
    };
    const created = (await this.graphql(CREATE, { input }, "issue"))
      .issueCreate;
    const number = created?.issue?.number;
    required(
      created?.success === true &&
        Number.isSafeInteger(number) &&
        created.issue.identifier === this.ref(number),
      "tracker create readback differs"
    );
    return { number };
  }
  async assignable(maintainer) {
    const user = await this.field(
      MEMBER,
      { id: maintainer, key: this.key },
      "user"
    );
    required(
      user?.id === maintainer &&
        user.active === true &&
        user.teams?.nodes?.length === 1,
      "trusted maintainer is not currently assignable"
    );
  }
  async update(number, input) {
    const id = await this.issueId(number);
    const reply = await this.graphql(UPDATE, { id, input }, "issue");
    required(reply.issueUpdate?.success === true, "tracker update refused");
  }
  async assign(number, maintainer) {
    await this.update(number, { assigneeId: maintainer });
  }
  async transition(issue, roles) {
    await this.update(issue.number, {
      stateId: await this.stateId(roles.claimed),
    });
  }
  async comment(number, text) {
    const input = { issueId: await this.issueId(number), body: fence(text) };
    const created = (
      await this.graphql(COMMENT_CREATE, { input }, "issue-comments")
    ).commentCreate;
    required(
      created?.success === true &&
        created.comment?.issue?.identifier === this.ref(number) &&
        created.comment.body === fence(text),
      "checkpoint write readback differs"
    );
    return created.comment;
  }
  async durableComment(number, text) {
    const created = await this.comment(number, text);
    const read = await this.field(COMMENT, { id: created.id }, "comment");
    required(
      read?.id === created.id &&
        read.issue?.identifier === this.ref(number) &&
        read.body === fence(text),
      "checkpoint immediate readback differs"
    );
  }
  async isManagedActor(user) {
    return user?.type === "User" && user.id === (await this.viewer());
  }
  async proveClaim(descriptor) {
    const id = descriptor.claimCommentId;
    const comment = await this.field(COMMENT, { id }, "comment");
    required(
      comment?.id === descriptor.claimCommentId &&
        comment.issue?.identifier === descriptor.workItem &&
        comment.user?.id === (await this.viewer()) &&
        typeof comment.body === "string" &&
        sha256(unfence(comment.body)) === descriptor.claimSha256,
      "current tracker claim differs"
    );
  }
}
