#!/usr/bin/env python3
"""
Atomic Design Structure Validator

Validates that components are correctly placed in the atomic design hierarchy
and that import dependencies flow in the correct direction.

Usage:
    python validate_atomic_structure.py [path]

    If no path provided, validates the entire project from current directory.
"""

import os
import re
import sys
from pathlib import Path
from typing import NamedTuple

# Atomic levels in order of allowed dependencies (lower can't import higher)
ATOMIC_LEVELS = {
    "atoms": 0,
    "molecules": 1,
    "organisms": 2,
    "templates": 3,
    "screens": 4,  # Pages
    "app": 4,      # Expo Router pages
}

# Patterns to identify atomic level from file path
LEVEL_PATTERNS = [
    (r"/components/atoms/", "atoms"),
    (r"/components/molecules/", "molecules"),
    (r"/components/organisms/", "organisms"),
    (r"/components/templates/", "templates"),
    (r"/features/[^/]+/components/atoms/", "atoms"),
    (r"/features/[^/]+/components/molecules/", "molecules"),
    (r"/features/[^/]+/components/organisms/", "organisms"),
    (r"/features/[^/]+/screens/", "screens"),
    (r"/app/", "app"),
]

# Import patterns to detect
IMPORT_PATTERNS = [
    r'from\s+["\'](@/components/atoms/[^"\']+)["\']',
    r'from\s+["\'](@/components/molecules/[^"\']+)["\']',
    r'from\s+["\'](@/components/organisms/[^"\']+)["\']',
    r'from\s+["\'](@/components/templates/[^"\']+)["\']',
    r'from\s+["\'](@/features/[^/]+/components/atoms/[^"\']+)["\']',
    r'from\s+["\'](@/features/[^/]+/components/molecules/[^"\']+)["\']',
    r'from\s+["\'](@/features/[^/]+/components/organisms/[^"\']+)["\']',
    r'from\s+["\'](@/features/[^/]+/screens/[^"\']+)["\']',
]


class ValidationError(NamedTuple):
    """Represents a validation error."""
    file_path: str
    line_number: int
    error_type: str
    message: str


class ValidationResult(NamedTuple):
    """Represents the overall validation result."""
    errors: list
    warnings: list
    files_checked: int


def get_atomic_level(file_path: str) -> str | None:
    """Determine the atomic level of a file based on its path."""
    for pattern, level in LEVEL_PATTERNS:
        if re.search(pattern, file_path):
            return level
    return None


def get_import_level(import_path: str) -> str | None:
    """Determine the atomic level of an import path."""
    if "/atoms/" in import_path:
        return "atoms"
    if "/molecules/" in import_path:
        return "molecules"
    if "/organisms/" in import_path:
        return "organisms"
    if "/templates/" in import_path:
        return "templates"
    if "/screens/" in import_path:
        return "screens"
    return None


def check_import_direction(
    file_level: str,
    import_level: str,
    file_path: str,
    import_path: str,
    line_number: int,
) -> ValidationError | None:
    """Check if an import violates the atomic design dependency rules."""
    file_rank = ATOMIC_LEVELS.get(file_level, -1)
    import_rank = ATOMIC_LEVELS.get(import_level, -1)

    if import_rank > file_rank:
        return ValidationError(
            file_path=file_path,
            line_number=line_number,
            error_type="INVALID_IMPORT_DIRECTION",
            message=f"{file_level} cannot import from {import_level}: {import_path}",
        )
    return None


def check_file_has_state(content: str) -> bool:
    """Check if a file uses React state hooks."""
    state_patterns = [
        r"\buseState\b",
        r"\buseReducer\b",
        r"\buseRef\b",
    ]
    return any(re.search(pattern, content) for pattern in state_patterns)


def check_file_fetches_data(content: str) -> bool:
    """Check if a file fetches data."""
    fetch_patterns = [
        r"\buseQuery\b",
        r"\buseMutation\b",
        r"\buseLazyQuery\b",
        r"\buseSubscription\b",
        r"\bfetch\(",
        r"\baxios\.",
    ]
    return any(re.search(pattern, content) for pattern in fetch_patterns)


def validate_atom(file_path: str, content: str) -> list:
    """Validate that an atom follows atomic design rules."""
    errors = []

    # Atoms should not have state
    if check_file_has_state(content):
        # Check if it's just useRef (allowed in atoms for DOM refs)
        if re.search(r"\buseState\b|\buseReducer\b", content):
            errors.append(ValidationError(
                file_path=file_path,
                line_number=0,
                error_type="ATOM_HAS_STATE",
                message="Atoms should be stateless. Move state to a parent molecule.",
            ))

    # Atoms should not fetch data
    if check_file_fetches_data(content):
        errors.append(ValidationError(
            file_path=file_path,
            line_number=0,
            error_type="ATOM_FETCHES_DATA",
            message="Atoms should not fetch data. Move data fetching to a page.",
        ))

    return errors


def validate_molecule(file_path: str, content: str) -> list:
    """Validate that a molecule follows atomic design rules."""
    errors = []

    # Molecules should not fetch data
    if check_file_fetches_data(content):
        errors.append(ValidationError(
            file_path=file_path,
            line_number=0,
            error_type="MOLECULE_FETCHES_DATA",
            message="Molecules should not fetch data. Accept data as props.",
        ))

    return errors


def validate_organism(file_path: str, content: str) -> list:
    """Validate that an organism follows atomic design rules."""
    errors = []

    # Organisms should not fetch data (data comes from pages)
    if check_file_fetches_data(content):
        errors.append(ValidationError(
            file_path=file_path,
            line_number=0,
            error_type="ORGANISM_FETCHES_DATA",
            message="Organisms should receive data as props. Move fetching to page.",
        ))

    return errors


def validate_template(file_path: str, content: str) -> list:
    """Validate that a template follows atomic design rules."""
    errors = []

    # Templates should not fetch data
    if check_file_fetches_data(content):
        errors.append(ValidationError(
            file_path=file_path,
            line_number=0,
            error_type="TEMPLATE_FETCHES_DATA",
            message="Templates should only handle layout. Move data fetching to page.",
        ))

    return errors


def validate_file(file_path: str) -> list:
    """Validate a single file for atomic design compliance."""
    errors = []

    # Skip non-TypeScript/JavaScript files
    if not file_path.endswith((".tsx", ".ts", ".jsx", ".js")):
        return errors

    # Skip test files
    if ".test." in file_path or ".spec." in file_path or "__tests__" in file_path:
        return errors

    # Skip ui/ directory (Gluestack library)
    if "/components/ui/" in file_path:
        return errors

    try:
        with open(file_path, "r", encoding="utf-8") as f:
            content = f.read()
    except (IOError, UnicodeDecodeError):
        return errors

    file_level = get_atomic_level(file_path)
    if not file_level:
        return errors

    # Check import directions
    for line_number, line in enumerate(content.split("\n"), 1):
        for pattern in IMPORT_PATTERNS:
            matches = re.findall(pattern, line)
            for import_path in matches:
                import_level = get_import_level(import_path)
                if import_level:
                    error = check_import_direction(
                        file_level, import_level, file_path, import_path, line_number
                    )
                    if error:
                        errors.append(error)

    # Level-specific validations
    validators = {
        "atoms": validate_atom,
        "molecules": validate_molecule,
        "organisms": validate_organism,
        "templates": validate_template,
    }

    validator = validators.get(file_level)
    if validator:
        errors.extend(validator(file_path, content))

    return errors


def validate_directory(root_path: str) -> ValidationResult:
    """Validate all files in a directory tree."""
    all_errors = []
    all_warnings = []
    files_checked = 0

    for dirpath, _, filenames in os.walk(root_path):
        # Skip node_modules and other non-source directories
        if any(skip in dirpath for skip in ["node_modules", ".git", "dist", "build", ".expo"]):
            continue

        for filename in filenames:
            file_path = os.path.join(dirpath, filename)
            errors = validate_file(file_path)
            all_errors.extend(errors)
            files_checked += 1

    return ValidationResult(
        errors=all_errors,
        warnings=all_warnings,
        files_checked=files_checked,
    )


def format_error(error: ValidationError) -> str:
    """Format a validation error for display."""
    return f"{error.file_path}:{error.line_number}: [{error.error_type}] {error.message}"


def main():
    """Main entry point."""
    path = sys.argv[1] if len(sys.argv) > 1 else "."

    if not os.path.exists(path):
        print(f"Error: Path '{path}' does not exist")
        sys.exit(1)

    print(f"Validating atomic design structure in: {path}")
    print("-" * 60)

    if os.path.isfile(path):
        errors = validate_file(path)
        files_checked = 1
    else:
        result = validate_directory(path)
        errors = result.errors
        files_checked = result.files_checked

    if errors:
        print(f"\nFound {len(errors)} error(s):\n")
        for error in errors:
            print(f"  {format_error(error)}")
        print()
        sys.exit(1)
    else:
        print(f"\n✓ All {files_checked} files pass atomic design validation")
        sys.exit(0)


if __name__ == "__main__":
    main()
