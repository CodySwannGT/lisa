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


# Strip local capture claims from rendered step prose. EVIDENCE-REF is a
# cross-work-item pointer, so it must remain visible in both JIRA and GitHub
# evidence comments.
LOCAL_EVIDENCE_PATTERN = re.compile(r'\s*\[(SCREENSHOT|EVIDENCE):\s*[^\]]+\]')


def evidence_release():
    """The GitHub release evidence is uploaded to, matching post-evidence.sh.

    LISA_EVIDENCE_RELEASE wins when set. Otherwise ask the project's
    `scripts/lisa-work-item.mjs evidence-release --ensure`, exactly as
    post-evidence.sh does, so a configured rotation such as
    `pr-assets-{YYYY-MM}` reaches these links too (CodySwannGT/lisa#4692) and
    both name the same overflow release when the current one is full
    (CodySwannGT/lisa#4838); plain `evidence-release` would name the full
    release and every link would 404. `--ensure` creates the release when it
    is absent and fails only when a pinned release is full, every overflow
    release is full, the release name is too long to take an overflow suffix,
    or the release cannot be created. A host without the resolver keeps the legacy `pr-assets` release.
    """
    configured = os.environ.get("LISA_EVIDENCE_RELEASE", "").strip()
    if configured:
        return configured
    try:
        root = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True, text=True, check=True,
        ).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        root = os.getcwd()
    cli = Path(root) / "scripts" / "lisa-work-item.mjs"
    if cli.is_file():
        result = subprocess.run(
            ["node", str(cli), "evidence-release", "--ensure"],
            capture_output=True, text=True, cwd=root,
        )
        if result.returncode != 0:
            sys.exit(f"ERROR: could not resolve the evidence release: {result.stderr.strip()}")
        return result.stdout.strip()
    return "pr-assets"


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
    """Collect evidence files (text, JSON, and images) sorted by name.

    Images are NN-*.png only: that is exactly what post-evidence.sh uploads
    and attaches, and it refuses a description that links anything it did
    not upload (CodySwannGT/lisa#4639). Linking a .jpg/.gif would fail it.
    """
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


def screenshot_viewport(stem, journey):
    """Return the journey viewport a screenshot was captured at, or None.

    Screenshot journeys run once per viewport and name each capture
    NN-<marker>-<viewport>.png. A viewport name may itself contain hyphens
    ("Mobile-Landscape"), so each name is matched, case-insensitively, as a
    whole suffix at a hyphen boundary, and the longest matching name wins.
    """
    lowered = stem.lower()
    matches = [
        viewport
        for viewport in journey.get("viewports") or []
        if str(viewport.get("name", ""))
        and lowered.endswith("-" + str(viewport["name"]).lower())
    ]
    return max(matches, key=lambda v: len(str(v["name"])), default=None)


def evidence_label(evidence_path, journey):
    """Readable label for one evidence file, and its viewport when it has one.

    The NN- prefix is dropped. For a screenshot whose name ends in a journey
    viewport, that suffix moves into the label as "(Name WxH)".
    """
    stem = evidence_path.stem
    viewport = screenshot_viewport(stem, journey) if evidence_path.suffix == ".png" else None
    label_parts = stem.split("-")[1:]
    if viewport is not None:
        name_segments = len(str(viewport["name"]).split("-"))
        label_parts = label_parts[:-name_segments]
    label = " ".join(label_parts).title() if label_parts else stem
    if viewport is not None:
        label = f"{label} ({viewport['name']} {viewport['width']}x{viewport['height']})"
    return label, viewport


def viewport_rows(journey):
    """Yield (name, "WxH") for each journey viewport."""
    for viewport in journey.get("viewports") or []:
        yield viewport["name"], f"{viewport['width']}x{viewport['height']}"


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
        label, viewport = evidence_label(evidence_path, journey)

        if filename.endswith(".png"):
            # Show a screenshot at its viewport's width so a mobile capture is
            # not upscaled, capped at 700 to fit the Jira comment column.
            display_width = min(viewport["width"], 700) if viewport else 700
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
            clean_text = LOCAL_EVIDENCE_PATTERN.sub('', text).strip()
            lines.append(f"# {clean_text}")
        lines.append("")

    if journey.get("viewports"):
        lines.append("h3. Key Viewports")
        lines.append("")
        lines.append("||Viewport||Resolution||")
        for name, resolution in viewport_rows(journey):
            lines.append(f"|{name}|{resolution}|")
        lines.append("")

    return "\n".join(lines)


def generate_github_md(ticket_id, pr_number, branch, evidence_files, journey, gh_repo, jira_server):
    """Generate GitHub markdown comment with code block evidence."""
    release_base = f"https://github.com/{gh_repo}/releases/download/{evidence_release()}"

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
        label, _viewport = evidence_label(evidence_path, journey)

        if filename.endswith(".png"):
            lines.append(f"**{label}:**")
            lines.append("")
            # post-evidence.sh stores the asset as pr-<number>-<file> so pull
            # requests sharing the release never overwrite each other's
            # evidence (CodySwannGT/lisa#4639); link exactly that name.
            lines.append(f"![{label}]({release_base}/pr-{pr_number}-{filename})")
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
            clean_text = LOCAL_EVIDENCE_PATTERN.sub('', text).strip()
            lines.append(f"{step['number']}. {clean_text}")
        lines.append("")

    if journey.get("viewports"):
        lines.append("### Key Viewports")
        lines.append("")
        lines.append("| Viewport | Resolution |")
        lines.append("|----------|-----------|")
        for name, resolution in viewport_rows(journey):
            lines.append(f"| {name} | {resolution} |")
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
