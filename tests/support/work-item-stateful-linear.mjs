#!/usr/bin/env node
/** Native-shaped Linear provider; never contacts Linear or follows a URL. */
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

const env = process.env;
const config = readFileSync(0, "utf8");
const line = config.split("\n").find(row => row.startsWith("data-binary = "));
const request = line
  ? JSON.parse(JSON.parse(line.slice("data-binary = ".length)))
  : {};
const { query = "", variables = {} } = request;
const mutation = /^mutation\b/.test(query);
const file = env.FAKE_LINEAR_STATE_FILE;
const issue = JSON.parse(readFileSync(file, "utf8"));
const actor = { id: "linear-publisher" };
appendFileSync(env.FAKE_LINEAR_LOG, `${JSON.stringify(request)}\n`);
if (mutation)
  appendFileSync(env.FAKE_GH_WRITES_FILE, `${JSON.stringify(request)}\n`);
const send = data => process.stdout.write(`${JSON.stringify({ data })}\n`);
const save = () => writeFileSync(file, JSON.stringify(issue));

if (query === "query{viewer{id}}") send({ viewer: actor });
else if (mutation && query.includes("commentCreate(input:")) {
  const comment = {
    id: `comment-${issue.comments.nodes.length}`,
    body: variables.input.body,
    user: actor,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  issue.comments.nodes.push(comment);
  save();
  send({ commentCreate: { success: true, comment } });
} else if (mutation && query.includes("issueUpdate(id:")) {
  issue.state = issue.team.states.nodes.find(
    row => row.id === variables.stateId
  );
  save();
  send({ issueUpdate: { success: true, issue } });
} else if (
  !mutation &&
  query.includes("issue(id:") &&
  variables.id === issue.identifier
) {
  const all = issue.comments.nodes;
  const page =
    variables.after === "page-2" ? all.slice(100) : all.slice(0, 100);
  const more = variables.after !== "page-2" && all.length > 100;
  send({
    issue: {
      ...issue,
      comments: {
        nodes: page,
        pageInfo: {
          hasNextPage: more,
          endCursor: more ? "page-2" : null,
        },
      },
    },
  });
} else {
  appendFileSync(
    env.FAKE_GH_UNHANDLED_FILE,
    `${JSON.stringify({ request, mutation })}\n`
  );
  process.stderr.write("Unsupported controlled Linear operation\n");
  process.exitCode = 70;
}
