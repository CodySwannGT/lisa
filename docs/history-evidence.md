# Authentic checksum evidence in the required history scanner

Lisa runs the checksum-qualified Gitleaks default rules against every introduced
commit. A detector finding is cleared only when its exact unique byte span has a
recognized evidence role and an independently authenticated preimage. Other
findings in the same file remain blocking. This does not certify an audit
receipt's assertions, test results or runtime behavior.

The Rails `rails-prepush` Lefthook step runs both history scanning and work-item
traceability. When either refuses the push, its output includes `Rails pre-push
refused` with the returned exit status and a reminder to inspect both checks.
Retry the same `git push` command to preserve its remote and complete input.
Missing or damaged managed tooling reports a safe repair instruction and
withholds raw bootstrap errors. Run full Lisa apply before retrying that case.

The scanner requires the official Gitleaks 8.30.1 release for the current
Linux/macOS x64/arm64 platform, qualified by its binary SHA256 and exact version.
It walks PATH in order and uses the first fully qualified executable, skipping
unreadable, nonexecutable, nonregular and checksum-mismatched candidates. A
symlink to the official executable can qualify; a broken symlink cannot.
Homebrew and other builds reporting the same version can have different bytes
and therefore remain unqualified. A checksum-mismatched executable is never
run, even to ask its version. When no candidate qualifies, the refusal names
rejected candidates and their checksum or usability failure, includes expected
and actual digests for a checksum mismatch, and says that its version was not
checked. Version-execution failures and version mismatches are diagnosed
separately after the checksum passes. An explicit `--scanner <executable-path>`
qualifies only that path and refuses without falling back to PATH.

Provisioning downloads and verifies the official archive and executable:

```sh
mkdir -p ~/.local/bin
node scripts/lisa-history-secrets.mjs provision ~/.local/bin/gitleaks
```

Put that directory anywhere on PATH for Lisa's qualified discovery, or pass the
destination with `--scanner`. Provisioning does not change PATH or replace a
package-manager executable unless you explicitly choose that destination.
Putting the provisioned directory before Homebrew's directory also changes
which `gitleaks` ordinary shell commands select; placing it later lets Lisa
find the official artifact while the shell continues to select the earlier
build. Scanning itself stays offline and never provisions automatically.

The genuine scanner runs through a fixed POSIX child launcher that sets umask
077 before directly executing its original argument vector. Gitleaks removes
and recreates its report, so precreating a mode-0600 file alone is insufficient.
The calling process's umask, audited Git environment, native result and existing
time/capture bounds remain unchanged.

The permission witness loads that launch boundary from the actual emitted
source or immutable archive. With a supplied private proof directory, it retains bounded mode, detection,
redaction and source/tool/archive identity predicates before assertions and
owned scratch cleanup. Missing, malformed or nonregular reports remain failures.
Predicate evidence contains no raw report, matched value, environment or local
path, and a retained failed witness never counts as passing acceptance.
Scanner qualification remains mandatory. An exec-startup failure can return the
shell's nonzero status instead of a direct-spawn error object; either outcome
fails closed, and a status never substitutes for an observed runtime errno.

The bounded JSON parser rejects duplicate decoded keys, escaped attribution
spellings, unsafe source paths, malformed maps and ambiguous vendor captures.
It accepts at most 1 MiB of UTF-8 evidence, 8,192 tokens, depth 32 and 256 entries
per map. Actual Git blob reads retain the 64 MiB shared byte budget and 256
distinct-blob cache. Repeated references share the same authenticated blob.

`source_sha256` maps preserve their original contract: every sibling source path
must match the checksum at the finding's commit, or at an explicit
`source_revision` that is an authentic ancestor commit. An invalid explicit
revision never falls back. Source files remain scanned for credentials.

The other source forms are `source_hashes`, `source_hashes_after`,
`current_source_sha256`, `prior66_source_sha256`, `protected_sha256`,
`selected_artifact_hashes`, `files`, and a bare relative-path/checksum object.
Every source sibling must have exact path-specific Git bytes. A previous version
can qualify only through a commit in the actual introduced input set that is
also an ancestor of the finding commit. There is no whole-repository history
search. Exact JSON fences preserve their offsets in the original Markdown blob.

`proof_sha256` and `logs` identify proof checksums. To make a reviewed proof
portable, commit its exact original bytes at
`.lisa/history-secret-preimages/sha256/<computed-lowercase-sha256>`.
The scanner verifies a regular Git blob and its SHA256 basename in an actual
introduced after-head. A catalogue reachable only through ambient HEAD, a
foreign branch or an unchanged ref cannot authorize classification. Mismatched,
missing and symlink catalogue entries cannot qualify. There is no local-file
fallback. Review proofs for privacy before publishing their bytes.

Proof labels are opaque identifiers and can retain an original absolute label.
The scanner never dereferences that label. Verification clears only its own
uniquely attributed checksum finding. A missing or credential sibling remains
blocking. Reserved credential field names cannot become evidence labels.

The prose case remains the literal `Disk/missing/corrupt` taxonomy following
`AccessDenied boundaries, ` in ordinary validation prose. The phrase must sit
outside Markdown code. Surrounding narrative and inline identifiers do not
authorize credential assignments, JSON credential fields, substituted values
or adjacent credentials. Each finding keeps its own vendor span and verdict.
