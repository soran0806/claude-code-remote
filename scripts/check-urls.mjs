// dist/**/*.{js,css,html} の http(s):// 文字列のホストが app.json の network.whitelist に無ければ失敗する。依存なし
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const URL_RE = /https?:\/\/[^\s"'`<>)\\]+/g

function* walk(dir) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) yield* walk(p)
    else if (/\.(js|css|html)$/.test(n)) yield p
  }
}

/** 戻り値: 許可外の { file, url }[] */
export function findOffenders(distDir, appJsonPath) {
  const app = JSON.parse(readFileSync(appJsonPath, 'utf8'))
  const hosts = new Set()
  for (const p of app.permissions ?? []) for (const w of p.whitelist ?? []) hosts.add(new URL(w).host)
  const bad = []
  for (const file of walk(distDir)) {
    for (const m of readFileSync(file, 'utf8').matchAll(URL_RE)) {
      let host = ''
      try { host = new URL(m[0]).host } catch { /* 解析できない文字列も違反として出す */ }
      if (!hosts.has(host)) bad.push({ file, url: m[0] })
    }
  }
  return bad
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const bad = findOffenders(process.argv[2] ?? 'dist', process.argv[3] ?? 'app.json')
  for (const b of bad) console.error(`${b.file}: ${b.url}`)
  console.log(bad.length ? `check:urls FAILED (${bad.length})` : 'check:urls OK')
  process.exit(bad.length ? 1 : 0)
}
