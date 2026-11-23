## Summary

<!-- What changed and why. Write it for a non-technical reader. -->

## Work item

<!--
Required. The Work-Item Traceability check reads this line and compares it to
the Work-Item trailer on every branch-authored commit — they must match.

List one Work-Item line for each item carried by the branch-authored commits.
The full pull request must declare exactly that set. Lines may sit anywhere
in the body, and repeating the same reference is harmless.

This repository declares workItem.verify = "full", so the referenced issue must
also be open, claimed (status:in-progress), scoped to this repository, and
carry a backlink to this pull request. A project that declares no level gets
"trailer": the reference above is proved and no tracker is contacted.

Format: owner/repo#123 (for example CodySwannGT/lisa#1978).
-->

Work-Item: CodySwannGT/lisa#0

## Safe to promote

<!--
One line, matching the work item's "Release Switch" section. Whatever is on
main can be released as it stands, so say which of these this change is:

  Live — complete and proven at merge
  Switched off — <switch-name> (where it is set, and that it is off in production)

Delete this section for a change with no runtime effect (docs, tests, tooling).
-->

## Verification

<!-- How you proved this works: commands run, output observed, tests added. -->
