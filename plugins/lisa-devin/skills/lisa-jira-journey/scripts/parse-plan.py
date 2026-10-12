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
        {"number": 2, "text": "Click button [EVIDENCE: btn]", "screenshot": "btn"}
      ],
      "viewports": [
        {"name": "Desktop", "width": 1512, "height": 768}
      ],
      "assertions": ["Modal fills screen"]
    }
"""

import ipaddress
import json
import os
import re
import subprocess
import sys
import urllib.request
from base64 import b64encode
from pathlib import Path
from urllib.parse import urlsplit


# Intentionally matches the exact local-claim prefixes only. EVIDENCE-REF is a
# cross-work-item pointer and must remain visible in step prose without becoming
# a capture obligation.
LOCAL_EVIDENCE_PATTERN = re.compile(r'\[(SCREENSHOT|EVIDENCE):\s*([^\]]+)\]')

# One ASCII DNS name: dot-separated labels of letters, digits and inner hyphens.
# IPv4 literals are a subset of this form. Anything else -- percent-encoding, a
# trailing dot, an empty label, a leading or trailing hyphen -- is refused,
# because a hostname this pattern cannot describe is one whose meaning depends
# on who resolves it.
DNS_NAME_PATTERN = re.compile(
    r'^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$'
)

# The only two path spellings that mean "no path".
ROOT_PATHS = ("", "/")

DEFAULT_HTTPS_PORT = 443


class JiraConfigError(Exception):
    """A configured Jira server could not be established as trusted."""


def jira_config_candidates():
    """Return project-first jira-cli config candidates without duplicates."""
    roots = []
    project_dir = os.environ.get("CLAUDE_PROJECT_DIR", "").strip()
    if project_dir:
        roots.append(Path(project_dir).expanduser().resolve())

    current = Path.cwd().resolve()
    roots.extend([current, *current.parents])

    candidates = []
    seen = set()
    for root in roots:
        candidate = root / ".lisa" / "jira-cli" / ".config.yml"
        key = str(candidate)
        if key not in seen:
            candidates.append(candidate)
            seen.add(key)

    home_candidate = (Path.home() / ".config" / ".jira" / ".config.yml").resolve()
    if str(home_candidate) not in seen:
        candidates.append(home_candidate)
    return candidates


def read_jira_config(config_path):
    """Read the server and login fields from one jira-cli config."""
    server = ""
    login = ""
    with open(config_path) as config:
        for line in config:
            if line.startswith("server:"):
                server = line.split(":", 1)[1].strip()
            elif line.startswith("login:"):
                login = line.split(":", 1)[1].strip()
    return server, login


def canonical_authority(netloc, hostname):
    """Return the canonical authority for one host, or "" when it is not one."""
    if netloc.startswith("["):
        try:
            return f"[{ipaddress.IPv6Address(hostname).compressed}]"
        except ValueError:
            return ""
    return hostname if DNS_NAME_PATTERN.match(hostname) else ""


def is_bare_origin(server, parsed):
    """Report whether the raw value names an origin and nothing besides.

    The query and fragment are checked against the raw string rather than the
    parse, because ``https://host?`` and ``https://host`` parse to the same
    empty query. A delimiter carrying nothing is still a component the operator
    wrote and the trust key would discard.
    """
    if "?" in server or "#" in server:
        return False
    if parsed.scheme != "https" or "@" in parsed.netloc:
        return False
    return parsed.path in ROOT_PATHS


def server_origin(server):
    """Return the canonical HTTPS origin, or "" when the value is not one.

    This value is both the credential trust key and the base every request is
    built from, so the two have to be the same string. A normalizer that reduced
    an arbitrary URL to its origin would approve one value and send another:
    userinfo, a query, a fragment, or a path would ride along into the request
    while the trust check saw only the host, which is how an API token reaches a
    URL that validation never approved. So the accepted grammar is a bare
    origin -- ``https://host`` or ``https://host/`` with an optional non-default
    port -- and every richer form is refused rather than trimmed down to fit.

    Self-hosted context paths and internationalized hostnames are deliberately
    out of scope: either needs its own base-path contract, and inventing one
    here would re-open the gap between what is checked and what is sent.
    """
    if not server or any(char <= " " or char >= "\x7f" for char in server):
        return ""
    try:
        parsed = urlsplit(server)
        port = parsed.port
    except ValueError:
        return ""
    if not parsed.hostname or port == 0:
        return ""
    if not is_bare_origin(server, parsed):
        return ""
    authority = canonical_authority(parsed.netloc, parsed.hostname)
    if not authority:
        return ""
    if port is not None and port != DEFAULT_HTTPS_PORT:
        authority = f"{authority}:{port}"
    return f"https://{authority}"


def resolve_trusted_origin():
    """Return the operator-owned origin a checkout config must match, or "".

    An explicit JIRA_SERVER wins over the home config. A JIRA_SERVER that is not
    a canonical origin raises rather than resolving to "": degrading a malformed
    trust root into "no trust root" would silently widen what a checkout config
    is allowed to claim, which is the opposite of what setting it asked for.
    """
    configured = os.environ.get("JIRA_SERVER", "")
    if configured.strip():
        origin = server_origin(configured)
        if not origin:
            raise JiraConfigError(
                "JIRA_SERVER must be a valid HTTPS URL naming one origin, with "
                "no userinfo, path, query or fragment"
            )
        return origin

    home_config = (Path.home() / ".config" / ".jira" / ".config.yml").resolve()
    if not home_config.exists():
        return ""
    return server_origin(read_jira_config(home_config)[0])


def resolve_jira_config_path(trusted_origin=None):
    """Select the jira-cli config that governs this checkout.

    The nearest checkout-owned config is decisive. When one exists it must match
    the operator's trust root, and a mismatch fails naming that file. Falling
    through to the home config instead would report a missing or unusable home
    config for a project config that was found and refused -- an error about the
    wrong file, pointing whoever has to fix it away from the one that is wrong.

    Args:
        trusted_origin: The operator's trust root, resolved when not supplied.
    """
    candidates = jira_config_candidates()
    home_config = candidates[-1]
    if trusted_origin is None:
        trusted_origin = resolve_trusted_origin()

    for candidate in candidates[:-1]:
        if not candidate.exists():
            continue
        if not trusted_origin:
            raise JiraConfigError(
                f"jira-cli config {candidate} cannot be trusted: neither "
                "JIRA_SERVER nor a home config establishes a trust root"
            )
        if server_origin(read_jira_config(candidate)[0]) != trusted_origin:
            raise JiraConfigError(
                f"jira-cli config {candidate} server does not match the "
                "trusted JIRA server origin"
            )
        return candidate
    return home_config


def get_jira_config():
    """Read JIRA server and login from the project-first jira-cli config.

    Every exit below happens before the token is read, so a configured URL that
    fails validation cannot reach a request. The returned server is the
    canonical origin, never the configured string, which is what keeps the value
    that was checked and the value that is sent identical.
    """
    try:
        trusted_origin = resolve_trusted_origin()
        config_path = resolve_jira_config_path(trusted_origin)
    except JiraConfigError as error:
        print(f"ERROR: {error}", file=sys.stderr)
        sys.exit(1)

    if not config_path.exists():
        print(f"ERROR: jira-cli config not found at {config_path}", file=sys.stderr)
        sys.exit(1)

    server, login = read_jira_config(config_path)
    origin = server_origin(server)
    if not origin:
        print(
            f"ERROR: JIRA server in {config_path} must be an HTTPS URL naming "
            "one origin, with no userinfo, path, query or fragment",
            file=sys.stderr,
        )
        sys.exit(1)
    if trusted_origin and origin != trusted_origin:
        print(
            f"ERROR: jira-cli config {config_path} server does not match the "
            "trusted JIRA server origin",
            file=sys.stderr,
        )
        sys.exit(1)

    token = os.environ.get("JIRA_API_TOKEN", "")
    if not token:
        print("ERROR: JIRA_API_TOKEN env var not set", file=sys.stderr)
        sys.exit(1)

    return origin, login, token


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
    cleaned = LOCAL_EVIDENCE_PATTERN.sub('', text).strip()

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
                match = LOCAL_EVIDENCE_PATTERN.search(text)
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
                match = LOCAL_EVIDENCE_PATTERN.search(text)
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
                    match = re.match(r'(\d+)\s*[xX×]\s*(\d+)', resolution)
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
