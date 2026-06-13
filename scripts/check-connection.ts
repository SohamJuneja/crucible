/**
 * Verifies the Mantle Sepolia connection and prints chain ID, latest block, and
 * the address + MNT balance derived from MANTLE_PRIVATE_KEY.
 *
 * Usage: npm run check:connection  (requires .env with MANTLE_PRIVATE_KEY set)
 */
import 'dotenv/config'
import { createPublicClient, http, formatEther } from 'viem'
import { mantleSepoliaTestnet } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'

const rpcUrl = process.env.MANTLE_RPC_URL ?? 'https://rpc.sepolia.mantle.xyz'
const rawKey = process.env.MANTLE_PRIVATE_KEY

if (!rawKey) {
  console.error('Error: MANTLE_PRIVATE_KEY is not set in .env')
  process.exit(1)
}

const client = createPublicClient({
  chain: mantleSepoliaTestnet,
  transport: http(rpcUrl),
})

const account = privateKeyToAccount(rawKey as `0x${string}`)

async function main() {
  const [chainId, blockNumber, balance] = await Promise.all([
    client.getChainId(),
    client.getBlockNumber(),
    client.getBalance({ address: account.address }),
  ])

  console.log('Mantle Sepolia connection check')
  console.log('--------------------------------')
  console.log(`Chain ID      : ${chainId}`)
  console.log(`Latest block  : ${blockNumber}`)
  console.log(`Address       : ${account.address}`)
  console.log(`MNT balance   : ${formatEther(balance)} MNT`)
}

main().catch((err) => { console.error(err); process.exit(1) })
