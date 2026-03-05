#!/usr/bin/env python3
"""Generate evidence comment templates from captured text evidence.

Scans an evidence directory for text/JSON evidence files, reads the journey JSON,
and produces comment.txt (JIRA wiki markup) and comment.md (GitHub markdown).

Usage:
    python3 generate-templates.py <TICKET_ID> <PR_NUMBER> <BRANCH_NAME> <EVIDENCE_DIR> [JOURNEY_JSON]

Example:
    python3 generate-templates.py PROJ-123 42 fix/PROJ-123-api ./evidence journey.json

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
        return ""
    with open(config_path) as f:
        for line in f:
            if line.startswith("server:"):
                return line.split(":", 1)[1].strip()
    return ""


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


def collect_evidence(evidence_dir):
    """Collect evidence files (text, JSON, and images) sorted by name."""
    evidence_path = Path(evidence_dir)
    files = []
    for pattern in ("[0-9][0-9]-*.txt", "[0-9][0-9]-*.json", "[0-9][0-9]-*.png"):
        files.extend(evidence_path.glob(pattern))
    # Exclude comment.txt
    files = [f for f in files if f.name != "comment.txt"]
    return sorted(files, key=lambda p: p.name)


def detect_language(filename, content):
    """Detect code block language from filename extension and content."""
    if filename.endswith(".json"):
        return "json"
    if "HTTP/" in content or "curl" in content.lower():
        return "http"
    if "CREATE TABLE" in content or "ALTER TABLE" in content or "\\d " in content:
        return "sql"
    return "text"


def generate_jira_wiki(ticket_id, pr_number, branch, evidence_files, journey, gh_repo):
    """Generate JIRA wiki markup comment with code block evidence."""
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

    # Evidence
    lines.append("h3. Evidence")
    lines.append("")

    for evidence_path in evidence_files:
        filename = evidence_path.name
        stem = evidence_path.stem
        # Extract readable label: remove NN- prefix
        label_parts = stem.split("-")[1:]
        label = " ".join(label_parts).title() if label_parts else stem

        if filename.endswith(".png"):
            display_width = 700
            lines.append(f"*{label}:*")
            lines.append(f"!{filename}|width={display_width}!")
            lines.append("")
        else:
            content = evidence_path.read_text().strip()
            lang = detect_language(filename, content)
            lines.append(f"*{label}:*")
            lines.append(f"{{code:{lang}}}")
            lines.append(content)
            lines.append("{code}")
            lines.append("")

    # Verification Journey steps
    if journey.get("steps"):
        lines.append("h3. Verification Journey")
        lines.append("")
        for step in journey["steps"]:
            text = step["text"]
            clean_text = re.sub(r'\s*\[(SCREENSHOT|EVIDENCE):\s*[^\]]+\]', '', text).strip()
            lines.append(f"# {clean_text}")
        lines.append("")

    return "\n".join(lines)


def generate_github_md(ticket_id, pr_number, branch, evidence_files, journey, gh_repo, jira_server):
    """Generate GitHub markdown comment with code block evidence."""
    release_base = f"https://github.com/{gh_repo}/releases/download/pr-assets"

    lines = []
    lines.append(f"## Evidence — PR #{pr_number}")
    lines.append("")
    lines.append(f"**Branch:** `{branch}`")
    if jira_server:
        lines.append(f"**Ticket:** [{ticket_id}]({jira_server}/browse/{ticket_id})")
    else:
        lines.append(f"**Ticket:** {ticket_id}")
    lines.append("")

    # Verification Results
    if journey.get("assertions"):
        lines.append("### Verification Results")
        lines.append("")
        for assertion in journey["assertions"]:
            lines.append(f"- {assertion}")
        lines.append("")

    # Evidence
    lines.append("### Evidence")
    lines.append("")

    for evidence_path in evidence_files:
        filename = evidence_path.name
        stem = evidence_path.stem
        label_parts = stem.split("-")[1:]
        label = " ".join(label_parts).title() if label_parts else stem

        if filename.endswith(".png"):
            lines.append(f"**{label}:**")
            lines.append("")
            lines.append(f"![{label}]({release_base}/{filename})")
            lines.append("")
        else:
            content = evidence_path.read_text().strip()
            lang = detect_language(filename, content)
            lines.append(f"**{label}:**")
            lines.append("")
            lines.append(f"```{lang}")
            lines.append(content)
            lines.append("```")
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

    jira_server = get_jira_server()

    evidence_files = collect_evidence(evidence_dir)
    if not evidence_files:
        print(f"ERROR: No evidence files found in {evidence_dir}", file=sys.stderr)
        sys.exit(1)

    # Generate templates
    jira_wiki = generate_jira_wiki(ticket_id, pr_number, branch, evidence_files, journey, gh_repo)
    github_md = generate_github_md(ticket_id, pr_number, branch, evidence_files, journey, gh_repo, jira_server)

    # Write templates
    evidence_path = Path(evidence_dir)
    (evidence_path / "comment.txt").write_text(jira_wiki)
    (evidence_path / "comment.md").write_text(github_md)

    print(f"Generated {evidence_path / 'comment.txt'} ({len(jira_wiki)} bytes)")
    print(f"Generated {evidence_path / 'comment.md'} ({len(github_md)} bytes)")
    print(f"Evidence files: {len(evidence_files)}")


if __name__ == "__main__":
    main()
