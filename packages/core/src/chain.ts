import { createPublicClient, createWalletClient, http } from 'viem'
import { mantleSepoliaTestnet } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import { env, requirePrivateKey } from './env.js'

export const publicClient = createPublicClient({
  chain: mantleSepoliaTestnet,
  transport: http(env.MANTLE_RPC_URL),
})

export function getWalletClient() {
  const account = privateKeyToAccount(requirePrivateKey())
  return createWalletClient({
    account,
    chain: mantleSepoliaTestnet,
    transport: http(env.MANTLE_RPC_URL),
  })
}
