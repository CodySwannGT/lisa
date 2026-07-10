# Host Project Only Example Output

## What Already Exists
- CLI command registration is documented in the repository README.
- Skill sources live under `plugins/src/base/skills/` and are copied into the generated Lisa plugin.
- The project already has unit tests that verify generated plugin artifacts.

## Practical Ideas
### 1. Plugin Surface Drift Report
- User value: Maintainers can see which source skills are not represented in the generated plugin before publishing.
- Existing fit: Builds on the existing plugin source tree and generated plugin artifact tests.
- Data/source path: Local files under `plugins/src/base/skills/` and `plugins/lisa/skills/`.
- Practical slice: Emit a markdown report listing source-only, generated-only, and mismatched skill directories.
- Empirical verification: Run the report command in a clean checkout after intentionally adding one fixture-only source skill.
- Evidence: CLI output showing the mismatched skill and the generated markdown report path.
- Confidence: high because the required data is already local and deterministic.

## Discovery Spikes
- Skill usage frequency ranking: needs a bounded source of invocation telemetry before it can be recommended.

## Rejected / Not Practical Yet
- Personalized skill suggestions from private user history: rejected because the repository does not have access to private Codex usage history.
