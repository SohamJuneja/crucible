/**
 * Decodes common DeFi calldata (ERC-20 approve / transfer / transferFrom).
 * Parsing is ABI-level: each parameter occupies 32 bytes; addresses are
 * right-aligned (last 20 bytes); uint256 fills the full slot.
 */

// ── ERC-20 4-byte selectors ────────────────────────────────────────────────
const SEL = {
  APPROVE:       '0x095ea7b3',  // approve(address,uint256)
  TRANSFER:      '0xa9059cbb',  // transfer(address,uint256)
  TRANSFER_FROM: '0x23b872dd',  // transferFrom(address,address,uint256)
} as const

export type CallType = 'approve' | 'transfer' | 'transferFrom' | 'unknown'

export interface DecodedCall {
  type:    CallType
  to?:     `0x${string}`   // spender (approve) or recipient (transfer/transferFrom)
  from?:   `0x${string}`   // source wallet (transferFrom only)
  amount?: bigint
}

/** Parse hex slice as a 20-byte address (strips the 12-byte zero-padding). */
function addr(hex: string): `0x${string}` {
  return `0x${hex.slice(24, 64)}` as `0x${string}`
}

/** Parse hex slice as uint256. */
function uint256(hex: string): bigint {
  return BigInt(`0x${hex}`)
}

/**
 * Decodes ERC-20 calldata into a typed structure.
 * Returns null if the data is too short or the selector is unrecognised.
 */
export function decodeCall(data: `0x${string}`): DecodedCall | null {
  if (!data || data.length < 10) return null
  const sel    = data.slice(0, 10).toLowerCase()
  const params = data.slice(10)            // raw param hex, no 0x prefix

  if (sel === SEL.APPROVE && params.length >= 128) {
    // approve(address spender, uint256 amount)
    return { type: 'approve', to: addr(params), amount: uint256(params.slice(64, 128)) }
  }

  if (sel === SEL.TRANSFER && params.length >= 128) {
    // transfer(address to, uint256 amount)
    return { type: 'transfer', to: addr(params), amount: uint256(params.slice(64, 128)) }
  }

  if (sel === SEL.TRANSFER_FROM && params.length >= 192) {
    // transferFrom(address from, address to, uint256 amount)
    return {
      type:   'transferFrom',
      from:   addr(params),                        // bytes 0-31
      to:     addr(params.slice(64)),              // bytes 32-63
      amount: uint256(params.slice(128, 192)),     // bytes 64-95
    }
  }

  return { type: 'unknown' }
}
