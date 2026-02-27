# Plan: Centralize Audit Vulnerability Exclusions into JSON Config Files

## Context

GHSA vulnerability exclusion IDs are hardcoded in two separate locations — the pre-push hook and the quality.yml GitHub Actions workflow. These lists are maintained independently, have already drifted (16 unique IDs total, but each file has a different subset), and inline comments duplicate risk justifications. This change creates a single source of truth via JSON config files, with a create-only local file so projects can extend the list.

## Approach

Create two JSON config files following the existing `eslint.ignore.config.json` (overwrite) / `eslint.thresholds.json` (create-only) pattern:

1. **`audit.ignore.config.json`** (copy-overwrite) — Lisa-managed base exclusions
2. **`audit.ignore.local.json`** (create-only) — Project-specific exclusions, starts empty

Both the pre-push hook and quality.yml read from both files using `jq`, merging the exclusion lists at runtime.

## JSON Structure

```json
{
  "exclusions": [
    {
      "id": "GHSA-5j98-mcp5-4vw2",
      "cve": "CVE-2025-64756",
      "package": "glob",
      "reason": "CLI command injection — only affects glob CLI --cmd flag, not library usage"
    }
  ]
}
```

- `id` (required): GHSA ID used by scripts for filtering
- `cve` (optional): CVE alias, used by yarn audit CVE-based filtering
- `package` (informational): Human-readable package name
- `reason` (informational): Why it's safe to ignore — replaces inline shell comments

## Base Exclusions (all 16 unique GHSA IDs)

| GHSA ID | Package | Reason |
|---------|---------|--------|
| GHSA-5j98-mcp5-4vw2 | glob | CLI-only vuln, we use glob as library |
| GHSA-8qq5-rm4j-mr97 | node-tar | Nested in @expo/cli, tar extraction not in our code path |
| GHSA-37qj-frw5-hhjh | fast-xml-parser | Transitive via React Native CLI, build tool only |
| GHSA-3ppc-4f35-3m26 | minimatch | ReDoS in devDeps, fix requires breaking v10 |
| GHSA-7r86-cg39-jmmj | minimatch | ReDoS GLOBSTAR in devDeps |
| GHSA-23c5-xmqv-rm74 | minimatch | ReDoS extglobs in devDeps |
| GHSA-2g4f-4pwh-qvx6 | ajv | $data option not used, nested in aws-cdk-lib/eslint |
| GHSA-jmr7-xgp7-cmfj | fast-xml-parser | DOCTYPE DoS, transitive via AWS SDK |
| GHSA-m7jm-9gc2-mpf2 | fast-xml-parser | Entity encoding bypass, same path as above |
| GHSA-r6q2-hw4h-h46w | node-tar | Race condition on macOS APFS, transitive via NestJS/Apollo |
| GHSA-34x7-hfp2-rc4v | node-tar | Hardlink path traversal, same path as above |
| GHSA-83g3-92jg-28cx | node-tar | Hardlink target escape, same path as above |
| GHSA-3h5v-q93c-6h6q | ws | DoS via many HTTP headers, behind API Gateway |
| GHSA-w532-jxjh-hjhj | jsPDF | ReDoS in addImage, controlled usage only |
| GHSA-8mvj-3j78-4qmw | jsPDF | DoS in addImage, controlled usage only |
| GHSA-36jr-mh4h-2g58 | d3-color | ReDoS, transitive via react-native-svg-charts |

## Files to Create

### 1. `typescript/copy-overwrite/audit.ignore.config.json`
The base exclusion list with all 16 GHSA IDs above. Overwritten on every Lisa run.

### 2. `typescript/create-only/audit.ignore.local.json`
Empty template: `{ "exclusions": [] }`. Created once, never overwritten — projects add their own exclusions here.

### 3. Root-level `audit.ignore.config.json` and `audit.ignore.local.json`
Lisa's own copies (deployed when running Lisa on itself).

## Files to Modify

### 4. `typescript/copy-contents/.husky/pre-push`
- Add a `load_audit_exclusions` shell function that reads `.exclusions[].id` from both JSON files via `jq`, deduplicates with `sort -u`
- Add a `load_audit_cves` function that reads `.exclusions[].cve` for yarn's CVE-based filtering
- Hoist the `jq` availability check to wrap the entire security audit section (currently only checked for yarn). If jq is missing, skip audit with warning
- **bun path**: Build `--ignore` flags dynamically from function output
- **npm path**: Build jq exclusion filter dynamically (`select(. == "GHSA-xxx" or ... | not)`)
- **yarn path**: Build jq GHSA + CVE filter dynamically
- Remove all inline `# Excluding GHSA-...` comment blocks (reasons now live in JSON)

### 5. `typescript/copy-overwrite/.github/workflows/quality.yml`
- Add a new step **"Load audit exclusions"** between "Install dependencies" and "Run security audit" that reads both JSON files and sets `ghsa_ids` as a step output
- Replace hardcoded GHSA IDs in all three package manager paths with dynamic construction from the step output
- Remove all inline `# Excluding GHSA-...` comment blocks

### 6. `.claude/rules/lisa.md`
- Add `audit.ignore.config.json` to "Files with NO local override" list
- Add `audit.ignore.local.json` to "Create-only files" list

## Shell Function Design

```bash
load_audit_exclusions() {
  _EXCLUSIONS=""
  for _config_file in audit.ignore.config.json audit.ignore.local.json; do
    if [ -f "$_config_file" ]; then
      _FILE_IDS=$(jq -r '.exclusions[].id' "$_config_file" 2>/dev/null)
      if [ -n "$_FILE_IDS" ]; then
        _EXCLUSIONS="$_EXCLUSIONS $_FILE_IDS"
      fi
    fi
  done
  echo "$_EXCLUSIONS" | tr ' ' '\n' | sort -u | grep -v '^$' | tr '\n' ' '
}
```

Per-package-manager usage patterns:

- **bun**: Loop over IDs, build `--ignore $id` flags, pass to `bun audit`
- **npm**: Loop over IDs, build jq filter `(. == "X" or . == "Y")`, use in `map(select(... | not))`
- **yarn**: Loop over GHSA IDs for `github_advisory_id` match + loop over CVEs from `load_audit_cves` for `cves` array match

## Edge Cases

- **Both JSON files missing**: `load_audit_exclusions` returns empty, audit runs with zero exclusions (safe default)
- **jq not installed locally**: Pre-push hook skips entire audit with install instructions (GitHub Actions always has jq)
- **Duplicate IDs across files**: `sort -u` deduplicates
- **Extra GHSA IDs that don't apply**: Harmless — if the package isn't installed, the audit won't flag it

## Verification

1. Validate JSON files parse correctly: `jq '.' audit.ignore.config.json`
2. Run `bun run lint` and `bun run typecheck` — no TS/ESLint files changed
3. Run `bun run test` — no test files changed, but confirm nothing breaks
4. Test pre-push hook locally: `bash .husky/pre-push` — should read from JSON configs and pass audit
5. Validate quality.yml syntax: `gh workflow view quality --yaml` after pushing
6. Run `bun run lisa:update:local` to propagate template changes to root project files
