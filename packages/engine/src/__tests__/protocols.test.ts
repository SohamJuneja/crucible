/**
 * Multi-protocol decoder tests — Mantle MAINNET (chain ID 5000), read-only.
 *
 * Three real mainnet transactions, one synthetic Init Capital fixture.
 * Real txs are fetched from https://rpc.mantle.xyz at test time.
 */
import 'dotenv/config'
import { describe, it, expect } from 'vitest'
import { createPublicClient, http } from 'viem'
import { mantle } from 'viem/chains'
import { decodeProtocol } from '../decoders/protocols/index'
import { INIT_CAPITAL_MINT_TOPIC } from '../decoders/protocols/initCapital'

// ── Mantle mainnet read-only client ──────────────────────────────────────────

const mainnetClient = createPublicClient({
  chain:     mantle,
  transport: http('https://rpc.mantle.xyz'),
})

// ── Helper ───────────────────────────────────────────────────────────────────

async function receipt(txHash: `0x${string}`) {
  return mainnetClient.getTransactionReceipt({ hash: txHash })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Protocol decoder registry — Mantle mainnet integration', () => {

  // ── 1. UniswapV2-style Swap (FusionX V2 pool on Mantle) ───────────────────
  //    Real mainnet tx verified on Mantlescan:
  //    https://mantlescan.xyz/tx/0xe10af5f9b1f79c7adcfdb79d5cb43c148f77068d592c8c278b2d07163813e6a8
  it('UniswapV2: FusionX V2 swap — detects protocol and extracts token/amounts', async () => {
    const TX    = '0xe10af5f9b1f79c7adcfdb79d5cb43c148f77068d592c8c278b2d07163813e6a8' as const
    const AGENT = '0x655cdce9c2ac6869129cb32d9f6cb9f18c727da0' as const
    // Pool: 0x7c88dd67138291d38f0fea2889e4a341cd8983b1

    const r      = await receipt(TX)
    const result = decodeProtocol(r.logs, AGENT)

    console.log('\n[V2 UniswapV2]', JSON.stringify(result, null, 2))
    console.log('  Explorer: https://mantlescan.xyz/tx/' + TX)

    expect(result).not.toBeNull()
    expect(result!.protocol).toContain('UniswapV2')
    expect(result!.action).toBe('swap')

    // tokenIn: Transfer TO pool  = 0x78c1b0c915c4faa5fffa6cabf0219da63d7f4cb8
    // tokenOut: Transfer FROM pool = 0x1bdd8878252daddd3af2ba30628813271294edc0
    expect(result!.tokenIn?.toLowerCase()).toBe('0x78c1b0c915c4faa5fffa6cabf0219da63d7f4cb8')
    expect(result!.tokenOut?.toLowerCase()).toBe('0x1bdd8878252daddd3af2ba30628813271294edc0')

    // Amounts from the V2 Swap event
    expect(result!.amountIn).toBe('50000000000000000000')    // 50 tokens
    expect(result!.amountOut).toBe('470002053220261512021')  // ~470 tokens
  })

  // ── 2. UniswapV3-style Swap (Agni Finance pool on Mantle) ─────────────────
  //    Real mainnet tx verified on Mantlescan:
  //    https://mantlescan.xyz/tx/0x41bb95c1477a0665f3cf4b37205813084aee320c97539b6e19979616493284b2
  it('UniswapV3: Agni Finance swap — detects protocol and extracts signed amounts', async () => {
    const TX    = '0x41bb95c1477a0665f3cf4b37205813084aee320c97539b6e19979616493284b2' as const
    const AGENT = '0xc1ed7ed164ed8a8019b694444dd3c606c7ceff26' as const
    // Pool: 0x8442048774eee4ebf19cec3c07154ec338978180

    const r      = await receipt(TX)
    const result = decodeProtocol(r.logs, AGENT)

    console.log('\n[V3 UniswapV3/Agni]', JSON.stringify(result, null, 2))
    console.log('  Explorer: https://mantlescan.xyz/tx/' + TX)

    expect(result).not.toBeNull()
    expect(result!.protocol).toContain('UniswapV3')
    expect(result!.action).toBe('swap')

    // amount0 = 15014923 (positive → pool receives → tokenIn)
    // amount1 = -904803317968696095900 (negative → pool sends → tokenOut)
    // tokenIn = 0x779ded0c9e1022225f8e0630b35a9b54be713736 (Transfer TO pool)
    // tokenOut = 0x8ddb986b11c039a6cc1dbcabd62bae911b348f33 (Transfer FROM pool)
    expect(result!.tokenIn?.toLowerCase()).toBe('0x779ded0c9e1022225f8e0630b35a9b54be713736')
    expect(result!.tokenOut?.toLowerCase()).toBe('0x8ddb986b11c039a6cc1dbcabd62bae911b348f33')
    expect(result!.amountIn).toBe('15014923')
    expect(result!.amountOut).toBe('904803317968696095900')
  })

  // ── 3. Aave V2 Deposit — Lendle LendingPool on Mantle ────────────────────
  //    Real mainnet tx verified on Mantlescan:
  //    https://mantlescan.xyz/tx/0xabd4abef00756d119b0618413d2d0d549fbac30c19f988563570a2fc0139bb5b
  it('Aave V2: Lendle deposit — detects protocol and extracts reserve + amount', async () => {
    const TX    = '0xabd4abef00756d119b0618413d2d0d549fbac30c19f988563570a2fc0139bb5b' as const
    const AGENT = '0x7c05ecaf12efe285d82e0f5556f5a0c32509acb6' as const
    // LendingPool: 0xcfa5ae7c2ce8fadc6426c1ff872ca45378fb7cf3

    const r      = await receipt(TX)
    const result = decodeProtocol(r.logs, AGENT)

    console.log('\n[AaveV2/Lendle Deposit]', JSON.stringify(result, null, 2))
    console.log('  Explorer: https://mantlescan.xyz/tx/' + TX)

    expect(result).not.toBeNull()
    expect(result!.protocol).toContain('Aave V2')
    expect(result!.action).toBe('lendDeposit')

    // reserve (indexed topic[1]) = 0xdeaddeaddeaddeaddeaddeaddeaddeaddead1111 (WMNT)
    // amount from data slot [32..63] = 500000000000000000 (0.5 WMNT)
    expect(result!.tokenIn?.toLowerCase()).toBe('0xdeaddeaddeaddeaddeaddeaddeaddeaddead1111')
    expect(result!.amountIn).toBe('500000000000000000')
  })

  // ── 4. Init Capital — SYNTHETIC LOG FIXTURE ───────────────────────────────
  //    Init Capital is deployed on Mantle mainnet but uses a custom Mint event
  //    not found in recent blocks at test-write time.  This fixture is
  //    constructed from the Init Capital IPool ABI:
  //      event Mint(address indexed to, uint256 shares, uint256 amt)
  //    Topic0 = keccak256("Mint(address,uint256,uint256)")
  //           = 0x4c209b5fc8ad50758f13e2e1088ba56a560dff690a1c6fef26394f4c03821c4f
  //    The underlying token is inferred from a synthetic ERC-20 Transfer log.
  it('Init Capital: Mint deposit — SYNTHETIC LOG FIXTURE — detects and decodes', () => {
    const AGENT      = '0x1234567890abcdef1234567890abcdef12345678' as `0x${string}`
    const POOL       = '0xaabbccdd00112233445566778899aabbccddeeff' as `0x${string}`
    const UNDERLYING = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' as `0x${string}`
    const SHARES     = 1000n * 10n ** 18n
    const AMT        = 1000n * 10n ** 18n  // same — 1:1 pool

    // SYNTHETIC LOG FIXTURE — built from Init Capital IPool ABI
    const syntheticLogs = [
      // ERC-20 Transfer: user sends underlying to pool
      {
        address: UNDERLYING,
        topics: [
          '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
          `0x000000000000000000000000${AGENT.slice(2)}`,
          `0x000000000000000000000000${POOL.slice(2)}`,
        ] as readonly `0x${string}`[],
        data: `0x${AMT.toString(16).padStart(64, '0')}` as `0x${string}`,
      },
      // Mint event from pool contract
      {
        address: POOL,
        topics: [
          INIT_CAPITAL_MINT_TOPIC,
          `0x000000000000000000000000${AGENT.slice(2)}`,  // indexed `to`
        ] as readonly `0x${string}`[],
        // data = abi.encode(uint256 shares, uint256 amt)
        data: `0x${SHARES.toString(16).padStart(64, '0')}${AMT.toString(16).padStart(64, '0')}` as `0x${string}`,
      },
    ]

    const result = decodeProtocol(syntheticLogs, AGENT)

    console.log('\n[Init Capital — SYNTHETIC]', JSON.stringify(result, null, 2))

    expect(result).not.toBeNull()
    expect(result!.protocol).toBe('Init Capital')
    expect(result!.action).toBe('lendDeposit')
    expect(result!.tokenIn?.toLowerCase()).toBe(UNDERLYING.toLowerCase())
    expect(result!.amountIn).toBe(AMT.toString())
  })

  // ── 5. Fallback: no known protocol event → registry returns null ──────────
  it('returns null for a tx with only ERC-20 Transfer events (no protocol event)', () => {
    const transferOnlyLogs = [
      {
        address: '0x1234000000000000000000000000000000000000' as `0x${string}`,
        topics: [
          '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
          '0x0000000000000000000000001111111111111111111111111111111111111111',
          '0x0000000000000000000000002222222222222222222222222222222222222222',
        ] as readonly `0x${string}`[],
        data: '0x0000000000000000000000000000000000000000000000000de0b6b3a7640000' as `0x${string}`,
      },
    ]

    const result = decodeProtocol(
      transferOnlyLogs,
      '0x1111111111111111111111111111111111111111',
    )
    expect(result).toBeNull()
  })
})
