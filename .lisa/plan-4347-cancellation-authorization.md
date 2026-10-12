# Cancellation authorization failure

Work item: CodySwannGT/lisa#4347. Existing claim and original six acceptance scenarios remain authoritative. This is a phase of that task, not a replacement scope or new leaf.

## Base and scope

Target Backend Environment: production, mapped to main by the current configuration. The existing contribution branch has been fast-forwarded onto upstream main `95bd739332c18f62a013bea4c348696d3dea6f79` before implementation. No application deployment is required.

An anonymous caller's native producer failed at cancel-checkpoint after all 65 cancellation data chunks were persisted, before completion. Signing occurred at 21:41:17 UTC and failure at 22:41:30 UTC. The 3600-second freshness bound was exceeded; the exact throwing boundary must be proved before the remedy is selected. The prior open leaf and partial checkpoint are preserved.

## Tasks and ownership

The phase roster is recorded in `.lisa/roster/CodySwannGT-lisa-4347.md`. Native Codex delegation is available; no native task-list tool is exposed, so ownership and dependencies are recorded here.

1. Input resolution — cancellation_input_resolver — completed: existing standalone claimed task, unchanged original scope, actual current integration base.
2. Source map — cancellation_path_explorer — completed read-only: every persisted body reruns mutable provider authority and immutable origin/cancellation signature verification. Relevant documentation: cancellation, checkpoint, origin, proof and official verifier modules; existing verifier and cancellation lifecycle test suites.
3. Reproduction — cancellation_failure_debugger — in progress: establish the exact failure boundary with execution evidence and measure the repeated work. No production edits or provider mutations.
4. Implementation — bug-fixer, after task 3 proves cause — reaching RED/GREEN regression and minimal durable remedy. File ownership assigned only when the defect is established.
5. Independent review — security and quality specialists, after task 4 — signature, freshness, per-write mutable checks, invalidation, output isolation and regression reachability.
6. Verification — independent verification specialist — local checks on exact deliverable bytes, then native hosted proof after qualified source release and normal caller adoption.
7. Lead — derived artifacts, original hooks, small commits and batched protected PR delivery, release qualification, public milestone evidence and complete original acceptance audit.

## Effective completion condition

The actual hosted producer must authenticate and finish cancellation of its owned stale origin, preserve foreign work, allocate and publish a genuine canonical update, and reach the original checks through normal protected delivery. Then all six original scenarios must have authoritative observed evidence, including identical interrupted recovery on the same leaf, distinct identity, actual whole-range provider validation, controlled negatives, credential separation, failure reporting and unchanged opt-outs/hooks/protections. Local regressions alone cannot establish this.

## Constraints

Keep the existing freshness bound, deadlines, fixed signature roles and every per-write mutable authority check. Do not cache current provider/main/claim/body/holds/destination state. Do not substitute an unchanged retry for causal diagnosis, weaken verification, create duplicate claims, retire the incomplete origin prematurely, or expose caller identities in public evidence.

## Causal evidence — 2026-10-11

The actual cancellation subject and signature were verified with the exact pinned official Linux executable in the qualified AMD64 runtime. Production role/time assertions accept the final data-chunk time and exact expiry boundary, and reject one millisecond later and the actual terminal time. The native production verifier reproduces the expired-authorization failure twice. The original sanitized log lacks its raw stack; evidence establishes unavoidable completion expiry without claiming an exclusive earlier throwing boundary.

The preserved checkpoint is 1,061,422 bytes across 65 chunks; full proposal file content accounts for over 96 percent. The team is evaluating a bounded closed compressed transport retaining exact legacy decoding, canonical record/digest and all per-write checks. No authentication cache or longer deadline is selected. Source regression and authentic measured roundtrip evidence must precede delivery.

## Selected remedy and baseline

Use a closed version 2 zlib-deflate checkpoint transport with fixed level 6 and exact input-consumption verification. Preserve canonical semantic payload, signing digest, legacy version 1 decoding and exact complete/partial legacy retry. Every mutable per-write check and current-time signature freshness check remains unchanged. No verifier cache or new dependency is introduced.

The qualified Node 22.23.3 codec measurement on actual retained checkpoint bytes reduced 1,061,422 to 267,476 bytes, equivalent to 65 versus 17 data chunks. Bounded decompression reproduced the exact original SHA256; repeated encoding matched. Baseline evidence: `tmp/4347-compression-baseline-2kzxawtq/receipt.json`. This is transport evidence, not hosted acceptance.

Implementation owner: cancellation_transport_fixer, limited to checkpoint transport, origin discovery/chronology, partial recovery and directly relevant regression tests, with at most one focused codec helper to preserve file budgets. Root owns metadata and derived artifacts. Independent reviewers own review of the exact delivered patch; hosted completion and all original six scenarios remain required.

## Local verification and review

The final related native suite passed 225 cases with zero failures or skips. Named cases cover both complete and interrupted versioned discovery, exact legacy retry, per-missing-write mutable authority and inventory rereads, malformed transport, and a decompression bomb that reaches the output ceiling. The initial red control reproduced expiry in actual checkpoint persistence under the observed cadence.

Independent qualified Node 22.23.3 verification reconstructed the actual posted data chunks and exercised the final codec. Both legacy 65-chunk and compressed 17-chunk encodings returned exact original canonical transport bytes: 1,061,422 bytes, SHA256 3e5c4e05e68ad31948dd08c1fd8283496e0ec0d035073c8896619b34b21d453e. Missing completion and tampered transport were refused. This does not grant authority to the preserved incomplete checkpoint.

Independent source quality review passed on exact frozen source/test hashes. Signature and cancellation authority modules remain unchanged. The existing closed inventory admits exactly the new codec helper; its authenticated import graph was regenerated through the original generator. Every dependent artifact and normal delivery gate remains required.

Outstanding: protected source delivery, qualified published release, normal caller adoption, authentic hosted cancellation/publication/recovery, all six original acceptance scenarios and final audit. No local test or source review establishes those hosted outcomes.
