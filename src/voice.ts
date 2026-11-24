import { cfg } from './config'

// SDKノート: audioPcmはUint8Arrayだが、JSON経由でnumber[]やbase64文字列で届く実装もある
export function normalizePcm(raw: unknown): Uint8Array | null {
  if (raw instanceof Uint8Array) return raw
  if (Array.isArray(raw)) return Uint8Array.from(raw)
  if (typeof raw === 'string') {
    try {
      const bin = atob(raw)
      const out = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
      return out
    } catch {
      return null
    }
  }
  return null
}

export class Recorder {
  private chunks: Uint8Array[] = []
  private bytes = 0

  push(chunk: Uint8Array) {
    this.chunks.push(chunk)
    this.bytes += chunk.length
  }

  /** 録音秒数（PCM s16le 16kHz mono = 32000 bytes/sec） */
  seconds(): number {
    return this.bytes / 32000
  }

  concat(): Uint8Array {
    const out = new Uint8Array(this.bytes)
    let off = 0
    for (const c of this.chunks) { out.set(c, off); off += c.length }
    return out
  }

  clear() {
    this.chunks = []
    this.bytes = 0
  }
}

/** PCのターミナルで開いとるclaudeセッションにキー入力として直接注入（フォーク回避）。
 *  ターミナル駆動セッションかどうかの判定はサーバ側（JSONLのentrypoint）でやる */
/** 注入は無理やが /api/prompt に流すとフォークする、という状態。呼び出し側は諦めること */
export class ForkRisk extends Error {}

// STT サーバは外からの要求にトークンを求める（3456 と同じトークン）
const auth = (): Record<string, string> => (cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {})

export async function injectTerminal(sessionId: string, cwd: string, text: string): Promise<void> {
  const res = await fetch(`${cfg.sttBase}/inject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth() },
    body: JSON.stringify({ sessionId, cwd, text }),
  })
  if (res.ok) return
  // 401 で /api/prompt に流すと、稼働中のターミナルならフォークする。認証で弾かれた時は送らずに止める
  if (res.status === 401) throw new ForkRisk('inject 401')
  const body = await res.json().catch(() => ({} as any))
  if (body?.fork_risk) throw new ForkRisk(body.error ?? `inject ${res.status}`)
  throw new Error(`inject ${res.status}`)
}

export async function transcribe(pcm: Uint8Array, signal: AbortSignal): Promise<string> {
  const res = await fetch(`${cfg.sttBase}/transcribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', ...auth() },
    body: new Blob([pcm.buffer as ArrayBuffer]),
    signal,
  })
  if (!res.ok) throw new Error(`STT ${res.status}`)
  const data = await res.json()
  return (data.text ?? '').trim()
}
