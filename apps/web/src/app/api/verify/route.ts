import { NextRequest, NextResponse } from 'next/server'
import { createPublicClient, http } from 'viem'
import { mantle } from 'viem/chains'
import { verifyClaim } from '@crucible/engine'
import type { AgentClaim, VerificationResult } from '@crucible/core'

const mainnetClient = createPublicClient({
  chain:     mantle,
  transport: http('https://rpc.mantle.xyz'),
})

function templateExplanation(result: VerificationResult): string {
  const { verdict, derived, reasons } = result
  switch (verdict) {
    case 'VERIFIED':
      return `The claim checks out. The transaction was found on Mantle mainnet, executed successfully, and the swap parameters match chain state${derived.slippagePct !== undefined ? ` (slippage: ${derived.slippagePct.toFixed(2)}%)` : ''}.`
    case 'EXAGGERATED':
      return `The transaction is real, but the claimed output was inflated beyond the 10% tolerance threshold. The agent over-stated the result compared to what actually appeared on-chain.`
    case 'FALSE_CLAIM':
      if (reasons.includes('tx_not_found')) return `This transaction hash was not found on Mantle mainnet. The claimed transaction does not exist on-chain.`
      if (reasons.includes('tx_reverted'))  return `The transaction reverted and did not succeed. A failed transaction cannot back a verified trade claim.`
      return `The claimed token parameters do not match what happened on-chain. This is a fabricated or mis-attributed claim.`
    case 'UNVERIFIABLE':
      return `The claim could not be verified — the transaction type or log format is not currently supported by the Crucible engine.`
    default:
      return 'Verification complete.'
  }
}

async function aiExplanation(result: VerificationResult): Promise<string> {
  const key = process.env.OPENAI_API_KEY
  if (!key) return templateExplanation(result)

  const prompt = `You are the Crucible verification engine narrator. Write 1-2 concise sentences explaining what happened and why the verdict was issued. Be direct and factual. Do NOT suggest changing the verdict — it is final and deterministic.

Verdict: ${result.verdict}
Truth score: ${(result.truthScore * 100).toFixed(0)}%
Reasons: ${result.reasons.join(', ') || 'none'}
Actual tokenIn: ${result.derived.actualTokenIn ?? 'unknown'}
Actual tokenOut: ${result.derived.actualTokenOut ?? 'unknown'}
Actual amountIn: ${result.derived.actualAmountIn ?? 'unknown'}
Actual amountOut: ${result.derived.actualAmountOut ?? 'unknown'}

Explanation:`

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${key}`,
      },
      body: JSON.stringify({
        model:       'gpt-4o-mini',
        messages:    [{ role: 'user', content: prompt }],
        max_tokens:  130,
        temperature: 0.3,
      }),
    })
    if (!res.ok) return templateExplanation(result)
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
    return data.choices?.[0]?.message?.content?.trim() ?? templateExplanation(result)
  } catch {
    return templateExplanation(result)
  }
}

// Streams two NDJSON events so the client can render chain result immediately,
// then show "AI generating…" while OpenAI runs, then typewriter the explanation.
export async function POST(req: NextRequest) {
  let body: Record<string, string>
  try {
    body = await req.json() as Record<string, string>
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (!body.txHash?.startsWith('0x')) {
    return NextResponse.json(
      { error: 'txHash is required and must start with 0x' },
      { status: 400 },
    )
  }

  const claim: AgentClaim = {
    agentId:      '0',
    agentAddress: (body.agentAddress ?? '0x0000000000000000000000000000000000000000') as `0x${string}`,
    action:       (body.action ?? 'swap') as AgentClaim['action'],
    txHash:       body.txHash as `0x${string}`,
    params: {
      tokenIn:   body.tokenIn  ? body.tokenIn  as `0x${string}` : undefined,
      tokenOut:  body.tokenOut ? body.tokenOut as `0x${string}` : undefined,
      amountIn:  body.amountIn  || undefined,
      amountOut: body.amountOut || undefined,
    },
    timestamp: new Date().toISOString(),
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: object) =>
        controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'))

      try {
        // Phase 1 — deterministic chain verification (RPC read, fast)
        const result = await verifyClaim(claim, mainnetClient)
        send({ type: 'result', result })

        // Phase 2 — AI explanation (OpenAI call; client shows spinner between these two events)
        const explanation = await aiExplanation(result)
        send({ type: 'explanation', explanation })
      } catch (err) {
        send({ type: 'error', message: err instanceof Error ? err.message : 'Verification failed' })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
