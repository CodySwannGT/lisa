/**
 * The two steps a seeded third-party review evidence workflow ends with, as
 * the shipped seed has them, for `lisa doctor` to print to a copy that lacks
 * them.
 *
 * A copy seeded before CodySwannGT/lisa#4630 ends its job on the prover's
 * exit code, and its verdict is the job's own conclusion — which GitHub
 * attaches to the default branch's latest commit, never to the pull request
 * head it judged. The first step here saves the verdict and exit code instead,
 * and the second publishes the verdict as a check run on that head.
 *
 * The lines live apart from the check that prints them only because they are
 * long. They must stay the seed's own, byte for byte: the doctor's tests read
 * the shipped seed and require these lines in it, in this order.
 * @module cli/doctor-third-party-evidence-steps
 */

/** The prover step and the publish step, one line per entry. */
export const EVIDENCE_STEPS_LINES = [
  "      # The verdict is saved, with the prover's exit code, rather than ending",
  "      # the job: the next step publishes it on the head it judged.",
  "      - name: 🕵️ Prove review evidence, or a posted substitute, at this head",
  "        id: prove",
  "        env:",
  "          GH_TOKEN: ${{ github.token }}",
  "          GITHUB_REPOSITORY: ${{ github.repository }}",
  "          # The commit and the reviewer come from whichever event woke the",
  "          # run: a check run's head and name, or a status's commit and context.",
  "          EVIDENCE_SHA: ${{ github.event.check_run.head_sha || github.event.sha || inputs.sha }}",
  "          # Empty on the manual path, where nothing woke the run and every",
  "          # declared reviewer is evaluated.",
  "          EVIDENCE_CONTEXT: ${{ github.event.check_run.name || github.event.context }}",
  "        run: |",
  "          set -eu",
  "          script=scripts/check-third-party-review-evidence.mjs",
  '          if [ ! -f "$script" ]; then',
  '            echo "::error title=Review-evidence prover missing::$script does not exist, so no review evidence was read for this commit. An absent prover is a FAILURE, never a skip — a job that passes because it found nothing to run with is the same false green this guard exists to refuse."',
  "            exit 1",
  "          fi",
  '          verdict="$RUNNER_TEMP/third-party-review-verdict.json"',
  "          status=0",
  '          if [ -n "${EVIDENCE_CONTEXT:-}" ]; then',
  '            node "$script" --sha="$EVIDENCE_SHA" --context="$EVIDENCE_CONTEXT" --json >"$verdict" || status=$?',
  "          else",
  '            node "$script" --sha="$EVIDENCE_SHA" --json >"$verdict" || status=$?',
  "          fi",
  '          echo "prover=$script" >>"$GITHUB_OUTPUT"',
  '          echo "exit_code=$status" >>"$GITHUB_OUTPUT"',
  "",
  "      # Publishes the saved verdict as a check run on EVIDENCE_SHA, or nothing",
  "      # — saying why — when there is no pull request head to show it on or the",
  "      # run cannot change the answer. Not `continue-on-error`: a refused or",
  "      # impossible publish fails the job and prints GitHub's refusal, and so",
  "      # does a prover that crashed or saved no verdict.",
  "      - name: 🕵️ Publish the verdict on the head it judged",
  "        env:",
  "          GH_TOKEN: ${{ github.token }}",
  "          GITHUB_REPOSITORY: ${{ github.repository }}",
  "          EVIDENCE_SHA: ${{ github.event.check_run.head_sha || github.event.sha || inputs.sha }}",
  "          EVIDENCE_CONTEXT: ${{ github.event.check_run.name || github.event.context }}",
  "          PROVER: ${{ steps.prove.outputs.prover }}",
  "          PROVER_EXIT: ${{ steps.prove.outputs.exit_code }}",
  "        run: |",
  "          set -eu",
  '          node "$PROVER" --publish="$RUNNER_TEMP/third-party-review-verdict.json" --prover-exit="$PROVER_EXIT" --sha="$EVIDENCE_SHA" --context="${EVIDENCE_CONTEXT:-}"',
] as const;
