/**
 * Metro configuration. Expo sets up the monorepo (workspace packages) itself.
 *
 * `@anthropic-ai/sdk`'s ESM build has an import cycle
 * (beta/messages → BetaToolRunner → beta) that fails to load under Metro in
 * development ("Cannot read property 'BetaToolRunner' of undefined") and takes
 * the whole app down. Its CommonJS build defers those exports and loads fine,
 * so this one package is resolved as CommonJS, also when imported from
 * `packages/core`.
 */
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
const defaultResolve = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = defaultResolve ?? context.resolveRequest;
  if (
    moduleName === "@anthropic-ai/sdk" ||
    moduleName.startsWith("@anthropic-ai/sdk/")
  ) {
    return resolve({ ...context, isESMImport: false }, moduleName, platform);
  }
  return resolve(context, moduleName, platform);
};

module.exports = config;
