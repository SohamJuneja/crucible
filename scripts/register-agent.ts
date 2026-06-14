/**
 * Registers one test agent on the canonical IdentityRegistry (Mantle Sepolia).
 * Prints the returned agentId, tx hash, and Mantlescan link.
 *
 * Usage: npm run register:agent   (requires .env with MANTLE_PRIVATE_KEY)
 *
 * ABI-confirmed call: register(string agentURI) → (uint256 agentId)
 * Event parsed:       Registered(uint256 indexed agentId, string agentURI, address indexed owner)
 */
import 'dotenv/config'
import { decodeEventLog } from 'viem'
import { publicClient, getWalletClient } from '../packages/core/src/chain'
import {
  IDENTITY_REGISTRY_ADDRESS,
  identityRegistryAbi,
} from '../packages/core/src/contracts'

const AGENT_URI = 'https://crucible.local/agent.json'

async function main() {
  const walletClient = getWalletClient()
  console.log(`Registering agent from ${walletClient.account.address}`)
  console.log(`Agent URI : ${AGENT_URI}`)

  let hash: `0x${string}`
  try {
    hash = await walletClient.writeContract({
      address: IDENTITY_REGISTRY_ADDRESS,
      abi: identityRegistryAbi,
      functionName: 'register',
      args: [AGENT_URI],
    })
  } catch {
    // Mantle L2 gas-estimation gotcha: fall back to explicit limit
    console.log('Gas estimation reverted — retrying with explicit gas: 300_000 ...')
    hash = await walletClient.writeContract({
      address: IDENTITY_REGISTRY_ADDRESS,
      abi: identityRegistryAbi,
      functionName: 'register',
      args: [AGENT_URI],
      gas: 300_000n,
    })
  }

  console.log(`Tx submitted : ${hash}`)
  console.log('Waiting for confirmation ...')

  const receipt = await publicClient.waitForTransactionReceipt({ hash })

  // Parse Registered event from receipt logs to extract agentId
  let agentId: bigint | undefined
  for (const log of receipt.logs) {
    try {
      const event = decodeEventLog({
        abi: identityRegistryAbi,
        data: log.data,
        topics: log.topics,
      })
      if (event.eventName === 'Registered') {
        agentId = (event.args as { agentId: bigint }).agentId
        break
      }
    } catch {
      // log from a different contract or event — skip
    }
  }

  console.log('\nAgent registered!')
  console.log(`Agent ID  : ${agentId?.toString() ?? '(parse receipt manually)'}`)
  console.log(`Tx hash   : ${hash}`)
  console.log(`Explorer  : https://sepolia.mantlescan.xyz/tx/${hash}`)
}

main().catch((err) => { console.error(err); process.exit(1) })
