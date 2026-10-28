/** Mutations of native-shaped proof facts, separate from product validation. */

import { editAsset, editNative } from "./work-item-proof-mutations.js";
import type { Denial } from "./work-item-proof-mutations.js";
export type { Denial, ProofFixture } from "./work-item-proof-mutations.js";
export { editNative } from "./work-item-proof-mutations.js";
import { commit } from "./work-item-cli.js";
import {
  putAsset,
  setApi,
  setCompare,
  SPEC,
} from "./work-item-proof-fixture.js";

const PENDING_PROOF = "pending-proof";
const INVALID_PROOF = "invalid-proof";
const DELIVERY_RUN = "repos/acme/code/actions/runs/31";

const noop = () => {};
export const DENIALS: Denial[] = [
  {
    name: "pending accepted-record state",
    category: PENDING_PROOF,
    change: fixture => {
      fixture.record.state = "pending";
    },
  },
  {
    name: "revoked accepted-record state",
    category: INVALID_PROOF,
    change: fixture => {
      fixture.record.state = "revoked";
    },
  },
  {
    name: "wrong native work item",
    category: INVALID_PROOF,
    change: fixture => {
      fixture.record.subject.native_id = "I_other";
    },
  },
  {
    name: "wrong primary source head",
    category: INVALID_PROOF,
    change: fixture => {
      fixture.record.source.pr_head = "f".repeat(40);
    },
  },
  {
    name: "wrong delivered artifact source",
    category: INVALID_PROOF,
    change: fixture => {
      fixture.record.source.delivered_sha = "f".repeat(40);
    },
  },
  {
    name: "empty native typed attachment",
    category: INVALID_PROOF,
    change: fixture => {
      putAsset(fixture, 1, Buffer.alloc(0));
    },
  },
  {
    name: "wrong actual typed capture",
    category: INVALID_PROOF,
    change: fixture => {
      Object.assign(
        fixture.record.evidence[0]!,
        putAsset(fixture, 1, { status: "pass" })
      );
    },
  },
  {
    name: "failed verification verdict",
    category: INVALID_PROOF,
    change: fixture => {
      Object.assign(
        fixture.record.verdicts[0]!,
        editAsset(fixture, 2, value => {
          value.status = "fail";
        })
      );
    },
  },
  {
    name: "malformed claim array",
    category: INVALID_PROOF,
    change: fixture => {
      Object.assign(
        fixture.record.verdicts[0]!,
        editAsset(fixture, 2, value => {
          value.claims = "claimed success";
        })
      );
    },
  },
  {
    name: "required claim not established",
    category: INVALID_PROOF,
    change: fixture => {
      Object.assign(
        fixture.record.verdicts[0]!,
        editAsset(fixture, 2, value => {
          value.claims[0].status = "not-established";
        })
      );
    },
  },
  {
    name: "partial required AND group",
    category: INVALID_PROOF,
    change: fixture => {
      fixture.record.requirements[0]!.claim_ids.push("C-missing-conjunct");
    },
  },
  {
    name: "optional claim offered as a required conjunct",
    category: INVALID_PROOF,
    change: fixture => {
      Object.assign(
        fixture.record.verdicts[0]!,
        editAsset(fixture, 2, value => {
          value.claims.push({
            ...value.claims[0],
            claim_id: "C-other-required",
          });
          value.claims[0].required_for_gate = false;
        })
      );
    },
  },
  {
    name: "global attachment absent from own verdict evidence",
    category: INVALID_PROOF,
    change: fixture => {
      Object.assign(
        fixture.record.verdicts[0]!,
        editAsset(fixture, 2, value => {
          value.evidence = [];
        })
      );
    },
  },
  {
    name: "missing local typed marker attachment",
    category: INVALID_PROOF,
    change: fixture => {
      fixture.record.manifest = [];
    },
  },
  {
    name: "missing canonical Verify usage",
    category: INVALID_PROOF,
    change: fixture => {
      editNative(fixture, state => {
        state.body = SPEC;
      });
    },
  },
  {
    name: "primary PR not backlinked",
    category: INVALID_PROOF,
    change: noop,
    afterAttach: fixture => {
      editNative(fixture, state => {
        state.comments = state.comments.filter(
          (row: { id: number }) => row.id !== 1
        );
      });
    },
  },
  {
    name: "actual conformance diverges",
    category: INVALID_PROOF,
    change: fixture => {
      Object.assign(
        fixture.record.obligations.conformance.report,
        editAsset(fixture, 3, value => {
          value.verdict = "DIVERGES";
        })
      );
    },
  },
  {
    name: "whole delivery workflow failed",
    category: INVALID_PROOF,
    change: fixture => {
      setApi(fixture, ["api", DELIVERY_RUN], {
        json: {
          id: 31,
          repository: { id: 881 },
          workflow_id: 22,
          path: ".github/workflows/deploy.yml",
          event: "push",
          head_branch: "main",
          head_sha: fixture.merge,
          run_attempt: 1,
          status: "completed",
          conclusion: "failure",
        },
      });
    },
  },
  {
    name: "whole delivery workflow still pending",
    category: PENDING_PROOF,
    change: fixture => {
      setApi(fixture, ["api", DELIVERY_RUN], {
        json: {
          id: 31,
          repository: { id: 881 },
          workflow_id: 22,
          path: ".github/workflows/deploy.yml",
          event: "push",
          head_branch: "main",
          head_sha: fixture.merge,
          run_attempt: 1,
          status: "in_progress",
          conclusion: null,
        },
      });
    },
  },
  {
    name: "green auxiliary workflow is not deployment",
    category: INVALID_PROOF,
    change: fixture => {
      setApi(fixture, ["api", DELIVERY_RUN], {
        json: {
          id: 31,
          repository: { id: 881 },
          workflow_id: 22,
          path: ".github/workflows/quality.yml",
          event: "push",
          head_branch: "main",
          head_sha: fixture.merge,
          run_attempt: 1,
          status: "completed",
          conclusion: "success",
        },
      });
    },
  },
  {
    name: "newer same-item source awaits proof",
    category: PENDING_PROOF,
    change: fixture => {
      const newer = commit(
        fixture,
        "fix: newer behavior\n\nWork-Item: acme/code#42\n"
      );
      setApi(fixture, ["api", "repos/acme/code/branches/main"], {
        json: { commit: { sha: newer } },
      });
      setCompare(fixture, fixture.merge, newer);
    },
  },
  {
    name: "unknown primary section was edited",
    category: INVALID_PROOF,
    change: fixture => {
      editNative(fixture, state => {
        state.body +=
          "\n## Additional requirement\nRetain this new behavior.\n";
      });
    },
  },
  {
    name: "record digest mismatch",
    category: INVALID_PROOF,
    change: noop,
    afterAttach: fixture => {
      putAsset(fixture, 4, { not: "the accepted bytes" });
    },
  },
  {
    name: "record attachment unreadable",
    category: "read-error",
    change: noop,
    afterAttach: fixture => {
      setApi(fixture, ["api", "repos/acme/code/releases/assets/4"], {
        failure: "gh: service unavailable (HTTP 503)\n",
      });
    },
  },
  {
    name: "malformed accepted JSON with matching digest",
    category: INVALID_PROOF,
    change: noop,
    afterAttach: fixture => {
      const pointer = putAsset(fixture, 4, Buffer.from("{"));
      editNative(fixture, state => {
        const comment = state.comments.find(
          (row: { id: number }) => row.id === 2
        );
        const locator = JSON.parse(comment.body.split("\n")[1]);
        locator.sha256 = pointer.sha256;
        comment.body = `[lisa-completion-authorization]\n${JSON.stringify(locator)}`;
      });
    },
  },
];
