set -eu

# The consumer-side half of a two-party contract (CodySwannGT/lisa#3698).
#
# Every consumer reference to a Lisa reusable workflow tracks `@main` by ruling,
# not by accident. So this workflow changes under a consumer between two runs of
# one pull request, with no PR, no review and no record in their repository.
# That is intended. What was missing is any way for them to TELL: an unchanged
# workflow and a rewritten one produced the same silence, and an investigation
# that fetched `@main` afterwards was reading a different artifact than the run
# it was investigating and could not know it.
#
# This step is the signal, and it deliberately asserts the CONTRACT rather than
# the ref. Asserting the ref — a tag, a SHA, a tree hash — goes red on every
# legitimate upstream change and is deleted within a week, which is how a
# staleness check becomes a staleness problem. The major asserts the property a
# caller actually depends on: "the inputs and behaviour you were seeded against
# still hold". A compatible change stays green, because receiving compatible
# changes is the entire point of tracking `@main`; only a declared break speaks.
echo "workflow:                                  ${WORKFLOW_FILE}"
echo "contract major declared by this revision:  ${DECLARED_MAJOR}"
echo "contract major the caller was seeded with: ${EXPECTED_MAJOR:-<none passed>}"

# NOT DETERMINED, said out loud.
#
# A caller that passes nothing is not failed. Caller workflows ship create-only
# and are never overwritten, so every consumer seeded before this shipped passes
# nothing — while this workflow is live in all of them on their next run.
# Failing closed here would redden the entire fleet over a file Lisa cannot
# update on their behalf: the two-channel mistake this handshake exists to
# catch, committed in the other direction.
#
# It must not be SILENT either. Silence is the defect. So the run says plainly
# that it measured nothing, and says what to add.
case "${EXPECTED_MAJOR}" in
  '' | *[!0-9]*)
    echo "::warning title=Workflow contract NOT DETERMINED::This run cannot tell whether ${WORKFLOW_FILE} changed under you. Its caller passed expected_workflow_contract_major='${EXPECTED_MAJOR}', which is not a whole number, so there is nothing to compare against the major ${DECLARED_MAJOR} this revision declares. Add 'expected_workflow_contract_major: ${DECLARED_MAJOR}' to the 'with:' block beside your 'uses: ...@main' line. Until you do, this check is measuring nothing and its green means only that."
    exit 0
    ;;
esac

if [ "${EXPECTED_MAJOR}" != "${DECLARED_MAJOR}" ]; then
  echo "::error title=Workflow contract mismatch::${WORKFLOW_FILE} on @main declares contract major ${DECLARED_MAJOR}; this caller was seeded against major ${EXPECTED_MAJOR}. A major bump is Lisa stating that an input or a behaviour you depend on changed in a way you must react to. Read the workflow header for what moved, update this caller, then set expected_workflow_contract_major: ${DECLARED_MAJOR}."
  exit 1
fi

echo "contract major ${DECLARED_MAJOR} agreed: ${WORKFLOW_FILE} has not declared a break under this caller."
