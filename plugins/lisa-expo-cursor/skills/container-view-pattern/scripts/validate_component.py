#!/usr/bin/env python3
# This file is managed by Lisa.
# Do not edit directly — changes will be overwritten on the next `lisa` run.
"""
Validation script for Container/View pattern components.

This script validates that a component directory follows the Container/View pattern:
- Has ComponentNameContainer.tsx
- Has ComponentNameView.tsx
- Has index.tsx with correct export
- View uses memo() wrapper
- View has displayName
- View uses arrow function shorthand

Usage:
    python3 validate_component.py <path-to-component-directory>

Example:
    python3 validate_component.py features/player-kanban/components/AddColumnButton
"""

import os
import re
import sys
from pathlib import Path


def validate_component(component_path: str) -> tuple[bool, list[str]]:
    """
    Validate a component directory follows Container/View pattern.

    Args:
        component_path: Path to the component directory

    Returns:
        Tuple of (is_valid, list of error messages)
    """
    errors = []
    component_dir = Path(component_path)

    if not component_dir.is_dir():
        return False, [f"Path is not a directory: {component_path}"]

    component_name = component_dir.name

    # Check required files exist
    container_file = component_dir / f"{component_name}Container.tsx"
    view_file = component_dir / f"{component_name}View.tsx"
    index_file = component_dir / "index.tsx"

    if not container_file.exists():
        # Check for .jsx variant
        container_jsx = component_dir / f"{component_name}Container.jsx"
        if not container_jsx.exists():
            errors.append(f"Missing Container file: {component_name}Container.tsx")
        else:
            container_file = container_jsx

    if not view_file.exists():
        # Check for .jsx variant
        view_jsx = component_dir / f"{component_name}View.jsx"
        if not view_jsx.exists():
            errors.append(f"Missing View file: {component_name}View.tsx")
        else:
            view_file = view_jsx

    if not index_file.exists():
        index_jsx = component_dir / "index.jsx"
        if not index_jsx.exists():
            errors.append("Missing index.tsx file")
        else:
            index_file = index_jsx

    # Validate index.tsx exports Container
    if index_file.exists():
        index_content = index_file.read_text()
        export_pattern = rf"export\s*{{\s*default\s*}}\s*from\s*['\"]\./{component_name}Container['\"]"
        if not re.search(export_pattern, index_content):
            errors.append(f"index.tsx should export {component_name}Container as default")

    # Validate View file
    if view_file.exists():
        view_content = view_file.read_text()

        # Check for memo wrapper
        memo_pattern = r"export\s+default\s+memo\s*\("
        if not re.search(memo_pattern, view_content):
            errors.append("View component should be wrapped with memo()")

        # Check for displayName
        display_name_pattern = rf"{component_name}View\.displayName\s*="
        if not re.search(display_name_pattern, view_content):
            errors.append(f"View should have displayName: {component_name}View.displayName = \"{component_name}View\"")

        # Check for block body (return statement) in main component
        # This is a simplified check - ESLint does the full validation
        block_body_pattern = rf"const\s+{component_name}View\s*=\s*\([^)]*\)\s*=>\s*{{"
        if re.search(block_body_pattern, view_content):
            errors.append("View should use arrow function shorthand: () => (...) instead of () => { return (...) }")

        # Check for hooks in View (they should be in Container)
        hook_patterns = [
            r"\buse[A-Z]\w+\s*\(",  # General hook pattern
            r"\buseState\s*\(",
            r"\buseEffect\s*\(",
            r"\buseMemo\s*\(",
            r"\buseCallback\s*\(",
            r"\buseReducer\s*\(",
            r"\buseContext\s*\(",
        ]

        for hook_pattern in hook_patterns:
            # Exclude memo import check
            if hook_pattern == r"\buse[A-Z]\w+\s*\(":
                # More specific check to avoid false positives
                if re.search(r"\buseState\s*\(", view_content):
                    errors.append("View should not contain useState - move to Container")
                    break
                if re.search(r"\buseEffect\s*\(", view_content):
                    errors.append("View should not contain useEffect - move to Container")
                    break
                if re.search(r"\buseMemo\s*\(", view_content):
                    errors.append("View should not contain useMemo - move to Container")
                    break
                if re.search(r"\buseCallback\s*\(", view_content):
                    errors.append("View should not contain useCallback - move to Container")
                    break

    # Validate Container file
    if container_file.exists():
        container_content = container_file.read_text()

        # Check that Container imports View
        import_view_pattern = rf"import\s+{component_name}View\s+from\s*['\"]\./{component_name}View['\"]"
        if not re.search(import_view_pattern, container_content):
            errors.append(f"Container should import {component_name}View")

        # Check that Container returns View
        return_view_pattern = rf"<{component_name}View"
        if not re.search(return_view_pattern, container_content):
            errors.append(f"Container should return <{component_name}View />")

        # Check that Container ONLY renders View (no other JSX elements)
        # Find all JSX tags in Container (excluding the View)
        all_jsx_pattern = r"<([A-Z][a-zA-Z0-9]*)"
        jsx_matches = re.findall(all_jsx_pattern, container_content)
        other_components = [m for m in jsx_matches if m != f"{component_name}View"]
        if other_components:
            errors.append(
                f"Container should ONLY render {component_name}View, but found: {', '.join(set(other_components))}"
            )

    # Check for extra files
    allowed_files = {
        f"{component_name}Container.tsx",
        f"{component_name}Container.jsx",
        f"{component_name}View.tsx",
        f"{component_name}View.jsx",
        "index.tsx",
        "index.jsx",
        "index.ts",
        "__tests__",  # Allow test directory
    }

    # Also allow platform-specific variants
    allowed_patterns = [
        rf"^{component_name}Container\.[^.]+\.(tsx|jsx)$",
        rf"^{component_name}View\.[^.]+\.(tsx|jsx)$",
    ]

    for item in component_dir.iterdir():
        if item.name not in allowed_files:
            is_allowed = False
            for pattern in allowed_patterns:
                if re.match(pattern, item.name):
                    is_allowed = True
                    break
            if not is_allowed and item.is_file():
                errors.append(f"Unexpected file in component directory: {item.name}")

    return len(errors) == 0, errors


def main():
    """Main entry point for the validation script."""
    if len(sys.argv) < 2:
        print("Usage: python3 validate_component.py <path-to-component-directory>")
        print("Example: python3 validate_component.py features/player-kanban/components/AddColumnButton")
        sys.exit(1)

    component_path = sys.argv[1]

    print(f"Validating component: {component_path}")
    print("-" * 50)

    is_valid, errors = validate_component(component_path)

    if is_valid:
        print("Component follows Container/View pattern")
        sys.exit(0)
    else:
        print("Validation errors found:")
        for error in errors:
            print(f"  - {error}")
        sys.exit(1)


if __name__ == "__main__":
    main()
