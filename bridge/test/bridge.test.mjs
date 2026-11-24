import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { Registry, permissionOutput, summarizeTool } from '../registry.mjs'
import { toHistory, todoProgress, titleOf, readSession } from '../transcript.mjs'
import { parseTable, findClaudeAncestor, isClaudeCli } from '../procs.mjs'
import { withHooks, withoutHooks, EVENTS } from '../install-hooks.mjs'
import { parseEnv } from '../config.mjs'
import { createBridge } from '../server.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const base = (id, extra = {}) => ({ session_id: id, cwd: 'C:\\proj', transcript_path: '', ...extra })

test('同じフォルダの11セッションが別々のプロセスに結び付く', () => {
  const r = new Registry()
  for (let i = 0; i < 11; i++) {
    r.handleHook('SessionStart', base(`s${i}`))
    r.bindPid(`s${i}`, 1000 + i)
  }
  assert.equal(r.list().length, 11)
  assert.equal(r.get('s7').pid, 1007)
  assert.equal(new Set(r.list().map(s => s.pid)).size, 11)
})

test('/clear で ID が変わったら同じプロセスの古いセッションは消える', () => {
  const r = new Registry()
  r.handleHook('SessionStart', base('old')); r.bindPid('old', 42)
  r.handleHook('SessionStart', base('new')); r.bindPid('new', 42)
  assert.equal(r.get('old'), null)
  assert.equal(r.get('new').pid, 42)
})

test('状態: 送信で busy、Stop で idle、並びは承認待ちが先頭', async () => {
  const r = new Registry()
  r.handleHook('SessionStart', base('a')); r.handleHook('SessionStart', base('b')); r.handleHook('SessionStart', base('c'))
  r.handleHook('UserPromptSubmit', base('b', { prompt: 'やって' }))
  assert.equal(r.get('b').status, 'busy')
  const p = r.handleHook('PermissionRequest', base('c', { tool_name: 'Bash', tool_input: { command: 'rm x' } }))
  assert.deepEqual(r.list().map(s => s.id), ['c', 'b', 'a'])
  r.resolvePermission('c', 'deny'); await p
  r.handleHook('Stop', base('b', { last_assistant_message: 'できた' }))
  assert.equal(r.get('b').status, 'idle')
  assert.equal(r.get('b').lastMessage, 'できた')
})

test('承認: 許可・常に許可・拒否がフックの出力になる', async () => {
  const r = new Registry()
  const sug = [{ type: 'addRules', rules: [{ toolName: 'Bash' }], behavior: 'allow', destination: 'localSettings' }]
  const ask = () => r.handleHook('PermissionRequest', base('s', { tool_name: 'Bash', tool_input: { command: 'npm test', description: 'テスト' }, permission_suggestions: sug }))
  let p = ask()
  assert.equal(r.get('s').status, 'awaiting')
  assert.deepEqual(r.getPending('s').detail, 'npm test')
  assert.equal(r.resolvePermission('s', 'allow'), true)
  assert.deepEqual((await p).hookSpecificOutput.decision, { behavior: 'allow' })
  assert.equal(r.get('s').status, 'busy')
  p = ask(); r.resolvePermission('s', 'allowAlways')
  assert.deepEqual((await p).hookSpecificOutput.decision.updatedPermissions, sug)
  p = ask(); r.resolvePermission('s', 'deny')
  assert.equal((await p).hookSpecificOutput.decision.behavior, 'deny')
  assert.equal(r.resolvePermission('s', 'allow'), false)
})

test('承認: 誰も見とらん時・時間切れは素通し（ターミナルに任せる）', async () => {
  const r = new Registry()
  assert.equal(r.handleHook('PermissionRequest', base('s', { tool_name: 'Bash' }), { hold: false }), null)
  const out = await r.handleHook('PermissionRequest', base('s', { tool_name: 'Bash' }), { waitMs: 20 })
  assert.equal(out, null)
  assert.equal(r.get('s').status, 'awaiting')
  assert.equal(r.getPending('s'), null)
})

test('送信の着弾確認: UserPromptSubmit が来たら true、来んかったら false', async () => {
  const r = new Registry()
  r.handleHook('SessionStart', base('s'))
  const ok = r.expectPrompt('s', '[音声] テストを回して', 500)
  r.handleHook('UserPromptSubmit', base('s', { prompt: '[音声] テストを回して' }))
  assert.equal(await ok, true)
  assert.equal(await r.expectPrompt('s', '届かん文', 20), false)
})

test('死んだプロセスのセッションは掃除される', () => {
  const alive = new Set([1])
  const r = new Registry({ isAlive: p => alive.has(p) })
  r.handleHook('SessionStart', base('a')); r.bindPid('a', 1)
  r.handleHook('SessionStart', base('b')); r.bindPid('b', 2)
  r.sweep()
  assert.deepEqual(r.list().map(s => s.id), ['a'])
})

test('サブエージェントのイベントは親の状態を動かさん', () => {
  const r = new Registry()
  r.handleHook('SessionStart', base('s'))
  r.handleHook('UserPromptSubmit', base('s', { prompt: 'x' }))
  r.handleHook('Stop', base('s', { agent_id: 'sub1' }))
  assert.equal(r.get('s').status, 'busy')
})

test('記録の読み取り: 会話・ツール1行・TODO・題名', () => {
  const rows = [
    { type: 'user', message: { content: 'テストして' } },
    { type: 'user', isMeta: true, message: { content: 'meta' } },
    { type: 'user', message: { content: '<system-reminder>x</system-reminder>' } },
    { type: 'assistant', message: { content: [{ type: 'thinking', thinking: '…' }, { type: 'text', text: '回すで' },
      { type: 'tool_use', name: 'Bash', input: { command: 'npm test\n--x' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'TodoWrite', input: { todos: [
      { content: 'a', status: 'completed' }, { content: 'b', status: 'in_progress' }, { content: 'c', status: 'pending' }] } }] } },
    { type: 'assistant', isSidechain: true, message: { content: [{ type: 'text', text: 'sub' }] } },
    { type: 'ai-title', aiTitle: 'テスト実行' },
  ]
  assert.deepEqual(toHistory(rows).map(h => [h.role, h.text]), [['user', 'テストして'], ['assistant', '回すで']])
  assert.deepEqual(toHistory(rows, { tools: true }).map(h => h.text), ['テストして', '回すで', '▸ Bash: npm test', '▸ TodoWrite'])
  assert.deepEqual(todoProgress(rows), { done: 1, total: 3, current: 'b' })
  assert.equal(titleOf(rows), 'テスト実行')
})

test('プロセスの親たどり: bash と node を挟んでも claude.exe に届く', () => {
  const t = parseTable('10\t1\texplorer.exe\tC:\\Windows\\explorer.exe\t0\r\n20\t10\tWindowsTerminal.exe\t\t0\r\n30\t20\tclaude.exe\tC:\\Users\\a\\.local\\bin\\claude.exe\t0\r\n31\t20\tclaude.exe\tC:\\Users\\a\\.local\\bin\\claude.exe\t0\r\n40\t31\tbash.exe\t\t0\r\n50\t40\tnode.exe\t\t0\r\n', '\t')
  assert.equal(findClaudeAncestor(t, 50), 31)
  assert.equal(findClaudeAncestor(t, 20), null)
  assert.equal(findClaudeAncestor(t, 999), null)
})

test('プロセスの親たどり: デスクトップアプリの claude.exe は Claude Code 本体と取り違えん', () => {
  const app = 'C:\\Users\\a\\AppData\\Local\\AnthropicClaude\\app-6.2\\claude.exe'
  const cli = 'C:\\Users\\a\\AppData\\Roaming\\Claude\\claude-code\\2.1.330\\claude.exe'
  const t = parseTable([
    `100\t1\tclaude.exe\t${app}\t0`, `101\t100\tclaude.exe\t${app}\t1`, `102\t100\tclaude.exe\t${app}\t1`,
    `200\t100\tclaude.exe\t${cli}\t0`, `210\t200\tbash.exe\t\t0`, `220\t210\tnode.exe\t\t0`,
    `300\t100\tnode.exe\t\t0`,
  ].join('\r\n'), '\t')
  assert.deepEqual(t.filter(isClaudeCli).map(r => r.pid), [200])
  assert.equal(findClaudeAncestor(t, 220), 200)
  // アプリ本体の直下で動いたフック（Claude Code を挟まん）は、アプリ本体を掴まん
  assert.equal(findClaudeAncestor(t, 300), null)
  assert.equal(parseTable('  5   1 claude\n', /\s+/)[0].name, 'claude')
})

test('フック登録: 既存の設定を残し、二重登録せず、外せる', () => {
  const mine = { model: 'x', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] } }
  const opt = { node: 'C:\\Program Files\\nodejs\\node.exe', hookPath: 'C:\\a\\bridge\\hook.mjs', permissionWaitSec: 45 }
  const once = withHooks(mine, opt), twice = withHooks(once, opt)
  assert.deepEqual(once, twice)
  assert.equal(once.hooks.Stop.length, 2)
  assert.equal(once.hooks.Stop[0].hooks[0].command, 'echo mine')
  assert.equal(once.hooks.PermissionRequest[0].hooks[0].command, '"C:/Program Files/nodejs/node.exe" "C:/a/bridge/hook.mjs" PermissionRequest')
  assert.equal(once.hooks.PermissionRequest[0].hooks[0].timeout, 60)
  for (const ev of EVENTS) assert.ok(once.hooks[ev])
  assert.deepEqual(withoutHooks(once), mine)
  assert.deepEqual(withoutHooks({ a: 1 }), { a: 1 })
})

test('設定ファイルの読み取り', () => {
  assert.deepEqual(parseEnv('# c\r\nEVEN_TOKEN=a=b\r\n\r\nX = 1 \n'), { EVEN_TOKEN: 'a=b', X: '1' })
  assert.equal(summarizeTool('Edit', { file_path: 'a.ts' }).detail, 'a.ts')
  assert.equal(permissionOutput('allowAlways', { suggestions: [] }).hookSpecificOutput.decision.updatedPermissions, undefined)
})

// ── 通しテスト: 本物の hook.mjs を子プロセスで呼び、HTTP 越しに承認と送信を確かめる ──
function runHook(event, input, env) {
  return new Promise(resolve => {
    const p = spawn(process.execPath, [join(here, '..', 'hook.mjs'), event], { env: { ...process.env, ...env } })
    let out = ''
    p.stdout.on('data', d => { out += d })
    p.on('close', code => resolve({ code, out }))
    p.stdin.end(JSON.stringify(input))
  })
}

test('通し: フック→ブリッジ→アプリAPI', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'bridge-'))
  const transcript = join(dir, 's1.jsonl')
  writeFileSync(transcript, [
    { type: 'user', message: { content: '最初の指示' } },
    { type: 'assistant', message: { content: [{ type: 'text', text: '了解' }] } },
    { type: 'ai-title', aiTitle: '通しテスト' },
  ].map(x => JSON.stringify(x)).join('\n') + '\n')
  const injected = []
  const cfg = { token: 'tok', port: 0, host: '127.0.0.1', sttUrl: 'http://127.0.0.1:1', python: 'python', permissionWaitMs: 5000 }
  let registry
  const bridge = createBridge(cfg, {
    resolvePid: async pid => (pid ? 777 : null), isAlive: () => true, recent: async () => [],
    inject: async (pid, text) => { injected.push([pid, text]); setTimeout(() => registry.handleHook('UserPromptSubmit', { session_id: 's1', prompt: text }), 30) },
  })
  registry = bridge.registry
  await new Promise(r => bridge.server.listen(0, '127.0.0.1', r))
  t.after(() => bridge.server.close())
  const port = bridge.server.address().port
  const envFile = join(dir, 'kuroko.env')
  writeFileSync(envFile, `EVEN_TOKEN=tok\nBRIDGE_PORT=${port}\nPERMISSION_WAIT_SEC=5\n`)
  const env = { KUROKO_ENV: envFile }
  const api = (p, init) => fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' } })
  const input = { session_id: 's1', cwd: dir, transcript_path: transcript }

  assert.equal((await fetch(`http://127.0.0.1:${port}/api/sessions`)).status, 401)

  // SessionStart: 出力は空（UserPromptSubmit や SessionStart の標準出力は Claude の文脈に入ってまうため）
  const start = await runHook('SessionStart', { ...input, source: 'startup' }, env)
  assert.deepEqual(start, { code: 0, out: '' })
  let list = (await (await api('/api/sessions')).json()).sessions
  assert.equal(list.length, 1)
  assert.deepEqual([list[0].id, list[0].pid, list[0].live, list[0].title, list[0].status, list[0].preview], ['s1', 777, true, '通しテスト', 'idle', '了解'])

  const h = await (await api('/api/sessions/s1/history')).json()
  assert.deepEqual(h.history.map(x => x.text), ['最初の指示', '了解'])

  // 送信: プロセス 777 に打ち込み、UserPromptSubmit で着弾確認
  const sent = await api('/api/prompt', { method: 'POST', body: JSON.stringify({ sessionId: 's1', text: 'テスト回して' }) })
  assert.equal(sent.status, 200)
  assert.deepEqual(injected, [[777, 'テスト回して']])
  assert.equal((await api('/api/prompt', { method: 'POST', body: JSON.stringify({ sessionId: 'nope', text: 'x' }) })).status, 409)

  // 承認: フックは待たされ、アプリから許可すると決定が標準出力に出る
  const hook = runHook('PermissionRequest', { ...input, tool_name: 'Bash', tool_input: { command: 'npm test' } }, env)
  let msgs
  for (let i = 0; i < 50; i++) {
    msgs = (await (await api('/api/messages?sessionId=s1')).json()).messages
    if (msgs.length) break
    await new Promise(r => setTimeout(r, 50))
  }
  assert.equal(msgs[0].type, 'permission_request')
  assert.equal(msgs[0].detail, 'npm test')
  // 承認待ちの間は送信を止める（入力が選択画面に食われるため）
  assert.equal((await api('/api/prompt', { method: 'POST', body: JSON.stringify({ sessionId: 's1', text: 'x' }) })).status, 409)
  assert.equal((await api('/api/permission-response', { method: 'POST', body: JSON.stringify({ sessionId: 's1', decision: 'allow' }) })).status, 200)
  const res = await hook
  assert.equal(res.code, 0)
  assert.deepEqual(JSON.parse(res.out).hookSpecificOutput, { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } })

  // ブリッジが落ちとる時: フックは黙って 0 で終わる
  writeFileSync(envFile, 'EVEN_TOKEN=tok\nBRIDGE_PORT=1\n')
  assert.deepEqual(await runHook('PermissionRequest', { ...input, tool_name: 'Bash' }, env), { code: 0, out: '' })
})

test('通し: SSE で変化が即届く', async t => {
  const cfg = { token: 'tok', permissionWaitMs: 1000, sttUrl: '' }
  const bridge = createBridge(cfg, { resolvePid: async () => 5, isAlive: () => true, recent: async () => [] })
  await new Promise(r => bridge.server.listen(0, '127.0.0.1', r))
  t.after(() => { bridge.server.closeAllConnections(); bridge.server.close() })
  const port = bridge.server.address().port
  const res = await fetch(`http://127.0.0.1:${port}/api/events?token=tok`)
  const reader = res.body.getReader()
  await reader.read()
  bridge.registry.handleHook('SessionStart', { session_id: 'z', cwd: '/x' })
  const { value } = await reader.read()
  const ev = JSON.parse(new TextDecoder().decode(value).split('data: ')[1])
  assert.deepEqual([ev.type, ev.sessionId], ['session_start', 'z'])
  await reader.cancel()
})
