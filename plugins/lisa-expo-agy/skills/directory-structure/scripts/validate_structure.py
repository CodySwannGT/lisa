#!/usr/bin/env python3
# This file is managed by Lisa.
# Do not edit directly — changes will be overwritten on the next `lisa` run.
"""
Directory Structure Validation Script

Validates that files and directories follow the project's documented structure:
- Feature module structure (components/, screens/, hooks/, etc.)
- Container/View pattern compliance
- Test file placement in __tests__/ directories
- Route file thin wrapper pattern
- Proper naming conventions

Usage:
    python3 validate_structure.py [path]

    If no path provided, validates from current directory.
"""

import os
import re
import sys
from pathlib import Path
from typing import List, Tuple, NamedTuple
from dataclasses import dataclass, field


@dataclass
class ValidationResult:
    """Result of a validation check."""
    passed: bool
    message: str
    file_path: str = ""
    suggestion: str = ""


@dataclass
class ValidationReport:
    """Complete validation report."""
    errors: List[ValidationResult] = field(default_factory=list)
    warnings: List[ValidationResult] = field(default_factory=list)
    passed: List[ValidationResult] = field(default_factory=list)

    @property
    def has_errors(self) -> bool:
        return len(self.errors) > 0

    @property
    def has_warnings(self) -> bool:
        return len(self.warnings) > 0


# Directories that should contain __tests__/ subdirectories for test files
TESTABLE_DIRS = {'hooks', 'utils', 'stores', 'providers'}

# Valid feature subdirectories
FEATURE_SUBDIRS = {'components', 'screens', 'hooks', 'stores', 'utils', 'types', 'constants', 'config'}

# Files that can exist at feature root level
FEATURE_ROOT_FILES = {'types.ts', 'constants.ts', 'operations.graphql', 'index.ts', 'index.tsx'}

# Pattern for Container/View files
CONTAINER_PATTERN = re.compile(r'^([A-Z][a-zA-Z0-9]*)Container\.tsx$')
VIEW_PATTERN = re.compile(r'^([A-Z][a-zA-Z0-9]*)View\.tsx$')

# Directories to skip during validation
SKIP_DIRS = {
    'node_modules', '.git', 'dist', 'build', '.expo',
    '.next', 'coverage', '__pycache__', '.claude'
}


def find_project_root(start_path: Path) -> Path:
    """Find the project root by looking for package.json."""
    current = start_path.resolve()
    while current != current.parent:
        if (current / 'package.json').exists():
            return current
        current = current.parent
    return start_path.resolve()


def validate_test_file_placement(root: Path) -> List[ValidationResult]:
    """Check that test files are in __tests__/ subdirectories."""
    results = []
    test_pattern = re.compile(r'\.(test|spec)\.(ts|tsx|js|jsx)$')

    for dirpath, dirnames, filenames in os.walk(root):
        # Skip excluded directories
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]

        path = Path(dirpath)

        # Skip if we're inside __tests__ directory
        if '__tests__' in path.parts:
            continue

        # Skip e2e directory (has different structure)
        if 'e2e' in path.parts:
            continue

        for filename in filenames:
            if test_pattern.search(filename):
                file_path = path / filename
                rel_path = file_path.relative_to(root)

                # Check if parent directory should have __tests__
                parent_name = path.name

                results.append(ValidationResult(
                    passed=False,
                    message=f"Test file not in __tests__/ directory",
                    file_path=str(rel_path),
                    suggestion=f"Move to {path}/__tests__/{filename}"
                ))

    return results


def validate_component_structure(component_dir: Path, root: Path) -> List[ValidationResult]:
    """Validate Container/View pattern in a component directory."""
    results = []
    rel_path = component_dir.relative_to(root)

    if not component_dir.is_dir():
        return results

    files = list(component_dir.iterdir())
    file_names = [f.name for f in files if f.is_file()]

    component_name = component_dir.name

    expected_container = f"{component_name}Container.tsx"
    expected_view = f"{component_name}View.tsx"
    expected_index = "index.tsx"

    has_container = expected_container in file_names
    has_view = expected_view in file_names
    has_index = expected_index in file_names or "index.ts" in file_names

    # Check for Container
    if not has_container:
        # Check for any Container file
        containers = [f for f in file_names if CONTAINER_PATTERN.match(f)]
        if containers:
            results.append(ValidationResult(
                passed=False,
                message=f"Container file name mismatch",
                file_path=str(rel_path),
                suggestion=f"Rename {containers[0]} to {expected_container}"
            ))
        else:
            results.append(ValidationResult(
                passed=False,
                message=f"Missing Container file",
                file_path=str(rel_path),
                suggestion=f"Create {expected_container}"
            ))

    # Check for View
    if not has_view:
        views = [f for f in file_names if VIEW_PATTERN.match(f)]
        if views:
            results.append(ValidationResult(
                passed=False,
                message=f"View file name mismatch",
                file_path=str(rel_path),
                suggestion=f"Rename {views[0]} to {expected_view}"
            ))
        else:
            results.append(ValidationResult(
                passed=False,
                message=f"Missing View file",
                file_path=str(rel_path),
                suggestion=f"Create {expected_view}"
            ))

    # Check for index
    if not has_index:
        results.append(ValidationResult(
            passed=False,
            message=f"Missing index.tsx",
            file_path=str(rel_path),
            suggestion=f"Create index.tsx that exports Container"
        ))

    return results


def validate_feature_structure(feature_dir: Path, root: Path) -> List[ValidationResult]:
    """Validate feature module structure."""
    results = []
    rel_path = feature_dir.relative_to(root)

    if not feature_dir.is_dir():
        return results

    # Check components directory
    components_dir = feature_dir / 'components'
    if components_dir.exists():
        for item in components_dir.iterdir():
            if item.is_dir() and not item.name.startswith('_'):
                results.extend(validate_component_structure(item, root))

    # Check screens directory
    screens_dir = feature_dir / 'screens'
    if screens_dir.exists():
        for item in screens_dir.iterdir():
            if item.is_dir() and not item.name.startswith('_'):
                results.extend(validate_component_structure(item, root))

    # Check hooks have __tests__ if there are test files
    hooks_dir = feature_dir / 'hooks'
    if hooks_dir.exists():
        tests_dir = hooks_dir / '__tests__'
        hook_files = [f for f in hooks_dir.iterdir() if f.is_file() and f.suffix in {'.ts', '.tsx'}]
        if hook_files and not tests_dir.exists():
            results.append(ValidationResult(
                passed=False,
                message=f"Missing __tests__/ directory for hooks",
                file_path=str(rel_path / 'hooks'),
                suggestion=f"Create {rel_path}/hooks/__tests__/ for test files"
            ))

    # Check utils have __tests__ if there are test files
    utils_dir = feature_dir / 'utils'
    if utils_dir.exists():
        tests_dir = utils_dir / '__tests__'
        util_files = [f for f in utils_dir.iterdir() if f.is_file() and f.suffix in {'.ts', '.tsx'}]
        if util_files and not tests_dir.exists():
            results.append(ValidationResult(
                passed=False,
                message=f"Missing __tests__/ directory for utils",
                file_path=str(rel_path / 'utils'),
                suggestion=f"Create {rel_path}/utils/__tests__/ for test files"
            ))

    return results


def validate_app_directory(app_dir: Path, root: Path) -> List[ValidationResult]:
    """Validate that app/ directory only contains thin route wrappers."""
    results = []

    if not app_dir.exists():
        return results

    # Patterns that indicate non-wrapper code
    business_logic_patterns = [
        (re.compile(r'useState\s*\('), "useState hook usage"),
        (re.compile(r'useEffect\s*\('), "useEffect hook usage"),
        (re.compile(r'useCallback\s*\('), "useCallback hook usage"),
        (re.compile(r'useMemo\s*\('), "useMemo hook usage"),
        (re.compile(r'useQuery\s*\('), "useQuery hook usage"),
        (re.compile(r'useMutation\s*\('), "useMutation hook usage"),
    ]

    # Files that are allowed (layout files, etc.)
    allowed_patterns = {'_layout.tsx', '_layout.ts', '+not-found.tsx', '+html.tsx'}

    for dirpath, dirnames, filenames in os.walk(app_dir):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        path = Path(dirpath)

        for filename in filenames:
            if not filename.endswith(('.tsx', '.ts')):
                continue

            if filename in allowed_patterns:
                continue

            if filename.startswith('_') or filename.startswith('+'):
                continue

            file_path = path / filename
            rel_path = file_path.relative_to(root)

            try:
                content = file_path.read_text()

                for pattern, description in business_logic_patterns:
                    if pattern.search(content):
                        results.append(ValidationResult(
                            passed=False,
                            message=f"Route file contains business logic: {description}",
                            file_path=str(rel_path),
                            suggestion="Move business logic to features/ directory"
                        ))
                        break  # Only report first violation per file

            except Exception as e:
                pass  # Skip files we can't read

    return results


def validate_naming_conventions(root: Path) -> List[ValidationResult]:
    """Validate file and directory naming conventions."""
    results = []

    # Feature directory names should be kebab-case
    features_dir = root / 'features'
    if features_dir.exists():
        kebab_pattern = re.compile(r'^[a-z][a-z0-9]*(-[a-z0-9]+)*$')
        for item in features_dir.iterdir():
            if item.is_dir() and not item.name.startswith('.'):
                if not kebab_pattern.match(item.name):
                    results.append(ValidationResult(
                        passed=False,
                        message=f"Feature directory not in kebab-case",
                        file_path=f"features/{item.name}",
                        suggestion=f"Rename to kebab-case (e.g., 'my-feature')"
                    ))

    # Component directories should be PascalCase
    pascal_pattern = re.compile(r'^[A-Z][a-zA-Z0-9]*$')

    def check_component_dirs(base_dir: Path, dir_type: str):
        if not base_dir.exists():
            return
        for item in base_dir.iterdir():
            if item.is_dir() and not item.name.startswith('_'):
                if not pascal_pattern.match(item.name):
                    rel_path = item.relative_to(root)
                    results.append(ValidationResult(
                        passed=False,
                        message=f"{dir_type} directory not in PascalCase",
                        file_path=str(rel_path),
                        suggestion=f"Rename to PascalCase (e.g., 'MyComponent')"
                    ))

    # Check components directory (skip special subdirectories)
    components_dir = root / 'components'
    if components_dir.exists():
        for item in components_dir.iterdir():
            # Skip special directories that are allowed to be lowercase
            if item.name in {'ui', 'icons', 'custom', 'shared'}:
                continue
            if item.is_dir() and not item.name.startswith('_'):
                if not pascal_pattern.match(item.name):
                    rel_path = item.relative_to(root)
                    results.append(ValidationResult(
                        passed=False,
                        message=f"Component directory not in PascalCase",
                        file_path=str(rel_path),
                        suggestion=f"Rename to PascalCase (e.g., 'MyComponent')"
                    ))

    # Check feature components and screens
    if features_dir.exists():
        for feature in features_dir.iterdir():
            if feature.is_dir():
                check_component_dirs(feature / 'components', 'Component')
                check_component_dirs(feature / 'screens', 'Screen')

    return results


def run_validation(path: Path) -> ValidationReport:
    """Run all validations and return a report."""
    report = ValidationReport()
    root = find_project_root(path)

    print(f"Validating directory structure from: {root}\n")

    # Run all validations
    report.errors.extend(validate_test_file_placement(root))
    report.errors.extend(validate_naming_conventions(root))
    report.errors.extend(validate_app_directory(root / 'app', root))

    # Validate features
    features_dir = root / 'features'
    if features_dir.exists():
        for feature in features_dir.iterdir():
            if feature.is_dir() and not feature.name.startswith('.'):
                report.errors.extend(validate_feature_structure(feature, root))

    # Validate global components
    components_dir = root / 'components'
    if components_dir.exists():
        for item in components_dir.iterdir():
            # Skip ui/, icons/, custom/ as they have different structure
            if item.name in {'ui', 'icons', 'custom', 'shared'}:
                continue
            if item.is_dir() and not item.name.startswith('_'):
                report.errors.extend(validate_component_structure(item, root))

    return report


def print_report(report: ValidationReport) -> None:
    """Print the validation report."""
    if report.errors:
        print("=" * 60)
        print(f"ERRORS ({len(report.errors)})")
        print("=" * 60)
        for result in report.errors:
            print(f"\n❌ {result.message}")
            if result.file_path:
                print(f"   File: {result.file_path}")
            if result.suggestion:
                print(f"   Fix: {result.suggestion}")

    if report.warnings:
        print("\n" + "=" * 60)
        print(f"WARNINGS ({len(report.warnings)})")
        print("=" * 60)
        for result in report.warnings:
            print(f"\n⚠️  {result.message}")
            if result.file_path:
                print(f"   File: {result.file_path}")
            if result.suggestion:
                print(f"   Fix: {result.suggestion}")

    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"Errors:   {len(report.errors)}")
    print(f"Warnings: {len(report.warnings)}")

    if not report.has_errors and not report.has_warnings:
        print("\n✅ All directory structure validations passed!")
    elif report.has_errors:
        print("\n❌ Validation failed with errors")
    else:
        print("\n⚠️  Validation passed with warnings")


def main():
    """Main entry point."""
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.cwd()

    if not path.exists():
        print(f"Error: Path does not exist: {path}")
        sys.exit(1)

    report = run_validation(path)
    print_report(report)

    # Exit with error code if there are errors
    sys.exit(1 if report.has_errors else 0)


if __name__ == '__main__':
    main()
