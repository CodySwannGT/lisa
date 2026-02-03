/**
 * Babel Configuration
 *
 * Configures Babel for Expo with NativeWind JSX transform support.
 * This file is create-only — Lisa will create it but never overwrite
 * your customizations.
 *
 * @remarks Required by the `jest.expo.ts` babel-jest transform which
 * uses a metro caller config. Without this file, babel-jest cannot
 * resolve the correct presets for React Native compilation.
 * @see https://docs.expo.dev/versions/latest/config/babel/
 * @module babel.config
 */
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      [
        "babel-preset-expo",
        {
          jsxImportSource: "nativewind",
        },
      ],
      "nativewind/babel",
    ],
  };
};
