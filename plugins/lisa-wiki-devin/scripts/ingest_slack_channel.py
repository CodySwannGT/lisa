#!/usr/bin/env python3
"""Ingest a Slack channel with a Slack user token.

The script writes normalized source notes under wiki/sources/slack/ and keeps a
per-channel cursor under wiki/state/slack/. It uses a user token (`xoxp-...`) so
access follows the authorizing user's Slack visibility.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


TOKEN_PATTERNS = [
    (re.compile(r"xox[pbar]-[A-Za-z0-9-]+"), "[REDACTED:OAUTH_TOKEN]"),
    (
        re.compile(r"(?i)bearer\s+[A-Za-z0-9._~+/=-]{20,}"),
        "[REDACTED:OAUTH_TOKEN]",
    ),
    (re.compile(r"AKIA[0-9A-Z]{16}"), "[REDACTED:API_KEY]"),
    (
        re.compile(
            r"-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----",
            re.S,
        ),
        "[REDACTED:PRIVATE_KEY]",
    ),
    (
        re.compile(r"\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b"),
        "[REDACTED:SSN]",
    ),
    (
        re.compile(
            r"\b(?:password|passwd|pwd)\s*[:=]\s*(['\"]?)([^\s'\",;]{8,})\1",
            re.I,
        ),
        "[REDACTED:PASSWORD]",
    ),
    (
        re.compile(
            r"\b(?:api[_-]?key|access[_-]?key|secret[_-]?key|client[_-]?secret)\s*[:=]\s*(['\"]?)([A-Za-z0-9._-]{20,})\1",
            re.I,
        ),
        "[REDACTED:API_KEY]",
    ),
]


def utc_now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0)


def iso_from_ts(ts: str) -> str:
    seconds = float(ts)
    return dt.datetime.fromtimestamp(seconds, dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def ts_from_input(value: str | None) -> str | None:
    if not value:
        return None
    if re.fullmatch(r"\d+(?:\.\d+)?", value):
        return value
    parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    return f"{parsed.timestamp():.6f}"


def redact(text: str) -> str:
    out = text
    for pattern, replacement in TOKEN_PATTERNS:
        out = pattern.sub(
            lambda match: match.group(0).replace(match.group(2), replacement)
            if len(match.groups()) >= 2
            else replacement,
            out,
        )
    return out


def load_token(args: argparse.Namespace) -> str:
    if args.token:
        return args.token
    if args.token_file:
        payload = json.loads(Path(args.token_file).read_text(encoding="utf-8"))
        token = payload.get("access_token") or (payload.get("authed_user") or {}).get("access_token")
        if token:
            return token
    env_token = os.environ.get("SLACK_USER_TOKEN")
    if env_token:
        return env_token
    raise SystemExit("Provide --token, --token-file, or SLACK_USER_TOKEN.")


class SlackClient:
    def __init__(self, token: str) -> None:
        self.token = token

    def call(self, method: str, params: dict[str, Any] | None = None, retries: int = 5) -> dict[str, Any]:
        params = params or {}
        body = urllib.parse.urlencode({k: v for k, v in params.items() if v is not None}).encode("utf-8")
        request = urllib.request.Request(
            f"https://slack.com/api/{method}",
            data=body,
            headers={
                "Authorization": f"Bearer {self.token}",
                "Content-Type": "application/x-www-form-urlencoded",
                "Accept": "application/json",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            if error.code == 429 and retries > 0:
                retry_after = int(error.headers.get("Retry-After", "60"))
                time.sleep(retry_after)
                return self.call(method, params, retries - 1)
            raise
        if not payload.get("ok"):
            raise RuntimeError(f"Slack API {method} failed: {payload}")
        return payload


def resolve_channel(client: SlackClient, channel: str) -> dict[str, Any]:
    if re.fullmatch(r"[CGD][A-Z0-9]+", channel):
        info = client.call("conversations.info", {"channel": channel})
        return info["channel"]

    wanted = channel.lstrip("#")
    cursor = None
    while True:
        payload = client.call(
            "conversations.list",
            {
                "types": "public_channel,private_channel",
                "exclude_archived": "false",
                "limit": 1000,
                "cursor": cursor,
            },
        )
        for item in payload.get("channels", []):
            if item.get("name") == wanted:
                return item
        cursor = (payload.get("response_metadata") or {}).get("next_cursor")
        if not cursor:
            break
    raise SystemExit(f"Could not resolve Slack channel {channel!r}.")


def fetch_history(
    client: SlackClient,
    channel_id: str,
    oldest: str | None,
    latest: str | None,
    page_limit: int | None,
    limit: int,
) -> list[dict[str, Any]]:
    messages: list[dict[str, Any]] = []
    cursor = None
    pages = 0
    while True:
        payload = client.call(
            "conversations.history",
            {
                "channel": channel_id,
                "oldest": oldest,
                "latest": latest,
                "inclusive": "false",
                "limit": limit,
                "cursor": cursor,
            },
        )
        messages.extend(payload.get("messages", []))
        pages += 1
        cursor = (payload.get("response_metadata") or {}).get("next_cursor")
        if not cursor or (page_limit and pages >= page_limit):
            break
    return sorted(messages, key=lambda item: float(item.get("ts", "0")))


def fetch_replies(client: SlackClient, channel_id: str, thread_ts: str) -> list[dict[str, Any]]:
    replies: list[dict[str, Any]] = []
    cursor = None
    while True:
        payload = client.call(
            "conversations.replies",
            {"channel": channel_id, "ts": thread_ts, "limit": 1000, "cursor": cursor},
        )
        replies.extend(payload.get("messages", []))
        cursor = (payload.get("response_metadata") or {}).get("next_cursor")
        if not cursor:
            break
    return [reply for reply in replies if reply.get("ts") != thread_ts]


def render_message(message: dict[str, Any], user_map: dict[str, str] | None = None) -> list[str]:
    ts = message.get("ts", "")
    user = message.get("user") or message.get("bot_id") or message.get("username") or "unknown"
    if user_map and user in user_map:
        user = f"{user_map[user]} ({user})"
    lines = [f"### {iso_from_ts(ts)} - {user}", "", f"- ts: `{ts}`"]
    if message.get("thread_ts") and message.get("thread_ts") != ts:
        lines.append(f"- thread_ts: `{message['thread_ts']}`")
    if message.get("permalink"):
        lines.append(f"- permalink: {message['permalink']}")
    text = redact(message.get("text") or "")
    lines.extend(["", "```text", text, "```", ""])
    return lines


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--channel", required=True, help="Channel ID or #channel-name.")
    parser.add_argument("--token", help="Slack user token. Prefer SLACK_USER_TOKEN or --token-file.")
    parser.add_argument("--token-file", help="JSON file from scripts/slack_oauth_user.py.")
    parser.add_argument("--oldest", help="Slack ts or ISO timestamp. Defaults to previous state with overlap.")
    parser.add_argument("--latest", help="Slack ts or ISO timestamp.")
    parser.add_argument("--limit", type=int, default=200, help="Slack page size.")
    parser.add_argument("--page-limit", type=int, help="Stop after this many history pages.")
    parser.add_argument("--no-threads", action="store_true", help="Skip thread replies.")
    parser.add_argument("--thread-lookback-days", type=int, default=14)
    parser.add_argument("--source-dir", default="wiki/sources/slack")
    parser.add_argument("--state-dir", default="wiki/state/slack",
                        help="Read-only: prior cursor is read here for windowing. Final state is advanced by the kernel.")
    parser.add_argument("--config", help="Path to wiki/lisa-wiki.config.json for the Slack tenant guard.")
    parser.add_argument("--emit-meta", help="Write the PROPOSED cursor here; the kernel advances final state after verification.")
    parser.add_argument("--title", help="Optional source-note title.")
    args = parser.parse_args()

    token = load_token(args)
    client = SlackClient(token)

    # Tenant guard: verify the authorized Slack workspace matches config before ingesting.
    # (external-write does not exempt tenant guards.)
    if args.config:
        try:
            cfg = json.loads(Path(args.config).read_text(encoding="utf-8"))
        except Exception:
            cfg = {}
        guard = (((cfg.get("connectors") or {}).get("slack") or {}).get("tenantGuard")) or {}
        if guard:
            ident = client.call("auth.test")
            want_team = guard.get("teamId") or guard.get("team_id")
            want_url = guard.get("url")
            if want_team and ident.get("team_id") != want_team:
                raise SystemExit(f"Slack tenant guard: team_id {ident.get('team_id')!r} != configured {want_team!r}; aborting.")
            if want_url and want_url not in (ident.get("url") or ""):
                raise SystemExit(f"Slack tenant guard: workspace url {ident.get('url')!r} != configured {want_url!r}; aborting.")

    channel = resolve_channel(client, args.channel)
    channel_id = channel["id"]
    channel_name = channel.get("name") or channel_id

    state_dir = Path(args.state_dir)
    state_dir.mkdir(parents=True, exist_ok=True)
    state_path = state_dir / f"{channel_id}.json"
    previous_state = json.loads(state_path.read_text(encoding="utf-8")) if state_path.exists() else {}

    oldest = ts_from_input(args.oldest)
    if oldest is None and previous_state.get("latest_message_ts"):
        overlap_seconds = args.thread_lookback_days * 24 * 60 * 60
        oldest_float = max(0.0, float(previous_state["latest_message_ts"]) - overlap_seconds)
        oldest = f"{oldest_float:.6f}"
    latest = ts_from_input(args.latest)

    messages = fetch_history(client, channel_id, oldest, latest, args.page_limit, args.limit)
    reply_count = 0
    if not args.no_threads:
        for message in messages:
            if message.get("reply_count") and message.get("thread_ts", message.get("ts")) == message.get("ts"):
                replies = fetch_replies(client, channel_id, message["ts"])
                message["ingested_replies"] = sorted(replies, key=lambda item: float(item.get("ts", "0")))
                reply_count += len(replies)

    now = utc_now()
    stamp = now.strftime("%Y-%m-%d-%H%M%S")
    source_dir = Path(args.source_dir)
    source_dir.mkdir(parents=True, exist_ok=True)
    safe_name = re.sub(r"[^A-Za-z0-9_.-]+", "-", channel_name).strip("-") or channel_id
    source_path = source_dir / f"{stamp}-{safe_name}-{channel_id}.md"
    title = args.title or f"Slack Channel Ingest - #{channel_name}"

    lines = [
        "---",
        "type: source",
        f"created: {now.date()}",
        f"updated: {now.date()}",
        "source_system: slack",
        f"channel_id: {channel_id}",
        f"channel_name: {channel_name}",
        "sources: []",
        "---",
        "",
        f"# {title}",
        "",
        f"- Ingested at: `{now.isoformat().replace('+00:00', 'Z')}`",
        f"- Channel: `#{channel_name}` (`{channel_id}`)",
        f"- Oldest cursor: `{oldest or '0'}`",
        f"- Latest cursor: `{latest or 'now'}`",
        f"- Messages: `{len(messages)}`",
        f"- Thread replies: `{reply_count}`",
        "",
        "## Messages",
        "",
    ]
    for message in messages:
        lines.extend(render_message(message))
        replies = message.get("ingested_replies") or []
        if replies:
            lines.extend(["#### Thread Replies", ""])
            for reply in replies:
                lines.extend(render_message(reply))

    source_path.write_text(redact("\n".join(lines)), encoding="utf-8")

    latest_ts = previous_state.get("latest_message_ts")
    if messages:
        latest_ts = max([message["ts"] for message in messages] + ([latest_ts] if latest_ts else []), key=float)

    notes = previous_state.get("source_notes") or []
    source_note = str(source_path)
    if source_note not in notes:
        notes.append(source_note)

    # Per the connector contract, the connector does NOT advance final state — it emits a
    # PROPOSED cursor and the kernel writes wiki/state/slack/<channel>.json after verification.
    proposed_cursor = {
        "connector": "slack",
        "channel_id": channel_id,
        "channel_name": channel_name,
        "ran_at": now.isoformat().replace("+00:00", "Z"),
        "latest_message_ts": latest_ts,
        "latest_message_at": iso_from_ts(latest_ts) if latest_ts else None,
        "last_message_count": len(messages),
        "last_thread_reply_count": reply_count,
        "source_notes": notes,
    }

    print(f"Wrote {source_path}")
    if args.emit_meta:
        meta_path = Path(args.emit_meta)
        meta_path.parent.mkdir(parents=True, exist_ok=True)
        meta_path.write_text(json.dumps({"proposedCursor": proposed_cursor}, indent=2) + "\n", encoding="utf-8")
        print(f"Emitted proposed cursor {meta_path} (kernel advances final state after verification)")
    else:
        print("No --emit-meta given; proposed cursor not persisted (final state is advanced by the kernel).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
