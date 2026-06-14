/**
 * Unit tests for assessIntent.
 * No live RPC required — publicClient is mocked.
 */
import { describe, it, expect, vi } from 'vitest'
import { parseEther, encodeFunctionData } from 'viem'
import { assessIntent } from '../assessIntent'
import type { Intent, AssessClient } from '../assessIntent'

// ── Addresses ──────────────────────────────────────────────────────────────

const AGENT    = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as `0x${string}`
const TOKEN_A  = '0x1111111111111111111111111111111111111111' as `0x${string}`
const MOCK_DEX = '0x2222222222222222222222222222222222222222' as `0x${string}`
const ATTACKER = '0xdeadbeef000000000000000000000000000000ff' as `0x${string}`

const MAX_UINT256 = 2n ** 256n - 1n

// ── ABI helpers ────────────────────────────────────────────────────────────

const ERC20_ABI = [
  { name: 'approve',  type: 'function' as const, inputs: [{ name: 'spender', type: 'address' }, { name: 'amount',  type: 'uint256' }], outputs: [] },
  { name: 'transfer', type: 'function' as const, inputs: [{ name: 'to',      type: 'address' }, { name: 'amount',  type: 'uint256' }], outputs: [] },
] as const

const approve  = (spender: `0x${string}`, amount: bigint): `0x${string}` =>
  encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve',  args: [spender, amount] })

const transfer = (to: `0x${string}`, amount: bigint): `0x${string}` =>
  encodeFunctionData({ abi: ERC20_ABI, functionName: 'transfer', args: [to,      amount] })

// ── Mock client factory ────────────────────────────────────────────────────

/** Returns a mock AssessClient.  readContract returns the given token balance. */
function mockClient(tokenBalance = parseEther('100')): AssessClient {
  return {
    call:         vi.fn().mockResolvedValue({ data: '0x' }),
    readContract: vi.fn().mockResolvedValue(tokenBalance),
  } as unknown as AssessClient
}

// ── Extra allowlist for tests (TOKEN_A + MOCK_DEX are our known-good tokens) ─
const EXTRA = new Set([TOKEN_A.toLowerCase(), MOCK_DEX.toLowerCase()])

// ── Tests ──────────────────────────────────────────────────────────────────

describe('assessIntent', () => {

  it('benign approve to allowlisted MockDEX → ALLOW (score 0)', async () => {
    const intent: Intent = {
      agentAddress: AGENT,
      to:           TOKEN_A,
      data:         approve(MOCK_DEX, parseEther('1')),  // 1 tokenA to known DEX
      value:        0n,
    }

    const result = await assessIntent(intent, mockClient(), { extraAllowlist: EXTRA })

    console.log('[ALLOW] benign approve:', result)

    expect(result.decision).toBe('ALLOW')
    expect(result.riskScore).toBe(0)
    expect(result.reasons).toHaveLength(0)
  })

  it('unlimited approve to attacker EOA → BLOCK (names the rule)', async () => {
    const intent: Intent = {
      agentAddress: AGENT,
      to:           TOKEN_A,           // token contract is trusted
      data:         approve(ATTACKER, MAX_UINT256),   // MaxUint256 to unknown EOA
      value:        0n,
    }

    const result = await assessIntent(intent, mockClient(), { extraAllowlist: EXTRA })

    console.log('[BLOCK] unlimited approve:', result)

    expect(result.decision).toBe('BLOCK')
    expect(result.riskScore).toBeGreaterThanOrEqual(60)
    expect(result.reasons.some(r => r.includes('unlimited_approve_to_untrusted_spender'))).toBe(true)
    expect(result.reasons.some(r => r.includes(ATTACKER.toLowerCase()))).toBe(true)
  })

  it('drain transfer (>50% balance) to attacker EOA → BLOCK (names the rule)', async () => {
    const BALANCE = parseEther('100')   // mock: agent holds 100 tokenA
    const DRAIN   = parseEther('90')    // 90% of balance — above 50% threshold

    const intent: Intent = {
      agentAddress: AGENT,
      to:           TOKEN_A,           // ERC-20 contract (trusted)
      data:         transfer(ATTACKER, DRAIN),
      value:        0n,
    }

    // Mock readContract → returns BALANCE for balanceOf call
    const client: AssessClient = {
      call:         vi.fn().mockResolvedValue({ data: '0x' }),
      readContract: vi.fn().mockResolvedValue(BALANCE),
    } as unknown as AssessClient

    const result = await assessIntent(intent, client, { extraAllowlist: EXTRA })

    console.log('[BLOCK] drain transfer:', result)

    expect(result.decision).toBe('BLOCK')
    expect(result.riskScore).toBeGreaterThanOrEqual(60)
    expect(result.reasons.some(r => r.includes('drain_pattern'))).toBe(true)
    expect(result.reasons.some(r => r.includes(ATTACKER.toLowerCase()))).toBe(true)
  })

  it('large absolute drain (>100 tokens) without balance read → BLOCK', async () => {
    // readContract throws → falls back to absolute threshold (100 tokens)
    const DRAIN = parseEther('500')  // 500 tokens — above 100-token absolute threshold

    const client: AssessClient = {
      call:         vi.fn().mockResolvedValue({ data: '0x' }),
      readContract: vi.fn().mockRejectedValue(new Error('network error')),
    } as unknown as AssessClient

    const result = await assessIntent(
      { agentAddress: AGENT, to: TOKEN_A, data: transfer(ATTACKER, DRAIN), value: 0n },
      client,
      { extraAllowlist: EXTRA },
    )

    expect(result.decision).toBe('BLOCK')
    expect(result.reasons.some(r => r.includes('drain_pattern'))).toBe(true)
  })

  it('unknown contract interaction → WARN', async () => {
    const UNKNOWN_CONTRACT = '0x9999999999999999999999999999999999999999' as `0x${string}`

    const result = await assessIntent(
      { agentAddress: AGENT, to: UNKNOWN_CONTRACT, data: approve(MOCK_DEX, parseEther('1')), value: 0n },
      mockClient(),
      // NO extraAllowlist for this test — unknown contract
    )

    console.log('[WARN] unknown contract:', result)

    expect(result.decision).toBe('WARN')
    expect(result.riskScore).toBe(20)
    expect(result.reasons.some(r => r.includes('unknown_contract'))).toBe(true)
  })
})
