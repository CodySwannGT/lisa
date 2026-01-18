#!/usr/bin/env python3
"""
Create a new component following the Container/View pattern.

Usage:
    python3 create_component.py <type> <name> [feature]

Types:
    global-component  - Creates in components/<name>/
    feature-component - Creates in features/<feature>/components/<name>/
    global-screen     - Creates in screens/<name>/
    feature-screen    - Creates in features/<feature>/screens/<name>/

Examples:
    python3 create_component.py global-component PlayerCard
    python3 create_component.py feature-component PlayerCard player-kanban
    python3 create_component.py global-screen Settings
    python3 create_component.py feature-screen Main dashboard
"""

import os
import sys
from pathlib import Path


CONTAINER_TEMPLATE = '''import {{ useCallback, useMemo, useState }} from "react";

import {name}View from "./{name}View";

/**
 * Props for the {name} component.
 */
interface {name}Props {{
  // Define props here
}}

/**
 * Container component that manages state and logic for {name}.
 * @param props - Component properties
 */
const {name}Container = (props: {name}Props) => {{
  // 1. Variables, state, useMemo, useCallback
  const [isLoading, setIsLoading] = useState(false);

  const computedValue = useMemo(() => {{
    return null;
  }}, []);

  const handleAction = useCallback(() => {{
    // Handle action
  }}, []);

  // 2. useEffect hooks
  // useEffect(() => {{}}, []);

  // 3. Return View
  return (
    <{name}View
      isLoading={{isLoading}}
      onAction={{handleAction}}
    />
  );
}};

export default {name}Container;
'''

VIEW_TEMPLATE = '''import {{ memo }} from "react";

import {{ Box }} from "@/components/ui/box";
import {{ Text }} from "@/components/ui/text";

/**
 * Props for the {name}View component.
 */
interface {name}ViewProps {{
  readonly isLoading: boolean;
  readonly onAction: () => void;
}}

/**
 * View component that renders the {name} UI.
 * @param props - Component properties
 * @param props.isLoading - Loading state indicator
 * @param props.onAction - Action handler callback
 */
const {name}View = ({{
  isLoading,
  onAction,
}}: {name}ViewProps) => (
  <Box testID="{test_id}.CONTAINER">
    {{isLoading ? (
      <Text>Loading...</Text>
    ) : (
      <Text>{name} Component</Text>
    )}}
  </Box>
);

{name}View.displayName = "{name}View";

export default memo({name}View);
'''

INDEX_TEMPLATE = '''export {{ default }} from "./{name}Container";
'''


def create_component(component_type: str, name: str, feature: str = None) -> bool:
    """
    Create a new component with Container/View pattern.

    Args:
        component_type: Type of component (global-component, feature-component, etc.)
        name: Component name in PascalCase
        feature: Feature name (required for feature-component and feature-screen)

    Returns:
        True if successful, False otherwise
    """
    # Validate component name is PascalCase
    if not name[0].isupper():
        print(f"Error: Component name '{name}' must be PascalCase (start with uppercase)")
        return False

    # Determine target directory
    if component_type == "global-component":
        target_dir = Path("components") / name
        test_id = name.upper()
    elif component_type == "feature-component":
        if not feature:
            print("Error: feature-component requires a feature name")
            return False
        feature_dir = Path("features") / feature
        if not feature_dir.exists():
            print(f"Error: Feature '{feature}' does not exist at {feature_dir}")
            return False
        target_dir = feature_dir / "components" / name
        test_id = f"{feature.upper().replace('-', '_')}.{name.upper()}"
    elif component_type == "global-screen":
        target_dir = Path("screens") / name
        test_id = f"SCREEN.{name.upper()}"
    elif component_type == "feature-screen":
        if not feature:
            print("Error: feature-screen requires a feature name")
            return False
        feature_dir = Path("features") / feature
        if not feature_dir.exists():
            print(f"Error: Feature '{feature}' does not exist at {feature_dir}")
            return False
        target_dir = feature_dir / "screens" / name
        test_id = f"{feature.upper().replace('-', '_')}.SCREEN.{name.upper()}"
    else:
        print(f"Error: Unknown component type '{component_type}'")
        print("Valid types: global-component, feature-component, global-screen, feature-screen")
        return False

    # Check if component already exists
    if target_dir.exists():
        print(f"Error: Component already exists at {target_dir}")
        return False

    # Create directory
    target_dir.mkdir(parents=True, exist_ok=True)

    # Create files
    container_content = CONTAINER_TEMPLATE.format(name=name)
    view_content = VIEW_TEMPLATE.format(name=name, test_id=test_id)
    index_content = INDEX_TEMPLATE.format(name=name)

    (target_dir / f"{name}Container.tsx").write_text(container_content)
    (target_dir / f"{name}View.tsx").write_text(view_content)
    (target_dir / "index.tsx").write_text(index_content)

    print(f"Created component at {target_dir}/")
    print(f"  - {name}Container.tsx")
    print(f"  - {name}View.tsx")
    print(f"  - index.tsx")

    return True


def main():
    """Main entry point."""
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)

    component_type = sys.argv[1]
    name = sys.argv[2]
    feature = sys.argv[3] if len(sys.argv) > 3 else None

    success = create_component(component_type, name, feature)
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
