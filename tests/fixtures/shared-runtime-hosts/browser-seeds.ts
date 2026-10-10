/** Genuine Phaser/Vite and Expo/RN sources, independent of managed templates. */
import { write } from "./host.js";

const MOVEMENT_SOURCE = `export function advance(position: number, velocity: number, seconds: number): number {
  if (seconds < 0) throw new RangeError("Elapsed time must not be negative");
  return position + velocity * seconds;
}
`;

const PHASER_SOURCE = `import Phaser from "phaser";
import { advance } from "./movement";

let marker: Phaser.GameObjects.Text | undefined;
const scene = {
  create(this: Phaser.Scene): void {
    marker = this.add.text(20, 20, "Node24 packed Phaser application");
  },
  update(_time: number, delta: number): void {
    if (marker) marker.x = advance(marker.x, 2, delta / 1000);
  }
};

new Phaser.Game({ type: Phaser.AUTO, width: 320, height: 240, parent: "game", scene });
`;

const PHASER_TEST = `import { expect, it } from "vitest";
import { advance } from "../src/movement";

it("executes the logic used by the bundled Phaser scene", () => {
  expect(process.versions.node).toBe("24.21.0");
  expect(process.versions.modules).toBe("137");
  expect(advance(20, 2, 0.5)).toBe(21);
  expect(advance(21, 2, 1)).toBe(23);
  expect(() => advance(0, 1, -1)).toThrow(RangeError);
});
`;

const EXPO_COMPONENT = `import React from "react";
import { StyleSheet, Text, View } from "react-native";

export default function App(): React.JSX.Element {
  return <View style={styles.page}><Text accessibilityRole="header">Packed Expo Node24 application</Text></View>;
}

const styles = StyleSheet.create({ page: { flex: 1, padding: 24 } });
`;

const EXPO_TEST = `import React from "react";
import { render, screen } from "@testing-library/react-native";
import "@testing-library/react-native/build/matchers/extend-expect";
import App from "../App";

it("renders the genuine React Native component using the SDK Jest setup", () => {
  expect(process.versions.node).toBe("24.21.0");
  expect(process.versions.modules).toBe("137");
  render(<App />);
  expect(screen.getByRole("header")).toHaveTextContent("Packed Expo Node24 application");
});
`;

/**
 * Seed an actual Phaser game and native logic suite using the browser TS preset.
 * @param root - Owned disposable host directory
 */
export function seedPhaserHost(root: string): void {
  write(root, "package.json", {
    name: "packed-runtime-phaser",
    version: "1.0.0",
    private: true,
    type: "module",
    dependencies: { phaser: "^4.2.0" },
  });
  write(root, "tsconfig.json", {
    extends: ["@codyswann/lisa/tsconfig/phaser", "./tsconfig.local.json"],
    compilerOptions: { ignoreDeprecations: "6.0" },
  });
  write(root, "tsconfig.local.json", {
    include: ["src/**/*.ts", "tests/**/*.ts"],
    exclude: ["node_modules", "dist", "coverage"],
    files: [],
  });
  write(
    root,
    "index.html",
    `<!doctype html>
<html><head><meta charset="utf-8"><title>Packed Phaser runtime</title></head>
<body><div id="game"></div><script type="module" src="/src/main.ts"></script></body></html>
`
  );
  write(root, "src/movement.ts", MOVEMENT_SOURCE);
  write(root, "src/main.ts", PHASER_SOURCE);
  write(root, "tests/movement.test.ts", PHASER_TEST);
}

/**
 * Seed real Expo/RN entry, component and tests; Metro export supplies build proof.
 * @param root - Owned disposable host directory
 */
export function seedExpoHost(root: string): void {
  write(root, "package.json", {
    name: "packed-runtime-expo",
    version: "1.0.0",
    private: true,
    main: "index.ts",
    // Source Babel/pre-setup files use require/module.exports.
    type: "commonjs",
  });
  write(root, "app.json", {
    expo: {
      name: "Packed runtime application",
      slug: "packed-runtime-expo",
      version: "1.0.0",
      web: { bundler: "metro" },
    },
  });
  write(root, "tsconfig.json", {
    extends: ["@codyswann/lisa/tsconfig/expo", "./tsconfig.local.json"],
    compilerOptions: { ignoreDeprecations: "6.0" },
  });
  write(root, "tsconfig.local.json", {
    compilerOptions: { types: ["node", "jest"] },
    include: ["App.tsx", "index.ts", "tests/**/*.tsx"],
    exclude: ["node_modules", "dist", ".expo"],
    files: [],
  });
  write(root, "App.tsx", EXPO_COMPONENT);
  write(
    root,
    "index.ts",
    `import { registerRootComponent } from "expo";
import App from "./App";
registerRootComponent(App);
`
  );
  write(root, "tests/App.test.tsx", EXPO_TEST);
}
