# Upstream JIRA Verification Workflow from Frontend-v2 to Lisa

## Context

Frontend-v2 has 5 JIRA skills (`jira-fix`, `jira-implement`, `jira-journey`, `jira-add-journey`, `jira-evidence`) and 2 enhanced skills (`jira-create`, `jira-verify`) that don't exist in Lisa's templates. These implement an automated verification workflow where the agent:

1. Analyzes a JIRA ticket and generates a "Validation Journey" section with verification steps
2. Executes those steps and captures evidence
3. Posts evidence to JIRA and GitHub PR

This needs to be upstreamed to Lisa with **Expo-specific** (Playwright visual verification) and **TypeScript-specific** (API/test/DB verification) implementations. Both use the same JIRA section heading ("Validation Journey") so the parser tooling is shared.

The key difference: **Expo verification is always visual** (screenshots via Playwright at multiple viewports). **TypeScript verification varies by change type** -- the agent must analyze the ticket and codebase to determine the right verification approach (curl for API, psql for DB, test commands for logic, etc.) using the patterns defined in `verfication.md`.

---

## Files to Create/Modify

### 1. Universal Commands (`all/copy-overwrite/.claude/commands/jira/`)

Five new command files -- pass-throughs to skills:

| File | Description | Argument Hint |
|------|-------------|---------------|
| `fix.md` | Fix a bug described in a JIRA ticket | `<TICKET-ID-OR-URL>` |
| `implement.md` | Implement requirements from a JIRA ticket | `<TICKET-ID-OR-URL>` |
| `journey.md` | Execute Validation Journey and capture evidence | `<TICKET_ID> [PR_NUMBER]` |
| `add-journey.md` | Add Validation Journey section to existing ticket | `<TICKET_ID>` |
| `evidence.md` | Post captured evidence to JIRA and GitHub PR | `<TICKET_ID> <EVIDENCE_DIR> <PR_NUMBER>` |

Pattern: same as existing `jira/create.md` -- frontmatter with `allowed-tools: ["Skill"]` and body delegating to `/jira-<name> skill`.

### 2. Universal Base Skills (`all/copy-overwrite/.claude/skills/`)

**`jira-fix/SKILL.md`** (new) -- Genericized from frontend-v2:
- Read JIRA issue via Atlassian MCP or CLI (use `$ARGUMENTS`, no hardcoded URLs)
- Extract sign-in info if available
- Reproduce bug using project's verification method (browser for UI, curl/tests for API)
- If can't reproduce, document evidence and stop
- Check for previous fix attempts (PRs, commits referencing ticket)
- Fix the bug
- Verify fix using project's verification method
- Upload evidence to JIRA
- Source: `/Users/cody/workspace/geminisportsai/frontend-v2/.claude/skills/jira-fix/SKILL.md` (remove hardcoded `SE-3726` URL and `localhost:8081`)

**`jira-implement/SKILL.md`** (new) -- Genericized from frontend-v2:
- Read JIRA ticket via Atlassian MCP or CLI
- If neither available, stop and report
- Read all ticket details including URLs and attachments
- Make a plan to fulfill requirements
- If UI work: use browser tools to understand current state, create verification task
- If API/backend work: use curl or test commands to understand current behavior, create verification task
- Source: `/Users/cody/workspace/geminisportsai/frontend-v2/.claude/skills/jira-implement/SKILL.md` (generalize "frontend issue" to handle all change types)

**`jira-journey/SKILL.md`** (new base) -- Generic description only (no scripts):
- Parse the Validation Journey from the JIRA ticket
- Execute verification steps using the project's appropriate tools
- Capture evidence at each marker
- Generate evidence templates
- Post evidence via `jira-evidence` skill
- Note: Stack overrides provide the actual execution implementation and scripts

**`jira-add-journey/SKILL.md`** (new base) -- Generic description only:
- Read the JIRA ticket
- Check if Validation Journey already exists
- Analyze the feature/fix and codebase to determine verification approach
- Generate appropriate Validation Journey steps
- Present to user for approval before appending to ticket
- Note: Stack overrides provide change-type-specific generation logic

**`jira-evidence/SKILL.md`** (new) -- Universal evidence posting:
- Run `post-evidence.sh` from scripts directory
- Handles both image evidence (screenshots) and text evidence (command output)
- Source: `/Users/cody/workspace/geminisportsai/frontend-v2/.claude/skills/jira-evidence/SKILL.md` (generalize screenshot-specific language)

**`jira-evidence/scripts/post-evidence.sh`** (new) -- Updated from frontend-v2:
- Source: `/Users/cody/workspace/geminisportsai/frontend-v2/.claude/skills/jira-evidence/scripts/post-evidence.sh`
- Change: Make screenshot upload optional (don't `exit 1` if no `.png` files found)
- Change: Also glob for `[0-9][0-9]-*.txt` and `[0-9][0-9]-*.json` evidence files
- Change: Upload non-image evidence files to GitHub release too (for linking)
- Always require `comment.md` and `comment.txt`
- Always update PR description, post JIRA comment, move ticket to Code Review

### 3. Expo-Specific Skills (`expo/copy-overwrite/.claude/skills/`)

**`jira-create/SKILL.md`** (override) -- Direct copy from frontend-v2:
- Source: `/Users/cody/workspace/geminisportsai/frontend-v2/.claude/skills/jira-create/SKILL.md`
- Adds "Validation Journey (Frontend Tickets)" section with when-to-include, how-to-write, guidelines
- Change: Remove hardcoded `SE` project default, use "from jira-cli config"

**`jira-verify/SKILL.md`** (override) -- Direct copy from frontend-v2:
- Source: `/Users/cody/workspace/geminisportsai/frontend-v2/.claude/skills/jira-verify/SKILL.md`
- Adds 3rd check for Validation Journey using `parse-plan.py`
- Change: Update script path from `parse-journey.py` to `parse-plan.py`

**`jira-journey/SKILL.md`** (override) -- Adapted from frontend-v2:
- Source: `/Users/cody/workspace/geminisportsai/frontend-v2/.claude/skills/jira-journey/SKILL.md`
- Playwright-based execution: parse journey → satisfy prerequisites → execute at each viewport → capture screenshots → generate templates → post evidence
- Change: Update script references from `parse-journey.py` to `parse-plan.py`

**`jira-journey/scripts/parse-plan.py`** (new) -- Renamed from frontend-v2:
- Source: `/Users/cody/workspace/geminisportsai/frontend-v2/.claude/skills/jira-journey/scripts/parse-journey.py`
- Change: Rename file from `parse-journey.py` to `parse-plan.py`
- Change: Support both `[SCREENSHOT: name]` and `[EVIDENCE: name]` markers (regex: `\[(SCREENSHOT|EVIDENCE):\s*([^\]]+)\]`)
- Same filename in both Expo and TypeScript so Expo cleanly overwrites TypeScript during deployment

**`jira-journey/scripts/generate-templates.py`** (new) -- Adapted from frontend-v2:
- Source: `/Users/cody/workspace/geminisportsai/frontend-v2/.claude/skills/jira-journey/scripts/generate-templates.py`
- Change: Replace hardcoded `geminisportsai.atlassian.net` ticket URL with dynamic lookup from `~/.config/.jira/.config.yml`
- Change: Replace hardcoded `geminisportsai/frontend-v2` fallback with empty string that fails loudly
- Same filename in both stacks for clean override

**`jira-add-journey/SKILL.md`** (override) -- Adapted from frontend-v2:
- Source: `/Users/cody/workspace/geminisportsai/frontend-v2/.claude/skills/jira-add-journey/SKILL.md`
- Expo-specific: generates visual journey with `[SCREENSHOT: name]` markers, viewports table, visual assertions
- Change: Update script reference from `parse-journey.py` to `parse-plan.py`

**`jira-evidence/SKILL.md`** (override) -- Expo-specific evidence formatting:
- Screenshot naming convention (`NN-name-viewport.png`)
- References `generate-templates.py` for image-based templates
- Groups evidence by viewport

### 4. TypeScript-Specific Skills (`typescript/copy-overwrite/.claude/skills/`)

**`jira-create/SKILL.md`** (override):
- Same base as universal `jira-create` plus "Validation Journey" section
- Different from Expo: when-to-include criteria focus on API endpoints, database changes, background jobs, library exports, security fixes
- When to skip: documentation-only, config-only, type-definition-only changes
- The agent generates appropriate verification steps based on the change type, using patterns from `verfication.md`
- Uses `[EVIDENCE: name]` markers instead of `[SCREENSHOT: name]`
- No viewports table; instead agent determines which environments to verify against

**`jira-verify/SKILL.md`** (override):
- Same checks 1 and 2 as universal
- Check 3: Validation Journey presence (uses `parse-plan.py`)
- Skip criteria: documentation-only, config-only, type-definition-only changes
- Uses same parser script as Expo (same filename `parse-plan.py`)

**`jira-journey/SKILL.md`** (override) -- The core TypeScript verification executor:
- Parses Validation Journey from ticket via `parse-plan.py`
- For each step, the agent determines how to execute it based on step text and change type:
  - API endpoints → curl commands, capture HTTP response
  - Database changes → psql/migration commands, capture schema output
  - Background jobs → trigger job, check queue/state, capture logs
  - Library/utility changes → run tests, capture output
  - Security fixes → reproduce exploit, verify fix
- At each `[EVIDENCE: name]` marker, captures stdout/stderr to `evidence/NN-name.txt`
- Runs `generate-templates.py` to format text evidence as code blocks
- Posts via `jira-evidence` skill
- `allowed-tools`: includes Bash, Read, Glob, Grep, Skill, mcp__atlassian (NO Playwright)

**`jira-journey/scripts/parse-plan.py`** (new):
- Same ADF parsing core as Expo version (duplicated -- acceptable since deployed independently)
- Supports both `[SCREENSHOT: name]` and `[EVIDENCE: name]` markers
- Returns same JSON structure: `{ ticket, prerequisites, steps, viewports, assertions }`
- `viewports` may be empty for TypeScript tickets (that's fine)

**`jira-journey/scripts/generate-templates.py`** (new):
- Generates `comment.txt` (JIRA wiki) and `comment.md` (GitHub markdown)
- Formats text evidence as code blocks instead of inline images:
  - JIRA: `{code:json}...{code}` or `{code:bash}...{code}`
  - GitHub: fenced code blocks with language specifiers
- Reads `evidence/NN-name.txt` files instead of `NN-name-viewport.png`
- Groups evidence by verification name, not viewport
- Dynamic JIRA server URL from `~/.config/.jira/.config.yml`
- Dynamic GitHub repo from `gh repo view`

**`jira-add-journey/SKILL.md`** (override) -- The smart TypeScript skill:
- Reads JIRA ticket via Atlassian MCP or CLI
- Checks for existing Validation Journey via `parse-plan.py`
- **Analyzes the change type** by examining:
  - Ticket description and acceptance criteria
  - Components, labels, linked tickets
  - Codebase files mentioned or likely affected
- **Maps change type to verification pattern** from `verfication.md`:
  - API/GraphQL → curl commands verifying endpoints, status codes, response schemas
  - Database migration → migration execution + schema verification + rollback check
  - Background job/queue → enqueue + process + state change verification
  - Library/utility → test execution + build verification + export check
  - Security fix → exploit reproduction pre-fix + exploit failure post-fix
  - Authentication/authorization → multi-role verification with explicit status codes
- Generates Validation Journey with `[EVIDENCE: name]` markers at key verification points
- Presents to user for approval
- Appends to ticket description
- Verifies with `parse-plan.py`

**`jira-evidence/SKILL.md`** (override):
- Text evidence naming convention (`NN-name.txt`)
- References TypeScript `generate-templates.py` for code-block templates
- No viewport grouping

### 5. Update `lisa.md` (`all/copy-overwrite/.claude/rules/lisa.md`)

Add to the "Files and directories with NO local override" section:
- `.claude/skills/jira-fix/*`, `.claude/skills/jira-implement/*`
- `.claude/skills/jira-journey/*`, `.claude/skills/jira-add-journey/*`, `.claude/skills/jira-evidence/*`
- `.claude/commands/jira/fix.md`, `.claude/commands/jira/implement.md`
- `.claude/commands/jira/journey.md`, `.claude/commands/jira/add-journey.md`, `.claude/commands/jira/evidence.md`

---

## Override Mechanics

Deployment order for an **Expo** project:
1. `all/` → deploys base versions of all skills
2. `typescript/` → overwrites with TypeScript versions (including `parse-plan.py`)
3. `expo/` → overwrites with Expo versions (same filenames, clean override)

Result: Expo project gets Expo-specific Playwright visual verification.

Deployment order for a **NestJS** project:
1. `all/` → deploys base versions
2. `typescript/` → overwrites with TypeScript API/test verification
3. `nestjs/` → no JIRA overrides, so TypeScript versions persist

Result: NestJS project inherits TypeScript API/test verification.

Using the same filename (`parse-plan.py`, `generate-templates.py`) in both Expo and TypeScript ensures clean overwriting with no orphaned files.

---

## Commit Sequence

1. `feat: add universal jira-fix, jira-implement, jira-evidence, jira-journey, jira-add-journey commands and base skills`
2. `feat: add Expo-specific JIRA verification skills with Playwright visual journey`
3. `feat: add TypeScript-specific JIRA verification skills with API/test-based verification`
4. `chore: update lisa.md to document new JIRA managed files`

---

## Verification

1. **Unit**: Run `bun run test` to ensure no existing tests break
2. **Lint**: Run `bun run lint` to verify all new markdown/script files pass linting
3. **Manual check**: Run `bun run dev -- /tmp/test-expo-project` on a test Expo project and verify:
   - All 5 new commands appear in `.claude/commands/jira/`
   - Expo-specific skills (with Playwright references) are in `.claude/skills/`
   - `parse-plan.py` and `generate-templates.py` exist in `jira-journey/scripts/`
   - `post-evidence.sh` exists in `jira-evidence/scripts/`
4. **Manual check**: Run `bun run dev -- /tmp/test-ts-project` on a test TypeScript project and verify:
   - Same 5 commands exist
   - TypeScript-specific skills (with curl/test references, no Playwright) are in `.claude/skills/`
   - TypeScript `parse-plan.py` and `generate-templates.py` exist
5. **Verify no orphaned files**: On the Expo project, confirm only ONE `parse-plan.py` exists (not both Expo and TypeScript versions)
