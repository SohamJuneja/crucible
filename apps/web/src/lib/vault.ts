/**
 * Server-side helpers for DelegationVault metadata.
 * Reads artifacts/deployed.json — safe to call from Server Components.
 */
import fs from 'fs'
import path from 'path'

interface VaultEntry {
  address:           string
  minScore:          number
  performanceFeeBps: number
}

interface DeployedJson {
  DelegationVault?: VaultEntry
}

function findArtifacts(): string {
  const candidates = [
    path.resolve(process.cwd(), 'artifacts/deployed.json'),
    path.resolve(process.cwd(), '..', '..', 'artifacts/deployed.json'),
  ]
  return candidates.find(fs.existsSync) ?? candidates[0]
}

export interface DelegationMeta {
  vaultAddress:      string
  minScore:          number   // encoded (e.g. 6000 = 60.00)
  performanceFeeBps: number   // e.g. 1000 = 10 %
}

export function getDelegationMeta(): DelegationMeta | null {
  const p = findArtifacts()
  if (!fs.existsSync(p)) return null
  const json = JSON.parse(fs.readFileSync(p, 'utf8')) as DeployedJson
  const vault = json.DelegationVault
  if (!vault) return null
  return {
    vaultAddress:      vault.address,
    minScore:          vault.minScore,
    performanceFeeBps: vault.performanceFeeBps,
  }
}
