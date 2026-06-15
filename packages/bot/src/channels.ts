/**
 * channels.ts — thin wrappers for Telegram Bot API and Discord webhook.
 *
 * Both functions read credentials from environment variables and skip
 * gracefully (no throw) when the corresponding vars are absent.
 */
import 'dotenv/config'

const TELEGRAM_API = 'https://api.telegram.org'

// ── Telegram ──────────────────────────────────────────────────────────────────

export async function sendTelegram(text: string): Promise<boolean> {
  const token  = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!token || !chatId) {
    console.log('  [telegram] not configured — skipped')
    return false
  }

  const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      chat_id:                chatId,
      text,
      parse_mode:             'Markdown',
      disable_web_page_preview: true,
    }),
  })
  const data = await res.json() as { ok: boolean; description?: string }
  if (!data.ok) throw new Error(`Telegram API error: ${data.description}`)
  return true
}

// ── Discord ───────────────────────────────────────────────────────────────────

export interface DiscordField {
  name:    string
  value:   string
  inline?: boolean
}

export interface DiscordEmbed {
  title:        string
  description?: string
  color:        number
  fields?:      DiscordField[]
  footer?:      { text: string }
  timestamp?:   string
}

export interface DiscordWebhookPayload {
  username?:   string
  avatar_url?: string
  embeds:      DiscordEmbed[]
}

export async function sendDiscord(payload: DiscordWebhookPayload): Promise<boolean> {
  const url = process.env.DISCORD_WEBHOOK_URL
  if (!url) {
    console.log('  [discord]  not configured — skipped')
    return false
  }

  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  })

  if (res.status === 204) return true   // Discord returns 204 No Content on success
  const body = await res.text()
  throw new Error(`Discord webhook error ${res.status}: ${body}`)
}
