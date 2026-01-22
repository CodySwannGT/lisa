#!/usr/bin/env python3
# This file is managed by Lisa.
# Do not edit directly — changes will be overwritten on the next `lisa` run.
"""
Route Generator for Expo Router

Creates route files following best practices:
- Thin wrapper pattern (imports feature screen)
- Descriptive component names
- JSDoc with URL pattern
- Proper TypeScript types

Usage:
    generate-route.py <route-path> <feature-name> [--layout] [--dynamic]

Examples:
    generate-route.py players/compare compare-players
    generate-route.py players/[playerId] player-detail --dynamic
    generate-route.py (tabs)/feed feed --layout
"""

import sys
import os
from pathlib import Path


def to_pascal_case(name: str) -> str:
    """Convert hyphen-case to PascalCase."""
    return ''.join(word.capitalize() for word in name.replace('_', '-').split('-'))


def get_route_url(route_path: str) -> str:
    """Convert file path to URL pattern."""
    # Remove file extension if present
    route_path = route_path.replace('.tsx', '')

    # Handle route groups - they don't appear in URL
    parts = []
    for part in route_path.split('/'):
        if not part.startswith('(') or not part.endswith(')'):
            parts.append(part)

    url = '/' + '/'.join(parts)
    return url if url != '/' else '/'


def generate_route_content(route_path: str, feature_name: str, is_dynamic: bool = False) -> str:
    """Generate route file content."""
    pascal_feature = to_pascal_case(feature_name)

    # Determine screen name from route path
    path_parts = route_path.replace('.tsx', '').split('/')
    last_part = path_parts[-1] if path_parts else 'Index'

    # Handle dynamic routes
    if last_part.startswith('[') and last_part.endswith(']'):
        # [playerId] -> PlayerDetail
        param_name = last_part[1:-1]
        screen_name = to_pascal_case(param_name.replace('Id', '')) + 'DetailScreen'
    elif last_part == 'index':
        screen_name = pascal_feature + 'Screen'
    else:
        screen_name = to_pascal_case(last_part) + 'Screen'

    url_pattern = get_route_url(route_path)

    return f'''import {{ Main }} from "@/features/{feature_name}/screens/Main";

/**
 * {screen_name.replace('Screen', '')} route.
 * URL: {url_pattern}
 */
export default function {screen_name}() {{
  return <Main />;
}}
'''


def generate_layout_content(route_path: str) -> str:
    """Generate layout file content."""
    # Determine if this is tabs, stack, or drawer
    path_parts = route_path.split('/')

    # Check for (tabs) in path
    is_tabs = any(part == '(tabs)' for part in path_parts)

    if is_tabs:
        return '''import { Tabs } from "expo-router";

/**
 * Tab layout configuration.
 */
export default function TabLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }}>
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
        }}
      />
      {/* Add more tabs here */}
    </Tabs>
  );
}
'''
    else:
        return '''import { Stack } from "expo-router";

export const unstable_settings = {
  initialRouteName: "index",
};

/**
 * Stack layout configuration.
 */
export default function StackLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ headerShown: true }} />
    </Stack>
  );
}
'''


def main():
    if len(sys.argv) < 3:
        print("Usage: generate-route.py <route-path> <feature-name> [--layout] [--dynamic]")
        print("")
        print("Arguments:")
        print("  route-path    Path relative to app/ directory (e.g., players/[playerId])")
        print("  feature-name  Feature directory name (e.g., player-detail)")
        print("")
        print("Options:")
        print("  --layout      Generate a _layout.tsx file instead of a route")
        print("  --dynamic     Indicates this is a dynamic route with parameters")
        print("")
        print("Examples:")
        print("  generate-route.py players/compare compare-players")
        print("  generate-route.py players/[playerId] player-detail --dynamic")
        print("  generate-route.py \"(tabs)/feed\" feed --layout")
        sys.exit(1)

    route_path = sys.argv[1]
    feature_name = sys.argv[2]
    is_layout = '--layout' in sys.argv
    is_dynamic = '--dynamic' in sys.argv

    if is_layout:
        content = generate_layout_content(route_path)
        filename = '_layout.tsx'
    else:
        content = generate_route_content(route_path, feature_name, is_dynamic)
        # Determine filename from path
        path_parts = route_path.split('/')
        filename = path_parts[-1] if path_parts else 'index'
        if not filename.endswith('.tsx'):
            filename += '.tsx'

    print(f"Generated {filename}:")
    print("-" * 40)
    print(content)
    print("-" * 40)
    print("")
    print("To create this file, save the above content to:")
    print(f"  app/{route_path.rsplit('/', 1)[0] + '/' if '/' in route_path else ''}{filename}")


if __name__ == "__main__":
    main()
