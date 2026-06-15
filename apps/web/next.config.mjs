/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@crucible/engine', '@crucible/scoring', '@crucible/core'],
  webpack(config) {
    // Workspace packages use .js extensions in ESM imports (tsx resolves these
    // to .ts; webpack needs this hint to do the same).
    config.resolve.extensionAlias = {
      '.js':  ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    }
    return config
  },
}

export default nextConfig
