# Claude Code Action Inputs Reference

Complete input reference for `anthropics/claude-code-action@v1`.

## Authentication Inputs

| Input | Description |
|-------|-------------|
| `claude_code_oauth_token` | OAuth token from Claude Code (recommended) |
| `anthropic_api_key` | Direct Anthropic API key |
| `aws_access_key_id` | AWS access key for Bedrock |
| `aws_secret_access_key` | AWS secret key for Bedrock |
| `aws_region` | AWS region for Bedrock |
| `gcp_project_id` | GCP project ID for Vertex AI |
| `gcp_region` | GCP region for Vertex AI |
| `gcp_workload_identity_provider` | GCP workload identity provider |

## Behavior Inputs

| Input | Default | Description |
|-------|---------|-------------|
| `prompt` | (none) | Custom instructions for Claude. If not set, Claude uses the triggering comment/issue body |
| `claude_args` | (none) | Additional CLI arguments passed to Claude Code SDK |
| `track_progress` | `false` | Post progress comments on the PR/issue |
| `branch_prefix` | (none) | Prefix for branches Claude creates (e.g., `claude/`) |

## Permission Inputs

| Input | Default | Description |
|-------|---------|-------------|
| `additional_permissions` | (none) | Additional GitHub API permissions (e.g., `actions: read`) |
| `allowed_bots` | (none) | Comma-separated list of bot usernames allowed to trigger |
| `allowed_non_write_users` | (none) | Comma-separated list of non-write-access users allowed to trigger |
| `settings` | (none) | JSON string of Claude Code settings overrides |

## Claude Args Reference

Pass via the `claude_args` input:

| Arg | Example | Description |
|-----|---------|-------------|
| `--allowedTools` | `"Edit,Read,Bash(git:*)"` | Restrict which tools Claude can use |
| `--max-turns` | `25` | Maximum number of agentic turns |
| `--system-prompt` | `"Follow CLAUDE.md"` | Additional system prompt instructions |
| `--mcp-config` | `.mcp.json` | Path to MCP server configuration |
| `--json-schema` | `'{"type":"object"}'` | JSON schema for structured output |
