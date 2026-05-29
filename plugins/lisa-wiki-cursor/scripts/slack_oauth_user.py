#!/usr/bin/env python3
"""Run a local Slack OAuth flow for a user token.

This helper intentionally requests user scopes, not bot scopes. It stores the
OAuth response in an ignored local file by default; do not commit that file.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import secrets
import stat
import sys
import urllib.parse
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path


DEFAULT_SCOPES = ",".join(
    [
        "channels:read",
        "channels:history",
        "groups:read",
        "groups:history",
        "users:read",
        "files:read",
    ]
)


class OAuthHandler(BaseHTTPRequestHandler):
    server: "OAuthServer"

    def log_message(self, fmt: str, *args: object) -> None:
        return

    def do_GET(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)
        state = params.get("state", [""])[0]
        code = params.get("code", [""])[0]
        error = params.get("error", [""])[0]

        if error:
            self.server.error = error
            self._respond(400, f"Slack OAuth failed: {error}")
            return

        if state != self.server.expected_state:
            self.server.error = "state_mismatch"
            self._respond(400, "Slack OAuth failed: state mismatch.")
            return

        if not code:
            self.server.error = "missing_code"
            self._respond(400, "Slack OAuth failed: missing code.")
            return

        self.server.code = code
        self._respond(200, "Slack OAuth complete. You can return to the terminal.")

    def _respond(self, status: int, body: str) -> None:
        data = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


class OAuthServer(HTTPServer):
    expected_state: str
    code: str | None
    error: str | None


def exchange_code(
    *,
    client_id: str,
    client_secret: str,
    code: str,
    redirect_uri: str,
) -> dict:
    body = urllib.parse.urlencode(
        {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri,
        }
    ).encode("utf-8")
    basic = base64.b64encode(f"{client_id}:{client_secret}".encode("utf-8")).decode("ascii")
    request = urllib.request.Request(
        "https://slack.com/api/oauth.v2.access",
        data=body,
        headers={
            "Authorization": f"Basic {basic}",
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.loads(response.read().decode("utf-8"))
    if not payload.get("ok"):
        raise RuntimeError(f"Slack token exchange failed: {payload}")
    return payload


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--client-id", default=os.environ.get("SLACK_CLIENT_ID"))
    parser.add_argument("--client-secret", default=os.environ.get("SLACK_CLIENT_SECRET"))
    parser.add_argument("--redirect-uri", default="http://localhost:8765/slack/oauth/callback")
    parser.add_argument("--scopes", default=os.environ.get("SLACK_USER_SCOPES", DEFAULT_SCOPES))
    parser.add_argument("--output", default=".secrets/slack-user-token.json")
    parser.add_argument("--no-open", action="store_true", help="Print the URL without opening a browser.")
    args = parser.parse_args()

    if not args.client_id or not args.client_secret:
        parser.error("Provide --client-id/--client-secret or SLACK_CLIENT_ID/SLACK_CLIENT_SECRET.")

    redirect = urllib.parse.urlparse(args.redirect_uri)
    if redirect.hostname not in {"localhost", "127.0.0.1"}:
        parser.error("This helper only starts a localhost callback server.")

    state = secrets.token_urlsafe(32)
    query = urllib.parse.urlencode(
        {
            "client_id": args.client_id,
            "user_scope": args.scopes,
            "redirect_uri": args.redirect_uri,
            "state": state,
        }
    )
    authorize_url = f"https://slack.com/oauth/v2/authorize?{query}"

    server = OAuthServer((redirect.hostname or "localhost", redirect.port or 80), OAuthHandler)
    server.expected_state = state
    server.code = None
    server.error = None

    print("Open this URL to authorize Slack user-token access:")
    print(authorize_url)
    if not args.no_open:
        webbrowser.open(authorize_url)

    while server.code is None and server.error is None:
        server.handle_request()

    if server.error:
        print(f"OAuth failed: {server.error}", file=sys.stderr)
        return 1

    payload = exchange_code(
        client_id=args.client_id,
        client_secret=args.client_secret,
        code=server.code or "",
        redirect_uri=args.redirect_uri,
    )

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    output.chmod(stat.S_IRUSR | stat.S_IWUSR)

    team = payload.get("team") or {}
    print(f"Saved Slack OAuth response to {output}")
    print(f"Team: {team.get('name') or team.get('id') or 'unknown'}")
    print("Use it with: python3 scripts/ingest_slack_channel.py --token-file " + str(output) + " --channel '#channel-name'")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
