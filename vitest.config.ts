import { defineConfig } from 'vitest/config'

// Root-level vitest config used when running `npx vitest run <path>` from the
// monorepo root.  Sets timeouts long enough for tests that make live RPC calls
// to Mantle Sepolia or Mantle mainnet.
export default defineConfig({
  test: {
    testTimeout: 60_000,
    hookTimeout: 30_000,
  },
})
