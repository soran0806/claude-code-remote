// フックを呼んだプロセスから親をたどって、対話中の Claude Code 本体のプロセスIDを突き止める。
import { execFile } from 'node:child_process'

function run(cmd, args, timeout = 15_000) {
  return new Promise(resolve => {
    execFile(cmd, args, { timeout, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => resolve(err ? '' : stdout))
  })
}

/** 全プロセスの {pid, ppid, name, path, child}。Windows は CIM、他は ps */
export async function processTable() {
  if (process.platform === 'win32') {
    // child: Electron の子プロセス（--type=renderer 等）かどうか。コマンドライン全文は長いので旗だけ取る
    const out = await run('powershell', ['-NoProfile', '-NonInteractive', '-Command',
      'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId)`t$($_.ParentProcessId)`t$($_.Name)`t$($_.ExecutablePath)`t$([int]($_.CommandLine -match \' --type=\'))" }'])
    return parseTable(out, '\t')
  }
  return parseTable(await run('ps', ['-eo', 'pid=,ppid=,comm=']), /\s+/)
}

export function parseTable(out, sep) {
  const rows = []
  const tabbed = sep === '\t'
  for (const line of out.split(/\r?\n/)) {
    const t = tabbed ? line : line.trim()
    if (!t.trim()) continue
    const [pid, ppid, ...rest] = t.split(sep)
    if (!/^\d+$/.test(pid.trim()) || !/^\d+$/.test(ppid)) continue
    rows.push(tabbed
      ? { pid: Number(pid), ppid: Number(ppid), name: (rest[0] ?? '').trim(), path: (rest[1] ?? '').trim(), child: rest[2]?.trim() === '1' }
      : { pid: Number(pid), ppid: Number(ppid), name: rest.join(' ').trim(), path: '', child: false })
  }
  return rows
}

// Claude のデスクトップアプリも実行ファイル名は claude.exe（本体＋Electron の子が十数個）。
// 名前だけで見ると、Claude Code 本体の親であるアプリ本体を取り違える。場所と旗で外す。
const DESKTOP_APP = /[\\/]AnthropicClaude[\\/]|[\\/]WindowsApps[\\/]|\.app[\\/]Contents[\\/]/i
export function isClaudeCli(row) {
  if (!/^claude(\.exe)?$/i.test(row.name.split(/[\\/]/).pop() ?? '')) return false
  if (row.child) return false
  return !DESKTOP_APP.test(row.path ?? '')
}

/** startPid の祖先で最初に見つかる Claude Code 本体。見つからんかったら null */
export function findClaudeAncestor(table, startPid) {
  const byPid = new Map(table.map(r => [r.pid, r]))
  let cur = byPid.get(startPid)
  for (let hops = 0; cur && hops < 12; hops++) {
    if (isClaudeCli(cur)) return cur.pid
    if (!cur.ppid || cur.ppid === cur.pid) break
    cur = byPid.get(cur.ppid)
  }
  return null
}

export async function resolveClaudePid(hookPid) {
  if (!hookPid) return null
  return findClaudeAncestor(await processTable(), hookPid)
}

export function isAlive(pid) {
  try { process.kill(pid, 0); return true } catch (e) { return e?.code === 'EPERM' }
}
