#!/usr/bin/env node
/**
 * Put back a link whose blocker reopened between the confirm and the delete
 * (CodySwannGT/lisa#5065).
 *
 * No tracker offers a conditional delete ("remove this link only while its
 * blocker is still finished"), so the confirm re-read leaves a window of
 * seconds in which a person can reopen the blocker. After the delete, the
 * writer reads each removed blocker again. A blocker that is no longer safe
 * to delete (reopened, moved back to an intermediate done rung, or unreadable)
 * gets its link recreated, no marker, and a line in the report; only the
 * removals whose blocker is still finished are confirmed.
 *
 * Pure: it judges and returns the vendor actions, and the writer performs
 * them through the access layers.
 * @module stale-blocker-restore
 */

import {
  blockerResolution,
  githubBlockerEdges,
  isRemovable,
  jiraBlockerEdges,
  linearBlockerEdges,
} from "./stale-blocker-edges.mjs";

/**
 * @param {unknown} value
 * @returns {string}
 */
const text = value => (typeof value === "string" ? value : "");

/**
 * The verdict for one removed blocker as read NOW. A blocker with no read is
 * inaccessible, which is never safe to delete.
 * @param {string} tracker
 * @param {{ ref: string, project: string, repo: string }} item
 * @param {string} ref - The blocker
 * @param {Record<string, any> | null | undefined} raw - The blocker as read now
 * @param {{ doneRoles: readonly string[], landedRoles?: readonly string[] }} roles
 * @returns {string} Verdict
 */
function verdictNow(tracker, item, ref, raw, roles) {
  const [edge] =
    tracker === "github"
      ? githubBlockerEdges({
          repo: item.repo,
          body: `Blocked by ${ref}`,
          bodyBlockers: raw ? { [ref]: raw } : {},
        })
      : tracker === "jira"
        ? jiraBlockerEdges({
            fields: {
              issuelinks: [
                {
                  id: "now",
                  type: { inward: "is blocked by" },
                  inwardIssue: raw ?? { key: ref },
                },
              ],
            },
          })
        : linearBlockerEdges({
            inverseRelations: [
              { id: "now", type: "blocks", issue: raw ?? { identifier: ref } },
            ],
          });
  return blockerResolution(
    edge,
    roles.doneRoles,
    item.project,
    roles.landedRoles
  );
}

/**
 * The `Blocked by` line that names these refs again, short where local.
 * @param {string} body - The body as read back
 * @param {readonly string[]} refs - Canonical refs
 * @param {string} repo - The item's own repo
 * @returns {string}
 */
function bodyWithRefs(body, refs, repo) {
  const own = `${repo}#`;
  const line = `Blocked by ${refs
    .map(ref => (ref.startsWith(own) ? `#${ref.slice(own.length)}` : ref))
    .join(", ")}`;
  return body.trim() === "" ? line : `${body.replace(/\s+$/u, "")}\n\n${line}`;
}

/**
 * The vendor actions that recreate these links.
 * @param {string} tracker
 * @param {{ ref: string, repo: string, body: string }} item - As read back
 * @param {readonly { blockerRef: string, source: string, actionId: string, linkType?: string }[]} links
 * @returns {object[]}
 */
function restoreActions(tracker, item, links) {
  if (tracker === "jira") {
    return links.map(link => ({
      op: "link",
      from: link.blockerRef,
      to: item.ref,
      type: link.linkType || "Blocks",
    }));
  }
  if (tracker === "linear") {
    return links.map(link => ({
      op: "create-relation",
      issue: link.blockerRef,
      relatedIssue: item.ref,
      type: "blocks",
    }));
  }
  const number = item.ref.split("#")[1];
  const native = links
    .filter(link => link.source === "github-native")
    .map(link => ({
      op: "add-dependency",
      endpoint: `repos/${item.repo}/issues/${number}/dependencies/blocked_by`,
      issueId: link.actionId,
    }));
  const bodyRefs = links
    .filter(link => link.source === "github-body")
    .map(link => link.blockerRef);
  return bodyRefs.length === 0
    ? native
    : [
        ...native,
        { op: "body", body: bodyWithRefs(item.body, bodyRefs, item.repo) },
      ];
}

/**
 * Split the removals the read-back shows gone into those whose blocker is
 * still finished (confirmed) and those to put back.
 * @param {{
 *   tracker: "github" | "jira" | "linear",
 *   item: { ref: string, project: string, repo: string, body: string },
 *   gone: readonly string[],
 *   links: readonly { blockerRef: string, source: string, actionId: string, linkType?: string }[],
 *   blockersNow: Record<string, Record<string, any> | null>,
 *   doneRoles: readonly string[],
 *   landedRoles?: readonly string[],
 * }} input - `blockersNow` holds each removed blocker as read after the delete
 * @returns {{ confirmed: string[], restored: { blockerRef: string, verdict: string }[], restore: object[] }}
 */
export function splitReopened(input) {
  const verdicts = new Map(
    input.gone.map(ref => [
      ref,
      verdictNow(
        input.tracker,
        input.item,
        ref,
        input.blockersNow?.[ref] ?? null,
        input
      ),
    ])
  );
  const reopened = input.gone.filter(
    ref => !isRemovable(text(verdicts.get(ref)))
  );
  const back = new Set(reopened);
  return {
    confirmed: input.gone.filter(ref => !back.has(ref)),
    restored: reopened.map(ref => ({
      blockerRef: ref,
      verdict: text(verdicts.get(ref)),
    })),
    restore: restoreActions(
      input.tracker,
      input.item,
      input.links.filter(link => back.has(link.blockerRef))
    ),
  };
}
