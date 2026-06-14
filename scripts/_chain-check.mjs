import 'dotenv/config'
import { createPublicClient, http } from 'viem'
import { mantleSepoliaTestnet } from 'viem/chains'

const pc  = createPublicClient({ chain: mantleSepoliaTestnet, transport: http(process.env.MANTLE_RPC_URL ?? 'https://rpc.sepolia.mantle.xyz') })
const SB  = '0x6bd5079e7bfe565eace7b374cb195c31e214247a'
const DV  = '0xabf24c1356ec094858aba00c65ca258ddc2ee1cb'
const VER = '0x2010834D1aB47a121B926790F47f6947b4a8e890'

const SB_ABI = [
  { name: 'getScore', type: 'function', stateMutability: 'view', inputs: [{ name: 'agentId', type: 'uint256' }], outputs: [{ name: '', type: 'uint16' }] },
  { name: 'verifier', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
]
const DV_ABI = [
  { name: 'delegationOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }, { name: 'id', type: 'uint256' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'minScore',   type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint16' }] },
  { name: 'scoreboard', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
]

const [score8801, score8803, verAddr, delOf8801, delOf8803, minScore, sbAddr] = await Promise.all([
  pc.readContract({ address: SB, abi: SB_ABI, functionName: 'getScore', args: [8801n] }),
  pc.readContract({ address: SB, abi: SB_ABI, functionName: 'getScore', args: [8803n] }),
  pc.readContract({ address: SB, abi: SB_ABI, functionName: 'verifier' }),
  pc.readContract({ address: DV, abi: DV_ABI, functionName: 'delegationOf', args: [VER, 8801n] }),
  pc.readContract({ address: DV, abi: DV_ABI, functionName: 'delegationOf', args: [VER, 8803n] }),
  pc.readContract({ address: DV, abi: DV_ABI, functionName: 'minScore' }),
  pc.readContract({ address: DV, abi: DV_ABI, functionName: 'scoreboard' }),
])

console.log(`SB.getScore(8801)         = ${score8801}`)
console.log(`SB.getScore(8803)         = ${score8803}`)
console.log(`SB.verifier               = ${verAddr}`)
console.log(`DV.delegationOf(ver,8801) = ${delOf8801}`)
console.log(`DV.delegationOf(ver,8803) = ${delOf8803}`)
console.log(`DV.minScore               = ${minScore}`)
console.log(`DV.scoreboard             = ${sbAddr}`)
console.log(`SB addr matches DV.scoreboard? = ${sbAddr.toLowerCase() === SB.toLowerCase()}`)
