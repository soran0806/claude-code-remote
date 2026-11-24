#!/usr/bin/env node
// Claude Code Remote ブリッジ。グラスのアプリと、PCで開いとる Claude Code の間に立つ。
//   - ターミナルの Claude Code はフック（hook.mjs）でここに状態を知らせてくる
//   - グラスのアプリは /api/* を呼ぶ。変化は /api/events（SSE）で即座に流す
// 依存パッケージ無し。`node bridge/server.mjs` で動く。
import http from 'node:http'
import { stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Registry } from './registry.mjs'
import { loadConfig, ENV_FILE } from './config.mjs'
import { readSession, recentTranscripts } from './transcript.mjs'
import { resolveClaudePid, isAlive } from './procs.mjs'
import { injectText } from './inject.mjs'

const PRESENCE_MS = 20_000

export function createBridge(cfg, deps = {}) {
  const resolvePid = deps.resolvePid ?? resolveClaudePid
  const inject = deps.inject ?? ((pid, text) => injectText(pid, text, { python: cfg.python }))
  const registry = deps.registry ?? new Registry({ isAlive: deps.isAlive ?? isAlive })
  const sse = new Set()
  let lastSeen = 0
  const present = () => sse.size > 0 || Date.now() - lastSeen < PRESENCE_MS

  registry.on('event', ev => {
    const data = `id: ${ev.seq}\ndata: ${JSON.stringify(ev)}\n\n`
    for (const c of sse) {
      if (c.sessionId && ev.sessionId && c.sessionId !== ev.sessionId) continue
      try { c.res.write(data) } catch { sse.delete(c) }
    }
  })

  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  }
  const json = (res, code, body) => {
    const s = JSON.stringify(body)
    res.writeHead(code, { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(s) })
    res.end(s)
  }
  const readBody = (req, limit = 32 * 1024 * 1024) => new Promise((resolve, reject) => {
    const chunks = []
    let n = 0
    req.on('data', c => { n += c.length; if (n > limit) { reject(new Error('too large')); req.destroy() } else chunks.push(c) })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
  const readJson = async req => { try { return JSON.parse((await readBody(req)).toString('utf8') || '{}') } catch { return {} } }

  const authed = (req, url) => {
    const h = req.headers.authorization
    const given = h?.startsWith('Bearer ') ? h.slice(7) : url.searchParams.get('token')
    return !!cfg.token && given === cfg.token
  }

  // 記録ファイルの読み取りは更新時刻でキャッシュする（一覧のたびに11本読み直さん）
  const cache = new Map()
  async function sessionInfo(path, opts) {
    if (!path) return { history: [], title: '', todos: null }
    const key = `${path}|${opts.tools ? 1 : 0}|${opts.limit}`
    try {
      const { mtimeMs } = await stat(path)
      const hit = cache.get(key)
      if (hit && hit.mtimeMs === mtimeMs) return hit.value
      const value = { ...(await readSession(path, opts)), mtimeMs }
      cache.set(key, { mtimeMs, value })
      if (cache.size > 200) cache.delete(cache.keys().next().value)
      return value
    } catch {
      return { history: [], title: '', todos: null }
    }
  }

  async function listSessions(limit) {
    registry.sweep()
    const out = []
    for (const s of registry.list()) {
      const info = await sessionInfo(s.transcript, { limit: 4 })
      // 素通しにした承認は、記録が進んだら片付いたとみなす
      if (s.status === 'awaiting' && !registry.pending.has(s.id) && info.mtimeMs > (s.awaitingSince ?? 0) + 2000) s.status = 'busy'
      const last = info.history.at(-1)
      out.push({
        id: s.id, live: true, status: s.status, cwd: s.cwd, pid: s.pid,
        title: s.title || info.title || s.lastPrompt || basename(s.cwd) || s.id.slice(0, 8),
        timestamp: new Date(Math.max(s.updatedAt, info.mtimeMs ?? 0)).toISOString(),
        preview: (last?.text ?? s.lastMessage ?? '').split('\n')[0].slice(0, 80),
        todos: info.todos, model: s.model, permissionMode: s.permissionMode,
      })
    }
    if (out.length < limit) {
      const live = new Set(out.map(s => s.id))
      for (const t of await (deps.recent ?? recentTranscripts)(limit)) {
        if (out.length >= limit) break
        if (live.has(t.id)) continue
        const info = await sessionInfo(t.path, { limit: 4 })
        if (!info.history.length) continue
        out.push({ id: t.id, live: false, status: 'idle', cwd: '', pid: null,
          title: info.title || info.history.find(h => h.role === 'user')?.text.slice(0, 60) || t.id.slice(0, 8),
          timestamp: new Date(t.mtime).toISOString(), preview: info.history.at(-1).text.split('\n')[0].slice(0, 80),
          todos: info.todos, path: t.path })
      }
    }
    return out
  }

  async function transcriptPath(id) {
    const s = registry.get(id)
    if (s?.transcript) return s.transcript
    const t = (await (deps.recent ?? recentTranscripts)(200)).find(x => x.id === id)
    return t?.path ?? ''
  }

  /** ターミナルの Claude Code に文を届け、実際にプロンプトとして受け取られたかまで確かめる */
  async function send(sessionId, text) {
    const s = registry.get(sessionId)
    if (!s) return { code: 409, body: { error: 'このセッションは今ターミナルで開かれてへん', reason: 'not-live', fork_risk: true } }
    if (!s.pid || !(deps.isAlive ?? isAlive)(s.pid)) return { code: 409, body: { error: 'ターミナルのプロセスが見つからん', reason: 'no-process', fork_risk: true } }
    if (registry.pending.has(sessionId) || s.status === 'awaiting')
      return { code: 409, body: { error: '承認待ちの間は送れん（入力が選択画面に食われる）', reason: 'awaiting', fork_risk: true } }
    const landed = registry.expectPrompt(sessionId, text)
    try {
      await inject(s.pid, text)
    } catch (e) {
      return { code: 500, body: { error: String(e?.message ?? e), reason: 'inject-failed', fork_risk: true } }
    }
    if (await landed) return { code: 200, body: { ok: true, sessionId, pid: s.pid, via: 'inject' } }
    return { code: 409, body: { error: '打ち込んだが受け取られんかった（選択画面が出とる可能性）', reason: 'not-landed', fork_risk: true } }
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://x')
    const path = url.pathname
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end() }
    if (path === '/api/health' && req.method === 'GET') return json(res, 200, { ok: true, name: 'claude-code-remote-bridge', version: 1 })
    if (!authed(req, url)) return json(res, 401, { error: 'Unauthorized' })

    // ── フック（PC内の hook.mjs から） ──
    if (path === '/hook' && req.method === 'POST') {
      const { event, input, pid } = await readJson(req)
      if (input?.session_id && registry.needsPid(input.session_id) && event !== 'SessionEnd') {
        // このフックを呼んだプロセスの親をたどる。フックが生きとる今しか分からんので、返事の前にやる
        const claudePid = await resolvePid(pid).catch(() => null)
        const out = registry.handleHook(event, input, { waitMs: cfg.permissionWaitMs, hold: present() })
        registry.bindPid(input.session_id, claudePid)
        return finishHook(res, out)
      }
      return finishHook(res, registry.handleHook(event, input, { waitMs: cfg.permissionWaitMs, hold: present() }))
    }

    lastSeen = Date.now()

    if (path === '/api/events' && req.method === 'GET') {
      res.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' })
      res.write(':ok\n\n')
      const client = { res, sessionId: url.searchParams.get('sessionId') }
      sse.add(client)
      const beat = setInterval(() => { try { res.write(':hb\n\n') } catch { /* close で片付く */ } }, 15_000)
      req.on('close', () => { clearInterval(beat); sse.delete(client) })
      return
    }
    if (path === '/api/sessions' && req.method === 'GET') {
      const limit = Math.min(Number(url.searchParams.get('limit')) || 12, 50)
      return json(res, 200, { sessions: await listSessions(limit) })
    }
    const hist = path.match(/^\/api\/sessions\/([^/]+)\/history$/)
    if (hist && req.method === 'GET') {
      const limit = Math.min(Number(url.searchParams.get('limit')) || 20, 100)
      const info = await sessionInfo(await transcriptPath(hist[1]), { limit, tools: url.searchParams.get('tools') === '1' })
      return json(res, 200, { history: info.history, todos: info.todos, title: info.title })
    }
    if (path === '/api/status' && req.method === 'GET') {
      const s = registry.get(url.searchParams.get('sessionId') ?? '')
      return s ? json(res, 200, { state: s.status, sessionId: s.id }) : json(res, 404, { error: 'Session not found' })
    }
    // 旧アプリ互換: 承認待ちを messages の形で返す
    if (path === '/api/messages' && req.method === 'GET') {
      const id = url.searchParams.get('sessionId') ?? ''
      const p = registry.getPending(id)
      return json(res, 200, { messages: p ? [{ id: 1, type: 'permission_request', ...p }] : [], state: registry.get(id)?.status ?? 'idle', sessionId: id })
    }
    if (path === '/api/permission-response' && req.method === 'POST') {
      const { sessionId, decision } = await readJson(req)
      if (!['allow', 'allowAlways', 'deny'].includes(decision)) return json(res, 400, { error: 'decision は allow / allowAlways / deny' })
      return registry.resolvePermission(sessionId, decision)
        ? json(res, 200, { ok: true })
        : json(res, 400, { error: '承認待ちが無い（もう決まったか、時間切れでターミナルに戻った）' })
    }
    if ((path === '/api/prompt' || path === '/inject') && req.method === 'POST') {
      const { sessionId, text } = await readJson(req)
      if (!text || typeof text !== 'string' || !text.trim()) return json(res, 400, { error: 'text required' })
      if (!sessionId) return json(res, 400, { error: 'sessionId required' })
      const r = await send(sessionId, text.trim())
      return json(res, r.code, r.body)
    }
    // 音声認識は今までの STT サーバにそのまま流す（アプリの接続先を1つにするため）
    if (path === '/transcribe' && req.method === 'POST') {
      try {
        const body = await readBody(req)
        const r = await fetch(`${cfg.sttUrl}/transcribe`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body, signal: AbortSignal.timeout(60_000) })
        return json(res, r.status, await r.json().catch(() => ({ error: 'bad STT response' })))
      } catch (e) {
        return json(res, 502, { error: `音声認識サーバに繋がらん: ${e?.message ?? e}` })
      }
    }
    return json(res, 404, { error: 'not found' })
  }

  function finishHook(res, out) {
    Promise.resolve(out).then(o => {
      if (!o) { res.writeHead(204); return res.end() }
      json(res, 200, o)
    })
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch(e => { try { json(res, 500, { error: String(e?.message ?? e) }) } catch { res.destroy() } })
  })
  const sweeper = setInterval(() => registry.sweep(), 30_000)
  sweeper.unref()
  server.on('close', () => clearInterval(sweeper))
  return { server, registry }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cfg = loadConfig()
  if (!cfg.token) {
    console.error(`EVEN_TOKEN が無い。${ENV_FILE} に書いてから起動してな`)
    process.exit(1)
  }
  const { server } = createBridge(cfg)
  server.on('error', e => { console.error(`起動できん: ${e.message}`); process.exit(1) })
  server.listen(cfg.port, cfg.host, () => console.log(`[bridge] listening ${cfg.host}:${cfg.port}`))
}
