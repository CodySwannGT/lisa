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
- View is an arrow function with an expression body (declaration form is a
  violation, not an alternative spelling)
- View calls no hooks — matched by SHAPE (`use` + uppercase), never by a list of
  names, because the call that motivated this check was a project-local custom
  hook that no list would have contained

This is a fast pre-check, not the gate. ESLint reads the AST of every file;
this reads one directory with regexes. When they disagree, ESLint is right.

Usage:
    python3 validate_component.py <path-to-component-directory>

The script ships inside the Lisa plugin, not in a consumer's `.claude/skills/`,
so invoke it through the plugin root:

    python3 "${CLAUDE_PLUGIN_ROOT:-node_modules/@codyswann/lisa/plugins/lisa-expo}/skills/container-view-pattern/scripts/validate_component.py" <path>

Example:
    python3 validate_component.py features/player-kanban/components/AddColumnButton
"""

import os
import re
import sys
from pathlib import Path


HOOK_CALL = re.compile(r"\b(use[A-Z]\w*)\s*\(")
"""Every hook call, by SHAPE.

`use` followed by an uppercase letter is React's own definition of a hook name,
so this matches `useState`, `useMemo`, and every project-local custom hook
alike. It is a shape and never a list: a list is what let
`useCreateNoteQuickActionEnabled()` through.

It also matches hook calls inside comments and strings. That is the accepted
cost of a regex pre-check; ESLint's `component-structure/no-hooks-in-view` reads
the AST and is the gate.
"""


def _arrow_body_is_block(source: str, start: int) -> bool:
    """
    Whether the arrow beginning at `start` has a block body.

    Walks to the first top-level `=>` instead of matching a parameter list with
    `\\([^)]*\\)`, which fails on any nested paren — a destructured parameter with
    a default, a type annotation carrying a function type, or a parenthesised
    union.

    Args:
        source: The View file's text.
        start: Index just past the `const <Name>View` binding.

    Returns:
        True when the arrow's body opens with `{`.
    """
    depth = 0
    index = start
    while index < len(source) - 1:
        char = source[index]
        if char in "([{":
            depth += 1
        elif char in ")]}":
            depth -= 1
        elif char == ";" and depth == 0:
            return False
        elif depth == 0 and source[index : index + 2] == "=>":
            rest = source[index + 2 :].lstrip()
            return rest.startswith("{")
        index += 1
    return False


def view_form_errors(component_name: str, view_content: str) -> list[str]:
    """
    Errors about the FORM of the View component.

    The requirement is an arrow function with an expression body. A function
    declaration cannot have one, so declaration form is banned by construction
    rather than by scanning for the word "function" — which would fire on JSDoc
    prose, on local render helpers, and on disable-comment justifications, none
    of which are the View component.

    Args:
        component_name: The component directory's name, without the View suffix.
        view_content: The View file's text.

    Returns:
        Zero or one error message.
    """
    name = f"{component_name}View"
    expected = f"const {name} = (props) => (...)"

    if re.search(rf"\bfunction\s+{re.escape(name)}\b", view_content):
        return [
            f"View must be an arrow function with an expression body: {expected}. "
            "A function declaration cannot have one, so it always carries a statement list."
        ]

    function_expression = re.search(
        rf"\bconst\s+{re.escape(name)}\b[^=]*=\s*function\b", view_content
    )
    if function_expression:
        return [
            f"View must be an arrow function with an expression body: {expected}. "
            "A function expression cannot have one."
        ]

    binding = re.search(rf"\bconst\s+{re.escape(name)}\b", view_content)
    if binding and _arrow_body_is_block(view_content, binding.end()):
        return [
            "View should use arrow function shorthand: () => (...) instead of () => { return (...) }"
        ]

    return []


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

        # Check the View component's form.
        #
        # The old check was `const {name}View = ([^)]*) => {` — arrow-only, and
        # therefore blind to `function {name}View(...) {`, independently
        # reproducing the exact defect the ESLint rule carried. It also broke on
        # any parameter list containing a nested paren.
        errors.extend(view_form_errors(component_name, view_content))

        # Check for hooks in View (they should be in Container).
        #
        # One generic shape match, deliberately. The previous version listed
        # `\buse[A-Z]\w+\s*\(` first and then narrowed to four hardcoded names
        # and `break`ed, so the general pattern was UNREACHABLE — dead code that
        # read as coverage. A project-local hook such as
        # `useCreateNoteQuickActionEnabled()` matched the pattern that was never
        # evaluated and none of the four that were.
        for hook in sorted(set(HOOK_CALL.findall(view_content))):
            errors.append(f"View should not contain {hook} - move to Container")

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
