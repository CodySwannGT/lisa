/** Admit an independently adjudicated pull-request proof and write its receipt. */
import { constants } from "node:fs";
import { open } from "node:fs/promises";

import { readEnv } from "../../utils/process-environment.js";
import { recordAttestation } from "../attest-record.js";
import { resolveRepositoryRoot } from "../audit-report-file.js";
import { bindChecks, hostHookFiles } from "../checks-binding.js";
import { isEvidenceFresh } from "../evidence.js";
import {
  DEFAULT_FRESHNESS_SECONDS,
  type EvidenceBatch,
  type EvidenceResultInput,
} from "../evidence-types.js";
import { hostProofInput, type HostProofInput } from "../host-proof-input.js";
import { HOST_PROOF_RECEIPTS_PATH } from "../host-proof-receipt.js";
import { verifyHostProof } from "../host-proof-signature.js";
import {
  HOST_PROOF_TRUST_FILE,
  loadHostProofSigningKey,
  loadHostProofTrust,
} from "../host-proof-trust.js";
import { declaredFailureText } from "../proof-plan.js";
import { proofRunOf } from "../proof-runner.js";
import { readOriginUrl } from "../protect-platform.js";
import {
  PULL_REQUEST_MOMENT,
  unwrittenExecutor,
} from "../pull-request-executor.js";
import { generateControlRegister } from "../register.js";
import { ATTEST_EXIT } from "./attest-options.js";

/** A bounded JSON envelope includes at most two short captured outputs. */
const MAX_INPUT_BYTES = 128 * 1024;

/** What import needs without running local checks or contacting the host. */
interface ImportOptions {
  readonly directory: string;
  readonly bundle: string;
  readonly signingKey: string;
  readonly now: Date;
  readonly json: boolean;
  readonly stdout: (text: string) => void;
  readonly stderr: (line: string) => void;
}

/**
 * Read the operator's selected input without executing it.
 * @param file - Resolved path of a small JSON file
 * @returns Its contents, or null when it cannot be read
 */
async function readBundle(file: string): Promise<unknown> {
  try {
    const handle = await open(file, constants.O_RDONLY | constants.O_NONBLOCK);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > MAX_INPUT_BYTES) return null;
      const bytes = Buffer.alloc(MAX_INPUT_BYTES + 1);
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
      return bytesRead <= MAX_INPUT_BYTES
        ? (JSON.parse(bytes.toString("utf8", 0, bytesRead)) as unknown)
        : null;
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

/**
 * Convert the adjudicated run's actual result into the existing evidence format.
 * @param source - The approved input and common subject
 * @param half - The clean or violating change
 * @returns The result as the attest writer expects it
 */
function resultFor(
  source: HostProofInput,
  half: "clean" | "violation"
): EvidenceResultInput {
  const run = source[half];
  return {
    entry_id: source.subject.entry_id,
    moment: PULL_REQUEST_MOMENT,
    rung: "exercised",
    half,
    result: "held",
    reason: half === "clean" ? "accepted" : "rejected-as-declared",
    detail:
      half === "clean"
        ? "The independently adjudicated host check accepted the clean change."
        : "The independently adjudicated host check rejected the violating change with the declared failure text.",
    command: null,
    exit_status: run.exit_status,
    started_at: run.started_at,
    completed_at: run.completed_at,
    output_excerpt: run.output_excerpt,
    output_truncated: true,
  };
}

/**
 * Match the independently adjudicated runs to the live declaration and check files.
 * @param root - Real repository path
 * @param source - The authorized paired proof
 * @param now - The time used to evaluate the current register
 * @returns The binding and evidence to record, or an explanation of the mismatch
 */
async function prepareHostProof(
  root: string,
  source: HostProofInput,
  now: Date
) {
  if (
    ![source.clean, source.violation].every(run =>
      isEvidenceFresh(
        {
          completed_at: run.completed_at,
          freshness_seconds: DEFAULT_FRESHNESS_SECONDS,
        },
        now
      )
    )
  )
    return "At least one half of the signed proof is outside its evidence lifetime.";
  const registered = await generateControlRegister(root, { now });
  if (registered.problems !== null)
    return "Fix the control declaration before importing its proof.";
  const { entries } = registered.register;
  const entry = entries.find(each => each.id === source.subject.entry_id);
  const executor = entry === undefined ? null : unwrittenExecutor(entry);
  if (
    entry === undefined ||
    executor?.platform !== source.subject.platform ||
    executor.path !== source.subject.executor_path
  ) {
    return "The proof targets a different entry or pull-request executor.";
  }
  const shape = declaredFailureText(entry);
  if (!shape.some(line => source.violation.output_excerpt.includes(line))) {
    return "The violation output does not contain the declared failure text.";
  }
  const checks = await bindChecks({
    repository: root,
    hostHooks: hostHookFiles,
  });
  if (
    checks.digest !== source.subject.checks_digest ||
    !checks.covered.some(file => file.path === executor.path)
  ) {
    return "The proof does not match the current definitions of the check.";
  }
  const batch: EvidenceBatch = {
    entries: [entry.id],
    moments: [PULL_REQUEST_MOMENT],
    results: [resultFor(source, "clean"), resultFor(source, "violation")],
  };
  return { checks, batch };
}

/**
 * Import one authorized pair and sign the exact evidence that attest writes.
 * @param options - The checkout, selected files and output streams
 * @returns An attest exit code
 */
export async function runAttestHostProof(
  options: ImportOptions
): Promise<number> {
  const { now, json, stdout, stderr } = options;
  const fail = (reason: string): number => {
    stderr(`attest: FAIL. ${reason}`);
    return ATTEST_EXIT.NOT_RUN;
  };
  const root = await resolveRepositoryRoot(options.directory);
  if (root === null)
    return fail(
      "Give the path of the repository whose pull-request proof is being imported."
    );
  const trust = await loadHostProofTrust(root, readEnv(HOST_PROOF_TRUST_FILE));
  if (trust === null || (await readOriginUrl(root)) !== trust.repository) {
    return fail(
      "Select the external host proof trust file that matches this checkout's origin."
    );
  }
  const signingKey = await loadHostProofSigningKey(
    root,
    options.signingKey,
    trust
  );
  if (signingKey === null)
    return fail(
      "The protected attest signing key does not match the authorized attestor."
    );
  const source = hostProofInput(
    verifyHostProof(
      await readBundle(options.bundle),
      "host-proof-import",
      trust.adjudicator.key
    )
  );
  if (
    source === null ||
    source.adjudicator !== trust.adjudicator.id ||
    source.subject.repository !== trust.repository ||
    source.subject.environment !== trust.environment
  ) {
    return fail(
      "The input does not contain an authorized paired proof for this repository and environment."
    );
  }
  const prepared = await prepareHostProof(root, source, now);
  if (typeof prepared === "string") return fail(prepared);
  const recorded = await recordAttestation({
    named: root,
    run: proofRunOf([]),
    now,
    checks: prepared.checks,
    batches: [prepared.batch],
    hostProof: { source, trust, signer: signingKey },
  });
  if (recorded.problems !== null)
    return fail(
      "Attest could not write a current receipt and its paired evidence."
    );
  const result = {
    entry: source.subject.entry_id,
    receipt: HOST_PROOF_RECEIPTS_PATH,
    recorded: true,
  };
  stdout(
    json
      ? JSON.stringify(result)
      : `attest: Stored the paired proof and its receipt for ${result.entry}.`
  );
  return ATTEST_EXIT.PASSED;
}
