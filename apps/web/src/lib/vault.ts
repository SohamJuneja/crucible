/**
 * Server-side helpers for DelegationVault metadata.
 * Reads from the committed snapshot bundle — safe to call from Server Components.
 */
import snapshot from '../../data/snapshot.json'

export interface DelegationMeta {
  vaultAddress:      string
  minScore:          number   // encoded (e.g. 6000 = 60.00)
  performanceFeeBps: number   // e.g. 1000 = 10 %
}

export function getDelegationMeta(): DelegationMeta {
  return {
    vaultAddress:      snapshot.vault.address,
    minScore:          snapshot.vault.minScore,
    performanceFeeBps: snapshot.vault.performanceFeeBps,
  }
}
