# Exercised artifacts

Record the required exercises in `.lisa/controls/exercises.json`. Use one environment per plan.
A scope is `.` for the whole repository or a folder from its root. Give every target its own id.
Include each authoritative gate and scope for AC5.5, and each applicable connection and execution
surface for AC6.4. For rollback and staff qualification, include every release path and role
that the audit identifies as applicable.

```json
{
  "schema_version": 1,
  "environment": "production-representative",
  "targets": [
    { "id": "lint", "criterion": "AC5.5", "scope": ".", "producer": "gate-owner", "adjudicator": "independent-reviewer", "gate": "code-style", "moment": "pull-request" },
    { "id": "registry-worker", "criterion": "AC6.4", "scope": "api", "producer": "connection-owner", "adjudicator": "independent-reviewer", "connection": "registry", "surface": "worker" },
    { "id": "rollback", "criterion": "AC7.2", "scope": ".", "producer": "release-owner", "adjudicator": "independent-reviewer", "release_track": "production-representative" },
    { "id": "release-qualification", "criterion": "AC8.9", "scope": ".", "producer": "staff-owner", "adjudicator": "independent-reviewer", "role": "release-operator", "minimum_shadow_seconds": 86400 }
  ]
}
```

Check the plan with `lisa controls declaration-check`, then commit it before collecting evidence.
Run `lisa controls attest` to get the current
`checks.digest` in `.lisa/controls/evidence.json`. Give the producer the current digest and scope
so the independent reviewer can link each result to that plan and those checks.

The externally administered `LISA_HOST_PROOF_TRUST_FILE` authorizes the reviewer for the exact
repository origin and environment. Keep it outside the checkout. Its JSON contains
`schema_version: 1`, `repository`, `environment`, and distinct `adjudicator` and `attestor`
objects with `id` and an Ed25519 `public_key` in PEM form. Each exercise's producer and reviewer
must also be distinct. The producer runs the exercise. The reviewer independently checks the
result, its scope and the source artifact before signing it.

Each signed body contains `schema_version: 1`, `repository`, `environment`, `checks_digest`,
`target_id`, `criterion`, `scope`, `producer`, `adjudicator`, `artifact`, `completed_at`, and
`outcome`. Set `artifact` to an object containing `sha256`, or an immutable `locator` in the
form `git:<full-object-id>:<path>`. Set `completed_at` and the other time fields to UTC with
milliseconds. These are the required outcome fields.

| Criterion | Outcome fields |
| --- | --- |
| AC5.5 Gate exercise | `gate`, `moment`, `violation_exit`, `violation_output`, and `clean_exit` when a clean companion is required. Use the authoritative moment. Capture the nonzero refusal and its declared failure text. |
| AC6.4 Credential paths | `connection`, `surface`, `principal`, and `identity_verified: true` after an identity check on that surface. Record the public principal name. Keep credential values out of the result and its source artifact. |
| AC7.2 Rollback | `release_track`, `incident`, `actor`, `finding`, `previous_generation`, `rolled_back_from`, `restored_generation`, `detected_at`, `rolled_back_at`, `verified_at`, and `recovery_verified: true`. Confirm the previous generation was restored and is serving. |
| AC8.9 Staff qualification | `role`, `actor`, `roster_sha256`, `shadow_started_at`, `shadow_completed_at`, `comparisons`, `shadow_agreed: true`, `adversarial_passed: true`, and `qualification: "qualified"`. Observe the planned shadow period and record both checks. |

Sign the compact canonical JSON of `{"purpose":"artifact-exercise","body":…}` using the authorized
reviewer's Ed25519 key. Canonical JSON sorts object keys by code unit at every depth and keeps array
order. Add the unpadded Base64url `signature` to the envelope. Put one envelope per target in an
array at `.lisa/controls/exercise-results.json`.

Run `lisa controls attest`, then `lisa controls attest --check`. Attest records exercised evidence
for a criterion after each applicable target has a current, verified result. The check authenticates
the signed results again and compares them with the saved evidence. When a target is missing or
unusable, the command names the evidence that remains due.
