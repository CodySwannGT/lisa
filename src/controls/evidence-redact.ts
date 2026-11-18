/**
 * Taking secret values out of evidence before it is written.
 *
 * An evidence record keeps what a program did: the arguments it was started
 * with, the end of what it printed, and a sentence that may quote why it
 * could not be started. A program can print anything, including a token it
 * was given. That text is captured, not written by anyone, and a proof run
 * must not fail and lose its result because a tool echoed a credential. So
 * here the value is taken out and the run goes on: the record keeps a
 * placeholder such as `[REDACTED:GITHUB_TOKEN]` where the value was, which
 * is how it says that something was removed and what it was shaped like.
 *
 * It happens before the evidence file is written and before anything is
 * computed from it. The verdict's digest covers the file as written, so the
 * digest is of the text with the placeholder in it.
 *
 * The fields that name what a record is about (its id, its entry, its
 * folder, its requirement, its commit) are not rewritten here: they come
 * from the control register, which refuses a declaration that holds a
 * secret's value, and a record whose id no longer matched its own fields
 * would be refused when it is read back. If one of them ever held a
 * credential shape, the last check before the write (`./control-files.ts`)
 * stops the file.
 * @module controls/evidence-redact
 */
import type {
  EvidenceBatch,
  EvidenceRecord,
  EvidenceResultInput,
} from "./evidence-types.js";
import { redactArguments, redactCredentials } from "./secret-scan.js";
import { describeCredentialKind } from "./secret-shapes.js";

/**
 * Take every credential-shaped value out of what a check printed.
 * @param output - What was kept of the check's output
 * @returns The same text with a placeholder where each value was
 */
export function outputWithoutSecretValues(output: string): string {
  return redactCredentials(output).text;
}

/**
 * Take every credential-shaped value out of the captured text of a record.
 *
 * A record that holds none comes back as the same object.
 * @param record - A record about to be written, or one an earlier run wrote
 * @returns The record with a placeholder where each value was
 */
export function recordWithoutSecretValues(
  record: EvidenceRecord
): EvidenceRecord {
  const reason = redactCredentials(record.reason);
  const detail = redactCredentials(record.detail);
  const output = redactCredentials(record.output_excerpt);
  const command = redactArguments(record.command ?? []);
  const taken = [reason, detail, output, command].some(
    each => each.kinds.length > 0
  );
  return taken
    ? {
        ...record,
        reason: reason.text,
        detail: detail.text,
        command: record.command === null ? null : [...command.argv],
        output_excerpt: output.text,
      }
    : record;
}

/**
 * Say what the captured text of one result is shaped like, where it holds a
 * credential shape.
 * @param result - One result a step handed to the evidence writer
 * @returns Each kind once; empty when the result holds none
 */
function kindsIn(result: EvidenceResultInput): readonly string[] {
  return [
    ...new Set([
      ...redactCredentials(result.reason).kinds,
      ...redactCredentials(result.detail).kinds,
      ...redactArguments(result.command ?? []).kinds,
      ...redactCredentials(result.output_excerpt).kinds,
    ]),
  ];
}

/**
 * Tell the operator that a check showed a credential, when one did.
 *
 * Taking the value out keeps it from being published. It does not undo the
 * fact that a program printed it, which the operator has to hear about: the
 * line names each result and what the value was shaped like, never the
 * value.
 * @param batches - What each step of this run found out
 * @returns The line, or `null` when no result held a credential shape
 */
export function echoedCredentialNote(
  batches: readonly EvidenceBatch[]
): string | null {
  const echoed = batches
    .flatMap(batch => batch.results)
    .flatMap(result => {
      const shapes = kindsIn(result)
        .map(kind => describeCredentialKind(kind))
        .join(", ");
      return shapes === ""
        ? []
        : [
            `the ${result.half ?? result.rung} result for ${result.entry_id} at ${result.moment} (${shapes})`,
          ];
    });
  if (echoed.length === 0) return null;
  const [checks, were] =
    echoed.length > 1
      ? [`${echoed.length} checks`, "were"]
      : ["a check", "was"];
  return `Something shaped like a credential was in what ${checks} printed or ${were} started with: ${echoed.join("; ")}. Each value was taken out before anything was written and is not kept anywhere; a placeholder marks where it was. Find out why the check shows it, and replace the credential if it is a real one.`;
}
