/**
 * format.ts — builds alert messages for each Crucible event type.
 *
 * Each builder returns { telegram, discord } so callers can route to
 * whichever channels are configured without caring about rendering details.
 *
 * Telegram uses Markdown V1 (*bold*, `code`, [text](url)).
 * Discord uses rich embeds with a teal color scheme (0x00B4D8).
 */
import type { DiscordEmbed, DiscordField, DiscordWebhookPayload } from './channels.js'

// ── Constants ─────────────────────────────────────────────────────────────────

const EXPLORER = 'https://sepolia.mantlescan.xyz'
const TEAL     = 0x00B4D8   // Crucible brand teal, looks clean on Discord dark mode

// ── Helpers ───────────────────────────────────────────────────────────────────

export interface AlertOutput {
  telegram: string
  discord:  DiscordWebhookPayload
}

function txLink(hash: string):  string { return `${EXPLORER}/tx/${hash}` }
function addrLink(addr: string): string { return `${EXPLORER}/address/${addr}` }
function shortHash(hash: string): string { return `${hash.slice(0, 8)}…${hash.slice(-6)}` }

function discordPayload(embed: Omit<DiscordEmbed, 'color'>): DiscordWebhookPayload {
  return {
    username: 'Crucible',
    embeds: [{
      ...embed,
      color:     TEAL,
      timestamp: new Date().toISOString(),
      footer:    { text: 'Crucible · Mantle Sepolia (chainId 5003)' },
    }],
  }
}

function tgLine(...parts: string[]): string { return parts.join('\n') }

const VERDICT_ICON: Record<string, string> = {
  VERIFIED:     '✅',
  EXAGGERATED:  '⚠️',
  FALSE_CLAIM:  '🚨',
  UNVERIFIABLE: '❓',
}

const RISK_ICON: Record<string, string> = {
  LOW:      '🟡',
  MEDIUM:   '🟠',
  HIGH:     '🔴',
  CRITICAL: '⛔',
}

// ── 1. New Verdict ─────────────────────────────────────────────────────────────

export interface VerdictAlertOpts {
  agentName:    string
  agentAddress: string
  verdict:      string
  truthScore:   number   // 0..1
  score:        number   // 0..100
  action:       string
  txHash:       string
}

export function verdictAlert(o: VerdictAlertOpts): AlertOutput {
  const icon    = VERDICT_ICON[o.verdict] ?? '❓'
  const vLabel  = o.verdict.replace('_', ' ')
  const truth   = `${(o.truthScore * 100).toFixed(0)}%`

  const telegram = tgLine(
    `${icon} *New Verdict* — [${o.agentName}](${addrLink(o.agentAddress)})`,
    `Action: \`${o.action}\`   Verdict: *${vLabel}*`,
    `Truth: ${truth}   Score: *${o.score.toFixed(1)}*`,
    `[View on Mantlescan ↗](${txLink(o.txHash)})`,
  )

  const fields: DiscordField[] = [
    { name: 'Action',      value: `\`${o.action}\``,    inline: true  },
    { name: 'Verdict',     value: `**${vLabel}**`,       inline: true  },
    { name: 'Truth score', value: truth,                 inline: true  },
    { name: 'Reputation',  value: `**${o.score.toFixed(1)}**`, inline: true },
    { name: 'Transaction', value: `[${shortHash(o.txHash)}](${txLink(o.txHash)})`, inline: false },
  ]

  return {
    telegram,
    discord: discordPayload({ title: `${icon} New Verdict — ${o.agentName}`, fields }),
  }
}

// ── 2. Caught Lie (FALSE_CLAIM) ───────────────────────────────────────────────

export interface CaughtLieAlertOpts {
  agentName:        string
  agentAddress:     string
  txHash:           string
  claimedAmountOut: string   // human-readable, e.g. "2.40 CTKB"
  actualAmountOut:  string   // e.g. "2.00 CTKB"
  inflatePct:       number   // e.g. 20
  scoreBefore:      number
  scoreAfter:       number
}

export function caughtLieAlert(o: CaughtLieAlertOpts): AlertOutput {
  const telegram = tgLine(
    `🚨 *FALSE CLAIM DETECTED* — [${o.agentName}](${addrLink(o.agentAddress)})`,
    `Claimed output: \`${o.claimedAmountOut}\``,
    `Actual output:  \`${o.actualAmountOut}\` *(+${o.inflatePct}% inflated)*`,
    `Score: ${o.scoreBefore.toFixed(1)} → *${o.scoreAfter.toFixed(1)}* (liar penalty applied)`,
    `[View evidence on Mantlescan ↗](${txLink(o.txHash)})`,
  )

  const fields: DiscordField[] = [
    { name: 'Claimed output', value: `\`${o.claimedAmountOut}\``,                     inline: true  },
    { name: 'Actual output',  value: `\`${o.actualAmountOut}\``,                      inline: true  },
    { name: 'Inflation',      value: `+${o.inflatePct}%`,                              inline: true  },
    { name: 'Score change',   value: `${o.scoreBefore.toFixed(1)} → **${o.scoreAfter.toFixed(1)}**`, inline: false },
    { name: 'Evidence',       value: `[${shortHash(o.txHash)}](${txLink(o.txHash)})`, inline: false },
  ]

  return {
    telegram,
    discord: discordPayload({
      title:       `🚨 FALSE CLAIM — ${o.agentName} caught lying`,
      description: `Agent inflated output by **+${o.inflatePct}%**. Chain state does not match the claim.`,
      fields,
    }),
  }
}

// ── 3. Firewall Block ─────────────────────────────────────────────────────────

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

export interface FirewallAlertOpts {
  agentName:    string
  agentAddress: string
  intent:       string    // e.g. "swap 95% of balance to TOKEN_B in single tx"
  risk:         RiskLevel
  reason:       string    // e.g. "pre-trade sim: balance drain >90%"
}

export function firewallAlert(o: FirewallAlertOpts): AlertOutput {
  const riskIcon = RISK_ICON[o.risk] ?? '🔴'

  const telegram = tgLine(
    `🛡️ *Firewall Block* ${riskIcon} — [${o.agentName}](${addrLink(o.agentAddress)})`,
    `Intent: \`${o.intent}\``,
    `Risk: *${o.risk}*   Reason: ${o.reason}`,
    `Pre-trade simulation aborted. TX not broadcast.`,
  )

  const fields: DiscordField[] = [
    { name: 'Intent', value: `\`${o.intent}\``,              inline: false },
    { name: 'Risk',   value: `${riskIcon} **${o.risk}**`,    inline: true  },
    { name: 'Reason', value: o.reason,                        inline: false },
    { name: 'Action', value: 'TX blocked — not broadcast',   inline: false },
  ]

  return {
    telegram,
    discord: discordPayload({
      title:       `🛡️ Firewall Block — ${o.agentName}`,
      description: `Pre-trade simulation detected a **${o.risk}** risk intent and aborted before broadcast.`,
      fields,
    }),
  }
}

// ── 4. Leaderboard Move ───────────────────────────────────────────────────────

export interface LeaderboardMove {
  agentName:  string
  rankBefore: number
  rankAfter:  number
  score:      number
}

export function leaderboardAlert(moves: LeaderboardMove[]): AlertOutput {
  const lines = moves.map(m => {
    const arrow = m.rankAfter < m.rankBefore ? '⬆️' : '⬇️'
    return `${arrow} *${m.agentName}*: #${m.rankBefore} → #${m.rankAfter}  (${m.score.toFixed(1)})`
  })

  const telegram = tgLine('📊 *Leaderboard Update*', ...lines)

  const fields: DiscordField[] = moves.map(m => {
    const arrow = m.rankAfter < m.rankBefore ? '⬆️' : '⬇️'
    return {
      name:   `${arrow} ${m.agentName}`,
      value:  `#${m.rankBefore} → **#${m.rankAfter}** · score **${m.score.toFixed(1)}**`,
      inline: true,
    }
  })

  return {
    telegram,
    discord: discordPayload({ title: '📊 Leaderboard Update', fields }),
  }
}

// ── 5. Dispute Opened / Resolved ──────────────────────────────────────────────

export type DisputeEventType = 'opened' | 'resolved'

export interface DisputeAlertOpts {
  type:         DisputeEventType
  agentName:    string
  agentAddress: string
  claimIndex:   number
  bond:         string     // e.g. "0.005 MNT"
  outcome?:     string     // only for 'resolved', e.g. "Challenger wins — FALSE_CLAIM confirmed"
  txHash?:      string
}

export function disputeAlert(o: DisputeAlertOpts): AlertOutput {
  const isResolved = o.type === 'resolved'
  const header     = isResolved ? '⚖️ *Dispute Resolved*' : '⚖️ *Dispute Opened*'
  const dTitle     = isResolved ? `⚖️ Dispute Resolved` : `⚖️ Dispute Opened`

  const lines = [
    `${header} — [${o.agentName}](${addrLink(o.agentAddress)})`,
    `Claim #${o.claimIndex}   Bond: \`${o.bond}\``,
  ]
  if (isResolved && o.outcome) lines.push(`Outcome: *${o.outcome}*`)
  if (o.txHash) lines.push(`[View on Mantlescan ↗](${txLink(o.txHash)})`)

  const fields: DiscordField[] = [
    { name: 'Agent',  value: `[${o.agentName}](${addrLink(o.agentAddress)})`, inline: true },
    { name: 'Claim',  value: `#${o.claimIndex}`,                               inline: true },
    { name: 'Bond',   value: o.bond,                                            inline: true },
  ]
  if (isResolved && o.outcome) {
    fields.push({ name: 'Outcome', value: `**${o.outcome}**`, inline: false })
  }
  if (o.txHash) {
    fields.push({ name: 'Transaction', value: `[${shortHash(o.txHash)}](${txLink(o.txHash)})`, inline: false })
  }

  return {
    telegram: tgLine(...lines),
    discord:  discordPayload({ title: `${dTitle} — ${o.agentName}`, fields }),
  }
}
