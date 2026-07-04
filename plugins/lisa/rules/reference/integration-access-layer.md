# Integration Access Layer

Every Lisa skill or rule that consumes an external integration MUST route through
the integration's `*-access` skill instead of calling that vendor's MCP tools or
REST API directly.

The access skill owns substrate resolution:

1. MCP, when the tool is available and already authenticated to the configured
   workspace/account.
2. Token/REST substrate, only when the documented env var is present.
3. Loud failure naming the exact env var to set.

Do not blind-retry a failed or absent MCP. Fall back only after checking the
documented env var for that vendor, and never silently no-op when neither tier is
available.

## Access Skills

| Vendor | Access skill | Headless env var | REST/token substrate |
|---|---|---|---|
| Atlassian | `lisa:atlassian-access` | `ATLASSIAN_API_TOKEN` | Atlassian Cloud REST |
| Notion | `lisa:notion-access` | `NOTION_API_TOKEN` | Notion REST |
| Linear | `lisa:linear-access` | `LINEAR_API_KEY` | Linear GraphQL |
| Jam | `lisa:jam-access` | `JAM_PAT` | Jam CLI |
| SonarCloud | `lisa:sonarcloud-access` | `SONAR_TOKEN` | SonarCloud Web API |
| Sentry | `lisa:sentry-access` | `SENTRY_AUTH_TOKEN` | Sentry REST API |
| PostHog | `lisa:posthog-access` | `POSTHOG_PERSONAL_API_KEY` | PostHog REST API |
| Google Play | `lisa-expo:play-store-access` | `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` or `GOOGLE_PLAY_SERVICE_ACCOUNT_KEY_BASE64` | Google Play Developer API |

## Current Coupling Matrix

Source audit date: 2026-06-23. Scope: `plugins/src/**/skills/**` and
`plugins/src/**/rules/**`.

| Vendor | Direct source MCP references | Current route | Retrofit status |
|---|---:|---|---|
| Atlassian | setup-only references plus legacy stack-generated sources | `atlassian-access` for base runtime paths | Done for base hot paths; stack overlays still need sync from base patterns when touched. |
| Notion | setup-only references | `notion-access` | Done. |
| Linear | Multiple base queue/read/write/verify skills | Raw Linear MCP | Access layer added; consumers still need migration to `linear-access`. |
| Jam | None in `plugins/src` at audit time | No access layer | Access layer added for host rules that include Jam triage. |
| SonarCloud | None in `plugins/src` at audit time | No access layer | Access layer added for host rules that include SonarCloud gate triage. |
| Sentry | No Sentry MCP references in `plugins/src`; CLI/REST mentions only | CLI/REST scattered in observability docs | Access layer added for future MCP-backed consumers. |
| PostHog | No PostHog MCP references in `plugins/src`; observability docs mention PostHog detection | No access layer | Access layer added for future MCP-backed consumers. |
| Google Play | No MCP surface; EAS submit docs only | `play-store-access` for Expo post-submit release visibility | Done for Expo stack. |

## Migration Rule For Consumers

When editing any skill listed in the matrix:

- Replace direct `mcp__<vendor>__*` calls in `allowed-tools` with `Skill` and
  delegate to the matching access skill.
- Keep operation names coarse and vendor-native. Add new operation rows to the
  access skill instead of embedding REST details in the consumer.
- Preserve existing MCP behavior as the first tier where Claude/Codex can expose
  the MCP, but make headless token fallback explicit and gated by the env var.
- If a vendor has no documented token substrate, keep the MCP-only behavior and
  fail with a clear "no documented headless substrate" message.
