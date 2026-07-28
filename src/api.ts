import { cfg } from './config'
import {
  DEMO_BASE, demoSessions, demoHistory, demoPermission, demoRespondPermission, demoSendPrompt,
} from './demo'

/** 接続先を持たない人（審査員・お試し）向けの偽データモード。通信は一切しない */
export function isDemo(): boolean {
  return cfg.apiBase === DEMO_BASE
}

export interface Session {
  id: string
  title: string
  timestamp: string
  cwd: string
  status: string // busy | idle | awaiting
}

export interface HistoryEntry {
  role: string
  text: string
}

export interface PermissionRequest {
  toolName: string
  description: string
  detail: string
}

async function get(path: string): Promise<any> {
  const sep = path.includes('?') ? '&' : '?'
  const res = await fetch(`${cfg.apiBase}${path}${sep}token=${cfg.token}`)
  if (!res.ok) throw new Error(`${res.status} ${path}`)
  return res.json()
}

async function post(path: string, body: unknown): Promise<any> {
  const res = await fetch(`${cfg.apiBase}${path}?token=${cfg.token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${res.status} ${path}`)
  return res.json()
}

export async function listSessions(limit = 8): Promise<Session[]> {
  if (isDemo()) return demoSessions()
  const data = await get(`/api/sessions?provider=claude&limit=${limit}`)
  return data.sessions ?? []
}

export async function fetchHistory(id: string, limit = 20): Promise<HistoryEntry[]> {
  if (isDemo()) return demoHistory(id)
  const data = await get(`/api/sessions/${id}/history?limit=${limit}&provider=claude`)
  return data.history ?? []
}

/** even-terminal起動セッションのみ有効。それ以外は404 → nullを返す */
export async function fetchLiveState(id: string): Promise<string | null> {
  if (isDemo()) return null
  try {
    const data = await get(`/api/status?sessionId=${id}&provider=claude`)
    return data.state ?? null
  } catch {
    return null
  }
}

/** 未応答の承認リクエストを探す（spawnedセッションのみ。permission_resultが後続してたら解決済み） */
export async function fetchPendingPermission(id: string): Promise<PermissionRequest | null> {
  if (isDemo()) return demoPermission(id)
  try {
    const data = await get(`/api/messages?sessionId=${id}&provider=claude`)
    const msgs: any[] = data.messages ?? []
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i]
      if (m.type === 'permission_result') return null
      if (m.type === 'permission_request') {
        return { toolName: m.toolName ?? '?', description: m.description ?? '', detail: m.detail ?? '' }
      }
    }
    return null
  } catch {
    return null
  }
}

export async function respondPermission(id: string, decision: 'allow' | 'allowAlways' | 'deny'): Promise<void> {
  if (isDemo()) return demoRespondPermission()
  await post('/api/permission-response', { sessionId: id, decision, provider: 'claude' })
}

/** cwd必須: even-terminalは復元時にcwdでセッションを探すため、省略するとサーバの
 *  カレント(.even-terminal)が使われ "No conversation found" になる。
 *  稼働中セッションへの送信はフォーク復元になるため、返ってきた新sessionIdを返す */
export async function sendPrompt(id: string, text: string, cwd: string): Promise<string> {
  if (isDemo()) return demoSendPrompt(id, text)
  const data = await post('/api/prompt', { sessionId: id, text, provider: 'claude', cwd })
  return data.sessionId ?? id
}
