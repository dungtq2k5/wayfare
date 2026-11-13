const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

// Expo configures the pnpm workspace; the shared packages are read from their compiled `dist`
// like every other consumer reads them, so `turbo run build` precedes Metro (`pnpm dev`).
const config = withNativeWind(getDefaultConfig(__dirname), { input: './global.css' });

// One React Query for the whole bundle. api-client's CommonJS `dist` requires it while the app
// imports it, and the package ships a build for each condition: two copies, two contexts, and the
// generated hooks never see the app's QueryClientProvider ("No QueryClient set").
const reactQuery = require.resolve('@tanstack/react-query');
const upstream = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) =>
  moduleName === '@tanstack/react-query'
    ? { type: 'sourceFile', filePath: reactQuery }
    : (upstream ?? context.resolveRequest)(context, moduleName, platform);

module.exports = config;
