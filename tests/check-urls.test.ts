import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// @ts-expect-error 型宣言の無い .mjs
import { findOffenders } from '../scripts/check-urls.mjs'

let root = ''
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'chk-'))
  writeFileSync(join(root, 'app.json'), JSON.stringify({ permissions: [{ name: 'network', whitelist: ['https://ko-fi.com'] }] }))
})
afterAll(() => rmSync(root, { recursive: true, force: true }))

const dist = (name: string, js: string) => {
  const d = join(root, name, 'assets')
  mkdirSync(d, { recursive: true })
  writeFileSync(join(d, 'a.js'), js)
  return join(root, name)
}

describe('findOffenders', () => {
  it('許可ホストは通る', () => {
    expect(findOffenders(dist('ok', 'x="https://ko-fi.com/soran"'), join(root, 'app.json'))).toEqual([])
  })
  it('許可外URLは違反になる', () => {
    const bad = findOffenders(dist('ng', 'x="https://evil.example/a";y="https://ko-fi.com/"'), join(root, 'app.json'))
    expect(bad.map((b: { url: string }) => b.url)).toEqual(['https://evil.example/a'])
  })
})
