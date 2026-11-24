// Claude Code のセッション記録（JSONL）を読んで、グラスに出せる形にする。
import { open, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

const TAIL_BYTES = 768 * 1024

async function readTail(path, bytes = TAIL_BYTES) {
  const fh = await open(path, 'r')
  try {
    const { size } = await fh.stat()
    const start = Math.max(0, size - bytes)
    const buf = Buffer.alloc(size - start)
    await fh.read(buf, 0, buf.length, start)
    let text = buf.toString('utf8')
    if (start > 0) text = text.slice(text.indexOf('\n') + 1) // 途中から始まった1行目は捨てる
    return text
  } finally {
    await fh.close()
  }
}

function parseLines(text) {
  const out = []
  for (const line of text.split('\n')) {
    if (!line) continue
    try { out.push(JSON.parse(line)) } catch { /* 書きかけの行 */ }
  }
  return out
}

const toolLine = b => {
  const i = b.input ?? {}
  const arg = i.command ?? i.file_path ?? i.pattern ?? i.url ?? i.query ?? i.description ?? i.prompt ?? ''
  return `▸ ${b.name}${arg ? ': ' + String(arg).split('\n')[0].slice(0, 80) : ''}`
}

/** 記録の行から会話の項目を作る。tools=true でツール実行を1行に畳んで混ぜる */
export function toHistory(rows, { tools = false } = {}) {
  const out = []
  for (const r of rows) {
    if (r.isSidechain || r.isMeta) continue
    if (r.type !== 'user' && r.type !== 'assistant') continue
    const c = r.message?.content
    if (r.type === 'user') {
      // ツール結果（配列）は会話やないので出さん
      const text = typeof c === 'string' ? c
        : Array.isArray(c) ? c.filter(b => b.type === 'text').map(b => b.text).join('\n') : ''
      if (text.trim() && !text.startsWith('<')) out.push({ role: 'user', text: text.trim(), at: r.timestamp })
      continue
    }
    if (!Array.isArray(c)) continue
    for (const b of c) {
      if (b.type === 'text' && b.text?.trim()) out.push({ role: 'assistant', text: b.text.trim(), at: r.timestamp })
      else if (tools && b.type === 'tool_use') out.push({ role: 'tool', text: toolLine(b), at: r.timestamp })
    }
  }
  return out
}

/** 最後の TodoWrite から進み具合を拾う */
export function todoProgress(rows) {
  for (let i = rows.length - 1; i >= 0; i--) {
    const c = rows[i].message?.content
    if (rows[i].type !== 'assistant' || !Array.isArray(c)) continue
    for (const b of c) {
      if (b.type === 'tool_use' && b.name === 'TodoWrite' && Array.isArray(b.input?.todos)) {
        const todos = b.input.todos
        return { done: todos.filter(t => t.status === 'completed').length, total: todos.length,
          current: todos.find(t => t.status === 'in_progress')?.content ?? '' }
      }
    }
  }
  return null
}

export function titleOf(rows) {
  let title = ''
  for (const r of rows) {
    if (r.type === 'custom-title' && r.customTitle) title = r.customTitle
    else if (r.type === 'ai-title' && r.aiTitle) title = r.aiTitle
    else if (r.type === 'summary' && r.summary && !title) title = r.summary
  }
  return title
}

export async function readSession(path, opts = {}) {
  const rows = parseLines(await readTail(path))
  const history = toHistory(rows, opts)
  const limit = opts.limit ?? 30
  return { history: history.slice(-limit), title: titleOf(rows), todos: todoProgress(rows) }
}

/** 台帳に載ってへん（フック登録前から開いとる／もう閉じた）最近のセッションを記録から探す */
export async function recentTranscripts(limit = 20, root = join(homedir(), '.claude', 'projects')) {
  const found = []
  let dirs = []
  try { dirs = await readdir(root, { withFileTypes: true }) } catch { return [] }
  for (const d of dirs) {
    if (!d.isDirectory()) continue
    let files = []
    try { files = await readdir(join(root, d.name)) } catch { continue }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue
      const p = join(root, d.name, f)
      try { found.push({ id: f.slice(0, -6), path: p, mtime: (await stat(p)).mtimeMs }) } catch { /* 消えた */ }
    }
  }
  return found.sort((a, b) => b.mtime - a.mtime).slice(0, limit)
}
