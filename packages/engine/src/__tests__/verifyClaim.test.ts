/**
 * Integration tests for verifyClaim against real Mantle Sepolia transactions.
 * Run `npm run make:fixtures` first to populate fixtures.json with live tx data.
 */
import 'dotenv/config'
import { describe, it, expect } from 'vitest'
import { createPublicClient, http } from 'viem'
import { mantleSepoliaTestnet } from 'viem/chains'
import { verifyClaim } from '../verifyClaim'
import type { AgentClaim } from '@crucible/core'
import fixturesRaw from './fixtures.json'

const publicClient = createPublicClient({
  chain: mantleSepoliaTestnet,
  transport: http(process.env.MANTLE_RPC_URL ?? 'https://rpc.sepolia.mantle.xyz'),
})

// Skip entire suite if fixtures haven't been generated yet
const READY = fixturesRaw.honestSwap.txHash !== '0x' + '0'.repeat(64)

describe.skipIf(!READY)('verifyClaim — Mantle Sepolia integration', () => {
  const f = fixturesRaw

  it('VERIFIED: honest claim matches chain exactly', async () => {
    const claim: AgentClaim = {
      agentId: '1',
      agentAddress: f.agentAddress as `0x${string}`,
      action: 'swap',
      txHash: f.honestSwap.txHash as `0x${string}`,
      params: {
        tokenIn:   f.honestSwap.tokenIn  as `0x${string}`,
        tokenOut:  f.honestSwap.tokenOut as `0x${string}`,
        amountIn:  f.honestSwap.amountIn,
        amountOut: f.honestSwap.amountOut,
      },
      timestamp: new Date().toISOString(),
    }

    const result = await verifyClaim(claim, publicClient)
    console.log('\n[VERIFIED] result:', JSON.stringify(result, null, 2))

    expect(result.verdict).toBe('VERIFIED')
    expect(result.truthScore).toBeGreaterThanOrEqual(0.98)
    expect(result.derived.txExists).toBe(true)
    expect(result.derived.txSuccess).toBe(true)
    expect(result.derived.actualTokenIn?.toLowerCase()).toBe(f.honestSwap.tokenIn.toLowerCase())
    expect(result.derived.actualTokenOut?.toLowerCase()).toBe(f.honestSwap.tokenOut.toLowerCase())
    expect(result.derived.actualAmountOut).toBe(f.honestSwap.amountOut)
  })

  it('EXAGGERATED: same tx but claimed amountOut inflated 30% above actual', async () => {
    // Inflate claimed amountOut by 30 %
    const inflated = (BigInt(f.honestSwap.amountOut) * 130n / 100n).toString()

    const claim: AgentClaim = {
      agentId: '1',
      agentAddress: f.agentAddress as `0x${string}`,
      action: 'swap',
      txHash: f.honestSwap.txHash as `0x${string}`,
      params: {
        tokenIn:   f.honestSwap.tokenIn  as `0x${string}`,
        tokenOut:  f.honestSwap.tokenOut as `0x${string}`,
        amountIn:  f.honestSwap.amountIn,
        amountOut: inflated,
      },
      timestamp: new Date().toISOString(),
    }

    const result = await verifyClaim(claim, publicClient)
    console.log('\n[EXAGGERATED] result:', JSON.stringify(result, null, 2))

    expect(result.verdict).toBe('EXAGGERATED')
    expect(result.truthScore).toBeLessThan(0.9)
    expect(result.reasons.length).toBeGreaterThan(0)
    expect(result.reasons[0]).toMatch(/amountOut_claimed_.*_above_actual/)
  })

  it('FALSE_CLAIM: correct txHash but wrong tokenIn asserted', async () => {
    const claim: AgentClaim = {
      agentId: '1',
      agentAddress: f.agentAddress as `0x${string}`,
      action: 'swap',
      txHash: f.honestSwap.txHash as `0x${string}`,
      params: {
        // Claim the swap used tokenB as input (backwards — it's actually the output)
        tokenIn:   f.honestSwap.tokenOut as `0x${string}`,
        tokenOut:  f.honestSwap.tokenIn  as `0x${string}`,
        amountIn:  f.honestSwap.amountOut,
        amountOut: f.honestSwap.amountIn,
      },
      timestamp: new Date().toISOString(),
    }

    const result = await verifyClaim(claim, publicClient)
    console.log('\n[FALSE_CLAIM] result:', JSON.stringify(result, null, 2))

    expect(result.verdict).toBe('FALSE_CLAIM')
    expect(result.truthScore).toBe(0)
    expect(result.reasons.length).toBeGreaterThan(0)
    expect(result.reasons[0]).toMatch(/wrong_tokenIn/)
  })
})

describe.skipIf(READY)('verifyClaim — fixtures not generated', () => {
  it('skipped — run: npm run make:fixtures', () => {
    console.warn('Fixtures not ready. Run: npm run make:fixtures')
  })
})
