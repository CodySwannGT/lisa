# gained-semver@demo-marketplace — routing matrix (fixture: approved before upstream published a semver)

An artifact approved while the upstream published no semver, so it records
`upstreamVersion: "unknown"` and carries no `synced-from` pins. Valid against
`cache-before-semver/`; stale against `cache/`, where a `1.0.1` sibling dir appeared.

| agent | outcome | rationale |
| --- | --- | --- |
| codex | reimplement | no plugin command surface |
| cursor | claude-only | reads .claude-plugin natively |
| agy | reimplement | no plugin command surface |
| copilot | enable-vendor-equivalent | vendor equivalent exists |
| devin | reimplement | reimplemented in Lisa's Devin variant |
