function requireEnv(key: string): string {
  const val = process.env[key]
  if (!val) throw new Error(`Missing required env var: ${key}`)
  return val
}

export const env = {
  /** Mantle Sepolia RPC — defaults to the public endpoint from CLAUDE.md §2 */
  MANTLE_RPC_URL: process.env.MANTLE_RPC_URL ?? 'https://rpc.sepolia.mantle.xyz',
  MANTLESCAN_API_KEY: process.env.MANTLESCAN_API_KEY ?? '',
  PINATA_JWT: process.env.PINATA_JWT ?? '',
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY ?? '',
}

/** Returns MANTLE_PRIVATE_KEY as a 0x-prefixed hex string, throws if unset. */
export function requirePrivateKey(): `0x${string}` {
  return requireEnv('MANTLE_PRIVATE_KEY') as `0x${string}`
}
