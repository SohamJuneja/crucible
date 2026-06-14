import { type Abi } from 'viem'
import IdentityRegistryJson from '../abis/IdentityRegistry.json'
import ReputationRegistryJson from '../abis/ReputationRegistry.json'

export const IDENTITY_REGISTRY_ADDRESS =
  '0x8004A818BFB912233c491871b3d84c89A494BD9e' as const

export const REPUTATION_REGISTRY_ADDRESS =
  '0x8004B663056A597Dffe9eCcC1965A193B7388713' as const

export const identityRegistryAbi = IdentityRegistryJson as Abi
export const reputationRegistryAbi = ReputationRegistryJson as Abi

export const IDENTITY_REGISTRY = {
  address: IDENTITY_REGISTRY_ADDRESS,
  abi: identityRegistryAbi,
} as const

export const REPUTATION_REGISTRY = {
  address: REPUTATION_REGISTRY_ADDRESS,
  abi: reputationRegistryAbi,
} as const
