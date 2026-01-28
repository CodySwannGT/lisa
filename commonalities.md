# Common Dependencies Across Projects

## NestJS Common Dependencies

| Package                                   | Category            |
| ----------------------------------------- | ------------------- |
| @apollo/server                            | GraphQL Server      |
| @as-integrations/express5                 | Express Integration |
| @aws-sdk/client-apigatewaymanagementapi   | AWS SDK             |
| @aws-sdk/client-cognito-identity-provider | AWS SDK             |
| @aws-sdk/rds-signer                       | AWS SDK             |
| @graphql-tools/utils                      | GraphQL Tools       |
| @nestjs/apollo                            | NestJS              |
| @nestjs/common                            | NestJS              |
| @nestjs/config                            | NestJS              |
| @nestjs/core                              | NestJS              |
| @nestjs/graphql                           | NestJS              |
| @nestjs/platform-express                  | NestJS              |
| @nestjs/terminus                          | NestJS              |
| @nestjs/typeorm                           | NestJS              |
| @vendia/serverless-express                | Serverless          |
| aws-jwt-verify                            | AWS Auth            |
| aws-xray-sdk-core                         | AWS Observability   |
| class-transformer                         | Validation          |
| class-validator                           | Validation          |
| dataloader                                | GraphQL Performance |
| graphql                                   | GraphQL Core        |
| graphql-query-complexity                  | GraphQL Security    |
| graphql-subscriptions                     | GraphQL             |
| graphql-ws                                | GraphQL WebSocket   |
| ioredis                                   | Redis               |
| pg                                        | Database            |
| reflect-metadata                          | TypeScript Runtime  |
| rxjs                                      | Reactive Extensions |
| typeorm                                   | ORM                 |
| typeorm-naming-strategies                 | ORM                 |

## NestJS Common DevDependencies

| Package                                         | Category             |
| ----------------------------------------------- | -------------------- |
| @nestjs/cli                                     | NestJS               |
| @nestjs/schematics                              | NestJS               |
| @nestjs/testing                                 | NestJS               |
| @types/aws-lambda                               | Type Definitions     |
| @types/express                                  | Type Definitions     |
| @vitest/coverage-v8                             | Testing              |
| serverless                                      | Serverless Framework |
| serverless-esbuild                              | Serverless           |
| serverless-offline                              | Serverless           |
| vitest                                          | Testing              |

## Expo Common Dependencies

| Package |
|---------|
| @apollo/client |
| @expo/metro-runtime |
| @gluestack-ui/core |
| @gluestack-ui/utils |
| @gorhom/bottom-sheet |
| @hookform/resolvers |
| @legendapp/motion |
| @react-native-async-storage/async-storage |
| @react-navigation/drawer |
| @sentry/react-native |
| apollo-link-sentry |
| date-fns |
| date-fns-tz |
| expo |
| expo-application |
| expo-build-properties |
| expo-constants |
| expo-dev-client |
| expo-font |
| expo-linking |
| expo-network |
| expo-router |
| expo-secure-store |
| expo-splash-screen |
| expo-status-bar |
| expo-system-ui |
| expo-updates |
| graphql |
| lucide-react-native |
| nativewind |
| patch-package |
| react |
| react-dom |
| react-hook-form |
| react-native |
| react-native-gesture-handler |
| react-native-reanimated |
| react-native-safe-area-context |
| react-native-screens |
| react-native-svg |
| react-native-web |
| tailwindcss |
| use-debounce |

## Expo Common DevDependencies

| Package                                         |
| ----------------------------------------------- |
| @babel/core                                     |
| @babel/plugin-proposal-export-namespace-from    |
| @lhci/cli                                       |
| @playwright/test                                |
| @react-native-community/cli                     |
| @react-native-community/cli-platform-android    |
| @react-native-community/cli-platform-ios        |
| @testing-library/react-native                   |
| @types/react                                    |
| @types/react-dom                                |
| babel-plugin-istanbul                           |
| babel-plugin-module-resolver                    |
| baseline-browser-mapping                        |
| eslint-config-expo                              |
| eslint-plugin-component-structure               |
| eslint-plugin-jsx-a11y                          |
| eslint-plugin-react                             |
| eslint-plugin-react-compiler                    |
| eslint-plugin-react-hooks                       |
| eslint-plugin-react-perf                        |
| eslint-plugin-tailwindcss                       |
| eslint-plugin-ui-standards                      |
| expo-atlas                                      |
| globals                                         |
| jest-environment-jsdom                          |
| jest-expo                                       |
| prettier-plugin-tailwindcss                     |
| react-test-renderer                             |



## TypeScript Common Dependencies

Packages found in BOTH NestJS and Expo dependencies:

| Package | Category     |
| ------- | ------------ |
| graphql | GraphQL Core |

## TypeScript Common DevDependencies

Packages found in BOTH NestJS and Expo devDependencies:

| Package                                         | Category        |
| ----------------------------------------------- | --------------- |
| @commitlint/cli                                 | Git Hooks       |
| @commitlint/config-conventional                 | Git Hooks       |
| @eslint-community/eslint-plugin-eslint-comments | ESLint          |
| @eslint/eslintrc                                | ESLint          |
| @eslint/js                                      | ESLint          |
| @graphql-codegen/cli                            | GraphQL Codegen |
| @graphql-codegen/typescript                     | GraphQL Codegen |
| @graphql-codegen/typescript-operations          | GraphQL Codegen |
| @graphql-codegen/typescript-react-apollo        | GraphQL Codegen |
| @jest/test-sequencer                            | Testing         |
| @types/fs-extra                                 | Type Definitions|
| @types/jest                                     | Type Definitions|
| @types/lodash.merge                             | Type Definitions|
| @types/node                                     | Type Definitions|
| eslint                                          | Linting         |
| eslint-config-prettier                          | Linting         |
| eslint-import-resolver-typescript               | Linting         |
| eslint-plugin-code-organization                 | Linting         |
| eslint-plugin-functional                        | Linting         |
| eslint-plugin-import                            | Linting         |
| eslint-plugin-jsdoc                             | Linting         |
| eslint-plugin-prettier                          | Linting         |
| eslint-plugin-sonarjs                           | Linting         |
| husky                                           | Git Hooks       |
| jest                                            | Testing         |
| jscodeshift                                     | Code Transform  |
| lint-staged                                     | Git Hooks       |
| prettier                                        | Formatting      |
| standard-version                                | Versioning      |
| ts-jest                                         | Testing         |
| ts-morph                                        | Code Transform  |
| ts-node                                         | TypeScript Runtime |
| tsx                                             | TypeScript Runtime |
| typescript                                      | TypeScript      |
| typescript-eslint                               | Linting         |






## Pcakges that we need to remove
| react-test-renderer |
| commitizen |
| cz-conventional-changelog |
| babel-plugin-istanbul |
| @istanbuljs/nyc-config-typescript |
| vitest                                          | Testing              |
| @vitest/coverage-v8                             | Testing              |
| memfs | Testing |