import type { NextConfig } from 'next';

/**
 * The web app consumes the workspace packages straight from TypeScript source
 * (their package exports point at src/), so Next must transpile them. Those
 * packages use ESM-style `./x.js` specifiers for `.ts` files, so webpack needs
 * the matching extension alias.
 */
const nextConfig: NextConfig = {
  transpilePackages: ['@statutory/core', '@statutory/pipeline'],
  webpack: (config) => ({
    ...config,
    resolve: {
      ...config.resolve,
      extensionAlias: {
        ...config.resolve?.extensionAlias,
        '.js': ['.ts', '.tsx', '.js'],
      },
    },
  }),
};

export default nextConfig;
