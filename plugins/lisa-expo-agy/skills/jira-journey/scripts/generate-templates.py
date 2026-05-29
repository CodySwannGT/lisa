#!/usr/bin/env python3
"""Generate evidence comment templates from captured screenshots.

Scans an evidence directory for screenshots, reads the journey JSON,
and produces comment.txt (JIRA wiki markup) and comment.md (GitHub markdown).

Usage:
    python3 generate-templates.py <TICKET_ID> <PR_NUMBER> <BRANCH_NAME> <EVIDENCE_DIR> [JOURNEY_JSON]

Example:
    python3 generate-templates.py SE-3820 1299 fix/SE-3820-mobile ./evidence journey.json

If JOURNEY_JSON is not provided, reads from stdin.
"""

import json
import os
import re
import subprocess
import sys
from pathlib import Path


def get_jira_server():
    """Read JIRA server URL from jira-cli config."""
    config_path = Path.home() / ".config" / ".jira" / ".config.yml"
    if not config_path.exists():
        print(f"ERROR: jira-cli config not found at {config_path}", file=sys.stderr)
        sys.exit(1)

    server = ""
    with open(config_path) as f:
        for line in f:
            if line.startswith("server:"):
                server = line.split(":", 1)[1].strip()
                break

    if not server:
        print("ERROR: Could not read server from jira-cli config", file=sys.stderr)
        sys.exit(1)

    return server


def get_github_repo():
    """Detect GitHub repo from gh CLI."""
    try:
        result = subprocess.run(
            ["gh", "repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"],
            capture_output=True, text=True, timeout=10,
        )
        return result.stdout.strip()
    except (subprocess.SubprocessError, FileNotFoundError):
        return ""


def collect_screenshots(evidence_dir):
    """Collect screenshot files sorted by name."""
    evidence_path = Path(evidence_dir)
    screenshots = []
    for ext in ("*.png", "*.jpg", "*.jpeg", "*.gif"):
        screenshots.extend(evidence_path.glob(ext))
    return sorted(screenshots, key=lambda p: p.name)


def group_by_viewport(screenshots):
    """Group screenshots by viewport suffix.

    Expects filenames like: 01-search-step-desktop.png
    The last segment before .ext is the viewport name.
    """
    groups = {}
    for path in screenshots:
        stem = path.stem  # e.g., "01-search-step-desktop"
        parts = stem.rsplit("-", 1)
        if len(parts) == 2:
            viewport = parts[1]
        else:
            viewport = "unknown"

        if viewport not in groups:
            groups[viewport] = []
        groups[viewport].append(path)

    return groups


def generate_jira_wiki(ticket_id, pr_number, branch, screenshots, journey, gh_repo):
    """Generate JIRA wiki markup comment."""
    lines = []
    lines.append(f"h2. Evidence — PR #{pr_number}")
    lines.append("")
    lines.append(f"*Branch:* {{{{{branch}}}}}")
    lines.append(f"*PR:* [PR #{pr_number}|https://github.com/{gh_repo}/pull/{pr_number}]")
    lines.append("")

    # Verification Results from assertions
    if journey.get("assertions"):
        lines.append("h3. Verification Results")
        lines.append("")
        for assertion in journey["assertions"]:
            lines.append(f"* {assertion}")
        lines.append("")

    # Visual Evidence grouped by viewport
    lines.append("h3. Visual Evidence")
    lines.append("")

    viewport_groups = group_by_viewport(screenshots)

    for viewport_info in journey.get("viewports", []):
        vp_name = viewport_info["name"]
        vp_key = vp_name.lower()
        vp_width = viewport_info["width"]
        vp_height = viewport_info["height"]

        vp_screenshots = viewport_groups.get(vp_key, [])
        if not vp_screenshots:
            continue

        # Use viewport width for JIRA image display, capped at 700
        display_width = min(vp_width, 700)

        lines.append(f"h4. {vp_name} ({vp_width}x{vp_height})")
        lines.append("")

        for img_path in vp_screenshots:
            filename = img_path.name
            # Extract readable label from filename
            stem = img_path.stem
            # Remove NN- prefix and -viewport suffix
            label_parts = stem.split("-")[1:-1]
            label = " ".join(label_parts).title() if label_parts else stem

            lines.append(f"*{label}:*")
            lines.append(f"!{filename}|width={display_width}!")
            lines.append("")

    # Verification Journey steps
    if journey.get("steps"):
        lines.append("h3. Verification Journey")
        lines.append("")
        for step in journey["steps"]:
            text = step["text"]
            # Remove [SCREENSHOT: ...] and [EVIDENCE: ...] markers from display text
            clean_text = re.sub(r'\s*\[(SCREENSHOT|EVIDENCE):\s*[^\]]+\]', '', text).strip()
            lines.append(f"# {clean_text}")
        lines.append("")

    # Viewports table
    if journey.get("viewports"):
        lines.append("h3. Key Viewports")
        lines.append("")
        lines.append("||Viewport||Resolution||")
        for vp in journey["viewports"]:
            lines.append(f"|{vp['name']}|{vp['width']}x{vp['height']}|")
        lines.append("")

    return "\n".join(lines)


def generate_github_md(ticket_id, pr_number, branch, screenshots, journey, gh_repo):
    """Generate GitHub markdown comment."""
    jira_server = get_jira_server()
    release_base = f"https://github.com/{gh_repo}/releases/download/pr-assets"

    lines = []
    lines.append(f"## Evidence — PR #{pr_number}")
    lines.append("")
    lines.append(f"**Branch:** `{branch}`")
    lines.append(f"**Ticket:** [{ticket_id}]({jira_server}/browse/{ticket_id})")
    lines.append("")

    # Verification Results
    if journey.get("assertions"):
        lines.append("### Verification Results")
        lines.append("")
        for assertion in journey["assertions"]:
            lines.append(f"- {assertion}")
        lines.append("")

    # Visual Evidence grouped by viewport
    lines.append("### Visual Evidence")
    lines.append("")

    viewport_groups = group_by_viewport(screenshots)

    for viewport_info in journey.get("viewports", []):
        vp_name = viewport_info["name"]
        vp_key = vp_name.lower()
        vp_width = viewport_info["width"]
        vp_height = viewport_info["height"]

        vp_screenshots = viewport_groups.get(vp_key, [])
        if not vp_screenshots:
            continue

        lines.append(f"#### {vp_name} ({vp_width}x{vp_height})")
        lines.append("")

        for img_path in vp_screenshots:
            filename = img_path.name
            stem = img_path.stem
            label_parts = stem.split("-")[1:-1]
            label = " ".join(label_parts).title() if label_parts else stem

            lines.append(f"**{label}:**")
            lines.append("")
            lines.append(f"![{label}]({release_base}/{filename})")
            lines.append("")

    # Verification Journey
    if journey.get("steps"):
        lines.append("### Verification Journey")
        lines.append("")
        for step in journey["steps"]:
            text = step["text"]
            clean_text = re.sub(r'\s*\[(SCREENSHOT|EVIDENCE):\s*[^\]]+\]', '', text).strip()
            lines.append(f"{step['number']}. {clean_text}")
        lines.append("")

    # Viewports table
    if journey.get("viewports"):
        lines.append("### Key Viewports")
        lines.append("")
        lines.append("| Viewport | Resolution |")
        lines.append("|----------|-----------|")
        for vp in journey["viewports"]:
            lines.append(f"| {vp['name']} | {vp['width']}x{vp['height']} |")
        lines.append("")

    return "\n".join(lines)


def main():
    if len(sys.argv) < 5:
        print(
            "Usage: generate-templates.py <TICKET_ID> <PR_NUMBER> <BRANCH_NAME> <EVIDENCE_DIR> [JOURNEY_JSON]",
            file=sys.stderr,
        )
        sys.exit(1)

    ticket_id = sys.argv[1]
    pr_number = sys.argv[2]
    branch = sys.argv[3]
    evidence_dir = sys.argv[4]
    journey_file = sys.argv[5] if len(sys.argv) > 5 else None

    # Read journey JSON
    if journey_file:
        with open(journey_file) as f:
            journey = json.load(f)
    else:
        journey = json.load(sys.stdin)

    gh_repo = get_github_repo()
    if not gh_repo:
        print("ERROR: Could not detect GitHub repo — ensure gh CLI is authenticated", file=sys.stderr)
        sys.exit(1)

    screenshots = collect_screenshots(evidence_dir)
    if not screenshots:
        print(f"ERROR: No screenshots found in {evidence_dir}", file=sys.stderr)
        sys.exit(1)

    # Generate templates
    jira_wiki = generate_jira_wiki(ticket_id, pr_number, branch, screenshots, journey, gh_repo)
    github_md = generate_github_md(ticket_id, pr_number, branch, screenshots, journey, gh_repo)

    # Write templates
    evidence_path = Path(evidence_dir)
    (evidence_path / "comment.txt").write_text(jira_wiki)
    (evidence_path / "comment.md").write_text(github_md)

    print(f"Generated {evidence_path / 'comment.txt'} ({len(jira_wiki)} bytes)")
    print(f"Generated {evidence_path / 'comment.md'} ({len(github_md)} bytes)")
    print(f"Screenshots: {len(screenshots)}")


if __name__ == "__main__":
    main()
