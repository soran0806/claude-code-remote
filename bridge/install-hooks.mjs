#!/usr/bin/env node
// Claude Code のユーザー設定（~/.claude/settings.json）にブリッジ用のフックを足す／外す。
//   node bridge/install-hooks.mjs            登録（何度やっても同じ結果）
//   node bridge/install-hooks.mjs --remove   取り外し
// 書き換える前に settings.json の控えを横に置く。他のフックや設定には触らん。
import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { loadConfig } from './config.mjs'

export const EVENTS = ['SessionStart', 'UserPromptSubmit', 'Stop', 'Notification', 'SessionEnd', 'PermissionRequest']
const MARK = 'bridge/hook.mjs'

// Windows の Claude Code はフックを Git Bash 経由で呼ぶので、\ は / に直して二重引用符で囲む
const sh = s => `"${s.replace(/\\/g, '/')}"`

const isOurs = h => typeof h?.command === 'string' && h.command.replace(/\\/g, '/').includes(MARK)

export function withoutHooks(settings) {
  const out = structuredClone(settings ?? {})
  if (!out.hooks) return out
  for (const ev of Object.keys(out.hooks)) {
    out.hooks[ev] = (out.hooks[ev] ?? [])
      .map(g => ({ ...g, hooks: (g.hooks ?? []).filter(h => !isOurs(h)) }))
      .filter(g => g.hooks.length)
    if (!out.hooks[ev].length) delete out.hooks[ev]
  }
  if (!Object.keys(out.hooks).length) delete out.hooks
  return out
}

export function withHooks(settings, { node, hookPath, permissionWaitSec }) {
  const out = withoutHooks(settings)
  out.hooks ??= {}
  for (const ev of EVENTS) {
    const hook = { type: 'command', command: `${sh(node)} ${sh(hookPath)} ${ev}` }
    // 承認はグラスの返事を待つので長め。他はすぐ返る
    hook.timeout = ev === 'PermissionRequest' ? permissionWaitSec + 15 : 10
    ;(out.hooks[ev] ??= []).push({ hooks: [hook] })
  }
  return out
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = join(homedir(), '.claude', 'settings.json')
  const remove = process.argv.includes('--remove')
  let settings = {}
  if (existsSync(file)) {
    const raw = readFileSync(file, 'utf8')
    try { settings = JSON.parse(raw) } catch {
      console.error(`${file} が JSON として読めん。壊さんように何もせず終わる`)
      process.exit(1)
    }
    const bak = `${file}.kuroko-bak-${new Date().toISOString().replace(/[:.]/g, '-')}`
    copyFileSync(file, bak)
    console.log(`控え: ${bak}`)
  } else {
    mkdirSync(dirname(file), { recursive: true })
  }
  const cfg = loadConfig()
  const next = remove ? withoutHooks(settings) : withHooks(settings, {
    node: process.execPath,
    hookPath: join(dirname(fileURLToPath(import.meta.url)), 'hook.mjs'),
    permissionWaitSec: Math.round(cfg.permissionWaitMs / 1000),
  })
  writeFileSync(file, JSON.stringify(next, null, 2) + '\n', 'utf8')
  console.log(remove ? 'フックを外した' : `フックを登録した（${EVENTS.join(', ')}）`)
  console.log('開いとる Claude Code は、開き直すか /hooks で確認してから有効になる')
}
