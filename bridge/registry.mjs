// セッション台帳。フックの通知を受けて「どのセッションが・どのプロセスで・今どんな状態か」を持つ。
// 純粋なデータ構造だけ（通信もファイルも触らん）。テストはここを叩く。
import { EventEmitter } from 'node:events'

/** 承認待ちをグラスに出して待つ上限。過ぎたらターミナル側の普通の確認に任せる */
export const DEFAULT_PERMISSION_WAIT_MS = 45_000

export class Registry extends EventEmitter {
  constructor({ now = () => Date.now(), isAlive = () => true } = {}) {
    super()
    this.setMaxListeners(0)
    this.now = now
    this.isAlive = isAlive
    /** @type {Map<string, any>} sessionId -> session */
    this.sessions = new Map()
    /** @type {Map<string, {resolve: Function, timer: any, request: any}>} sessionId -> 承認待ち */
    this.pending = new Map()
    /** @type {Map<string, Array<{text: string, resolve: Function, timer: any}>>} 着弾待ちの送信 */
    this.awaitingPrompt = new Map()
    this.seq = 0
  }

  #publish(type, session, extra = {}) {
    const ev = { seq: ++this.seq, type, sessionId: session?.id, at: this.now(), ...extra }
    this.emit('event', ev)
    return ev
  }

  #touch(input) {
    const id = input.session_id
    let s = this.sessions.get(id)
    if (!s) {
      s = { id, pid: null, cwd: input.cwd ?? '', transcript: input.transcript_path ?? '', title: '',
        status: 'idle', model: '', permissionMode: '', startedAt: this.now(), updatedAt: this.now(), lastMessage: '' }
      this.sessions.set(id, s)
    }
    if (input.cwd) s.cwd = input.cwd
    if (input.transcript_path) s.transcript = input.transcript_path
    if (input.session_title) s.title = input.session_title
    if (input.permission_mode) s.permissionMode = input.permission_mode
    if (input.model) s.model = input.model
    s.updatedAt = this.now()
    return s
  }

  /** 1プロセス＝今のセッション1個。/clear や resume で ID が変わったら古い方を消す */
  bindPid(sessionId, pid) {
    if (!pid) return
    for (const [id, s] of this.sessions) {
      if (id !== sessionId && s.pid === pid) { this.#drop(id, 'replaced') }
    }
    const s = this.sessions.get(sessionId)
    if (s) s.pid = pid
  }

  #drop(id, reason) {
    const s = this.sessions.get(id)
    if (!s) return
    this.resolvePermission(id, null)
    this.sessions.delete(id)
    this.#publish('session_end', s, { reason })
  }

  needsPid(sessionId) {
    const s = this.sessions.get(sessionId)
    return !s || !s.pid
  }

  /**
   * フック1回分を反映する。PermissionRequest だけは Promise を返し、決定（または時間切れ）で解決する。
   * 戻り値: フックの標準出力に書く JSON（無ければ null＝素通し）
   */
  handleHook(event, input, { waitMs = DEFAULT_PERMISSION_WAIT_MS, hold = true } = {}) {
    if (!input?.session_id) return null
    // サブエージェント内のイベントは親セッションの状態を動かさん（承認だけは通す）
    if (input.agent_id && event !== 'PermissionRequest') return null
    const s = this.#touch(input)
    switch (event) {
      case 'SessionStart':
        s.status = 'idle'
        this.#publish('session_start', s, { source: input.source })
        return null
      case 'UserPromptSubmit': {
        s.status = 'busy'
        s.lastPrompt = String(input.prompt ?? '').slice(0, 200)
        this.#confirmPrompt(s.id, String(input.prompt ?? ''))
        this.#publish('status', s, { status: s.status })
        return null
      }
      case 'Stop':
        s.status = 'idle'
        if (input.last_assistant_message) s.lastMessage = String(input.last_assistant_message).slice(0, 400)
        this.resolvePermission(s.id, null)
        this.#publish('status', s, { status: s.status, done: true })
        return null
      case 'Notification':
        // 入力待ち・承認待ちの通知。承認は PermissionRequest で扱うので、ここは状態だけ
        if (input.notification_type === 'idle_prompt') { s.status = 'idle' }
        this.#publish('notification', s, { message: String(input.message ?? '').slice(0, 200), kind: input.notification_type })
        return null
      case 'SessionEnd':
        this.#drop(s.id, input.reason ?? 'end')
        return null
      case 'PermissionRequest':
        return this.#permission(s, input, waitMs, hold)
      default:
        return null
    }
  }

  #permission(s, input, waitMs, hold) {
    // 誰も見とらん時は握らん。ターミナルの確認がそのまま出る
    if (!hold || waitMs <= 0) return null
    this.resolvePermission(s.id, null) // 前のが残っとったら素通しで手放す
    const request = {
      toolName: input.tool_name ?? '?',
      input: input.tool_input ?? {},
      suggestions: input.permission_suggestions ?? [],
      askedAt: this.now(),
    }
    s.status = 'awaiting'
    return new Promise(resolve => {
      const finish = decision => {
        clearTimeout(entry.timer)
        if (this.pending.get(s.id) === entry) this.pending.delete(s.id)
        // 素通しにした後はターミナル側の確認が出とるはずなので「承認待ち」のまま。記録が進んだら server 側が busy に戻す
        if (s.status === 'awaiting') { s.status = decision ? 'busy' : 'awaiting'; s.awaitingSince = this.now() }
        this.#publish('permission_result', s, { decision: decision ?? 'passthrough' })
        resolve(decision ? permissionOutput(decision, request) : null)
      }
      const entry = { resolve: finish, request, timer: setTimeout(() => finish(null), waitMs) }
      this.pending.set(s.id, entry)
      this.#publish('permission_request', s, { toolName: request.toolName, summary: summarizeTool(request.toolName, request.input) })
    })
  }

  /** decision: 'allow' | 'allowAlways' | 'deny' | null(素通し)。待ちが無ければ false */
  resolvePermission(sessionId, decision) {
    const entry = this.pending.get(sessionId)
    if (!entry) return false
    entry.resolve(decision)
    return true
  }

  getPending(sessionId) {
    const e = this.pending.get(sessionId)
    if (!e) return null
    const sum = summarizeTool(e.request.toolName, e.request.input)
    return { toolName: e.request.toolName, description: sum.description, detail: sum.detail, askedAt: e.request.askedAt }
  }

  /** ターミナルへ打ち込んだ文が UserPromptSubmit として現れるのを待つ。着弾したら true */
  expectPrompt(sessionId, text, timeoutMs = 10_000) {
    return new Promise(resolve => {
      const list = this.awaitingPrompt.get(sessionId) ?? []
      const entry = { text, resolve, timer: setTimeout(() => { remove(); resolve(false) }, timeoutMs) }
      const remove = () => {
        const l = this.awaitingPrompt.get(sessionId) ?? []
        const i = l.indexOf(entry)
        if (i >= 0) l.splice(i, 1)
      }
      list.push(entry)
      this.awaitingPrompt.set(sessionId, list)
    })
  }

  #confirmPrompt(sessionId, prompt) {
    const list = this.awaitingPrompt.get(sessionId)
    if (!list?.length) return
    const norm = s => s.replace(/\s+/g, ' ').trim()
    const p = norm(prompt)
    const i = list.findIndex(e => p.includes(norm(e.text).slice(0, 20)))
    if (i < 0) return
    const [e] = list.splice(i, 1)
    clearTimeout(e.timer)
    e.resolve(true)
  }

  /** 死んだプロセスのセッションを掃除する */
  sweep() {
    for (const [id, s] of this.sessions) {
      if (s.pid && !this.isAlive(s.pid)) this.#drop(id, 'process-exit')
    }
  }

  list() {
    const rank = { awaiting: 0, busy: 1, idle: 2 }
    return [...this.sessions.values()].sort((a, b) =>
      (rank[a.status] ?? 3) - (rank[b.status] ?? 3) || b.updatedAt - a.updatedAt)
  }

  get(id) { return this.sessions.get(id) ?? null }
}

/** 承認画面に出す1行の説明と詳細 */
export function summarizeTool(toolName, input = {}) {
  const i = input && typeof input === 'object' ? input : {}
  const first = v => String(v ?? '').split('\n')[0]
  if (toolName === 'Bash') return { description: first(i.description) || 'Bash', detail: String(i.command ?? '') }
  if (toolName === 'Edit' || toolName === 'Write' || toolName === 'NotebookEdit' || toolName === 'Read')
    return { description: `${toolName}`, detail: String(i.file_path ?? i.notebook_path ?? '') }
  if (toolName === 'WebFetch') return { description: 'WebFetch', detail: String(i.url ?? '') }
  if (toolName === 'WebSearch') return { description: 'WebSearch', detail: String(i.query ?? '') }
  let detail = ''
  try { detail = JSON.stringify(i) } catch { detail = '' }
  return { description: toolName, detail: detail === '{}' ? '' : detail.slice(0, 400) }
}

/** Claude Code の PermissionRequest フックが読む出力 */
export function permissionOutput(decision, request) {
  if (decision === 'deny') {
    return { hookSpecificOutput: { hookEventName: 'PermissionRequest',
      decision: { behavior: 'deny', message: 'グラスから拒否されました' } } }
  }
  const allow = { behavior: 'allow' }
  // 「常に許可」は Claude Code 自身が提案してきた許可ルールをそのまま採用する（自前でルールは作らん）
  if (decision === 'allowAlways' && request?.suggestions?.length) allow.updatedPermissions = request.suggestions
  return { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: allow } }
}
