#!/usr/bin/env python3
"""Parse the Validation Journey section from a JIRA ticket description.

Fetches the ticket via REST API, extracts the Validation Journey section
(ADF or wiki markup), and outputs structured JSON to stdout.

Usage:
    python3 parse-plan.py <TICKET_ID>

Example:
    python3 parse-plan.py SE-3820

Output (JSON):
    {
      "ticket": "SE-3820",
      "prerequisites": ["Backend running", "Admin user"],
      "steps": [
        {"number": 1, "text": "Navigate to page", "screenshot": null},
        {"number": 2, "text": "Click button [SCREENSHOT: btn]", "screenshot": "btn"}
      ],
      "viewports": [
        {"name": "Desktop", "width": 1512, "height": 768}
      ],
      "assertions": ["Modal fills screen"]
    }
"""

import json
import os
import re
import subprocess
import sys
import urllib.request
from base64 import b64encode
from pathlib import Path


def get_jira_config():
    """Read JIRA server and login from jira-cli config."""
    config_path = Path.home() / ".config" / ".jira" / ".config.yml"
    if not config_path.exists():
        print(f"ERROR: jira-cli config not found at {config_path}", file=sys.stderr)
        sys.exit(1)

    server = ""
    login = ""
    with open(config_path) as f:
        for line in f:
            if line.startswith("server:"):
                server = line.split(":", 1)[1].strip()
            elif line.startswith("login:"):
                login = line.split(":", 1)[1].strip()

    token = os.environ.get("JIRA_API_TOKEN", "")
    if not token:
        print("ERROR: JIRA_API_TOKEN env var not set", file=sys.stderr)
        sys.exit(1)

    return server, login, token


def fetch_ticket(server, login, token, ticket_id):
    """Fetch JIRA ticket via REST API v3 (returns ADF description)."""
    url = f"{server}/rest/api/3/issue/{ticket_id}?fields=description"
    auth = b64encode(f"{login}:{token}".encode()).decode()

    req = urllib.request.Request(url, headers={
        "Authorization": f"Basic {auth}",
        "Accept": "application/json",
    })

    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        print(f"ERROR: JIRA API returned {e.code} for {ticket_id}", file=sys.stderr)
        sys.exit(1)


def extract_text_from_adf(node):
    """Recursively extract plain text from an ADF node."""
    if isinstance(node, str):
        return node

    if isinstance(node, dict):
        node_type = node.get("type", "")

        if node_type == "text":
            return node.get("text", "")

        if node_type == "hardBreak":
            return "\n"

        parts = []
        for child in node.get("content", []):
            parts.append(extract_text_from_adf(child))
        return "".join(parts)

    if isinstance(node, list):
        return "".join(extract_text_from_adf(item) for item in node)

    return ""


def find_heading_index(content, heading_text, level=None):
    """Find the index of a heading node matching the given text."""
    for i, node in enumerate(content):
        if node.get("type") != "heading":
            continue
        if level is not None and node.get("attrs", {}).get("level") != level:
            continue
        text = extract_text_from_adf(node).strip().lower()
        if heading_text.lower() in text:
            return i
    return -1


def extract_section_content(content, start_idx, same_level=True):
    """Extract all nodes between a heading and the next heading of same or higher level."""
    if start_idx < 0 or start_idx >= len(content):
        return []

    heading_level = content[start_idx].get("attrs", {}).get("level", 2)
    nodes = []

    for i in range(start_idx + 1, len(content)):
        node = content[i]
        if node.get("type") == "heading":
            node_level = node.get("attrs", {}).get("level", 2)
            if same_level and node_level <= heading_level:
                break
        nodes.append(node)

    return nodes


def parse_prerequisites(nodes):
    """Extract prerequisite strings from ADF nodes (bullet lists or paragraphs)."""
    prerequisites = []
    for node in nodes:
        if node.get("type") == "bulletList":
            for item in node.get("content", []):
                text = extract_text_from_adf(item).strip()
                if text:
                    prerequisites.append(text)
        elif node.get("type") == "paragraph":
            text = extract_text_from_adf(node).strip()
            if text:
                prerequisites.append(text)
    return prerequisites


def clean_step_text(text, screenshot_name):
    """Remove [SCREENSHOT: ...] or [EVIDENCE: ...] marker from step text and deduplicate."""
    # Remove the marker itself
    cleaned = re.sub(r'\[(SCREENSHOT|EVIDENCE):\s*[^\]]+\]\s*', '', text).strip()

    # Deduplicate: if the same phrase appears twice consecutively, keep one
    # This handles ADF text node concatenation artifacts
    words = cleaned.split()
    mid = len(words) // 2
    if mid > 2 and words[:mid] == words[mid:2 * mid]:
        cleaned = " ".join(words[:mid] + words[2 * mid:])

    return cleaned


def parse_steps(nodes):
    """Extract ordered steps with optional [SCREENSHOT: name] or [EVIDENCE: name] markers."""
    steps = []
    step_number = 0

    for node in nodes:
        if node.get("type") == "orderedList":
            for item in node.get("content", []):
                step_number += 1
                text = extract_text_from_adf(item).strip()

                screenshot = None
                match = re.search(r'\[(SCREENSHOT|EVIDENCE):\s*([^\]]+)\]', text)
                if match:
                    screenshot = match.group(2).strip()

                display_text = clean_step_text(text, screenshot) if screenshot else text

                steps.append({
                    "number": step_number,
                    "text": display_text,
                    "screenshot": screenshot,
                })
        elif node.get("type") == "paragraph":
            text = extract_text_from_adf(node).strip()
            if text and re.match(r'^\d+\.?\s', text):
                step_number += 1
                screenshot = None
                match = re.search(r'\[(SCREENSHOT|EVIDENCE):\s*([^\]]+)\]', text)
                if match:
                    screenshot = match.group(2).strip()

                clean_text = re.sub(r'^\d+\.?\s*', '', text)
                display_text = clean_step_text(clean_text, screenshot) if screenshot else clean_text
                steps.append({
                    "number": step_number,
                    "text": display_text,
                    "screenshot": screenshot,
                })

    return steps


def parse_viewports(nodes):
    """Extract viewport definitions from ADF table nodes.

    Supports two table formats:
    - 3 columns: Name | Width | Height
    - 2 columns: Name | Resolution (WxH)
    """
    viewports = []

    for node in nodes:
        if node.get("type") == "table":
            rows = node.get("content", [])
            for row in rows:
                if row.get("type") != "tableRow":
                    continue

                cells = row.get("content", [])
                if not cells:
                    continue

                # Skip header row (tableHeader cells)
                if cells[0].get("type") == "tableHeader":
                    continue

                cell_texts = [extract_text_from_adf(c).strip() for c in cells]

                # 3-column format: Name | Width | Height
                if len(cell_texts) >= 3:
                    name = cell_texts[0]
                    try:
                        width = int(cell_texts[1])
                        height = int(cell_texts[2])
                        viewports.append({
                            "name": name,
                            "width": width,
                            "height": height,
                        })
                        continue
                    except ValueError:
                        pass

                # 2-column format: Name | WxH (e.g., "1512x768")
                if len(cell_texts) >= 2:
                    name = cell_texts[0]
                    resolution = cell_texts[1]
                    match = re.match(r'(\d+)\s*[xX\u00d7]\s*(\d+)', resolution)
                    if match:
                        viewports.append({
                            "name": name,
                            "width": int(match.group(1)),
                            "height": int(match.group(2)),
                        })

    return viewports


def parse_assertions(nodes):
    """Extract assertion strings from ADF nodes."""
    assertions = []
    for node in nodes:
        if node.get("type") == "bulletList":
            for item in node.get("content", []):
                text = extract_text_from_adf(item).strip()
                if text:
                    assertions.append(text)
        elif node.get("type") == "orderedList":
            for item in node.get("content", []):
                text = extract_text_from_adf(item).strip()
                if text:
                    assertions.append(text)
        elif node.get("type") == "paragraph":
            text = extract_text_from_adf(node).strip()
            if text and text.startswith("-"):
                assertions.append(text.lstrip("- ").strip())
            elif text:
                assertions.append(text)
    return assertions


def parse_adf_journey(description_adf):
    """Parse the Validation Journey from an ADF description object."""
    content = description_adf.get("content", [])

    # Find the "Validation Journey" h2 heading
    journey_idx = find_heading_index(content, "validation journey", level=2)
    if journey_idx < 0:
        # Try without level constraint
        journey_idx = find_heading_index(content, "validation journey")

    if journey_idx < 0:
        print("ERROR: No 'Validation Journey' section found in ticket description", file=sys.stderr)
        sys.exit(1)

    # Extract sub-sections
    prereq_idx = find_heading_index(content, "prerequisites", level=3)
    steps_idx = find_heading_index(content, "steps", level=3)
    viewports_idx = find_heading_index(content, "viewports", level=3)
    assertions_idx = find_heading_index(content, "assertions", level=3)

    prerequisites = []
    if prereq_idx >= 0:
        prereq_nodes = extract_section_content(content, prereq_idx)
        prerequisites = parse_prerequisites(prereq_nodes)

    steps = []
    if steps_idx >= 0:
        steps_nodes = extract_section_content(content, steps_idx)
        steps = parse_steps(steps_nodes)

    viewports = []
    if viewports_idx >= 0:
        viewport_nodes = extract_section_content(content, viewports_idx)
        viewports = parse_viewports(viewport_nodes)

    assertions = []
    if assertions_idx >= 0:
        assertion_nodes = extract_section_content(content, assertions_idx)
        assertions = parse_assertions(assertion_nodes)

    # Fallback: if no viewports defined, use Desktop as default
    if not viewports:
        viewports = [{"name": "Desktop", "width": 1512, "height": 768}]

    return {
        "prerequisites": prerequisites,
        "steps": steps,
        "viewports": viewports,
        "assertions": assertions,
    }


def main():
    if len(sys.argv) < 2:
        print("Usage: parse-plan.py <TICKET_ID>", file=sys.stderr)
        sys.exit(1)

    ticket_id = sys.argv[1]
    server, login, token = get_jira_config()
    ticket_data = fetch_ticket(server, login, token, ticket_id)

    description = ticket_data.get("fields", {}).get("description")
    if not description:
        print(f"ERROR: Ticket {ticket_id} has no description", file=sys.stderr)
        sys.exit(1)

    # ADF description is a dict, wiki markup is a string
    if isinstance(description, dict):
        result = parse_adf_journey(description)
    else:
        print("ERROR: Wiki markup parsing not implemented. Use JIRA API v3 (ADF format).", file=sys.stderr)
        sys.exit(1)

    result["ticket"] = ticket_id
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
