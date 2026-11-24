import { describe, it, expect } from 'vitest'
import { getAdvW, getTextWidth } from '@evenrealities/pretext'
import { wrapLines, truncatePx, NO_START, NO_END } from '../src/wrap'

const W = 200
const NS = new Set(Array.from(NO_START))
const NE = new Set(Array.from(NO_END))
const first = (s: string) => Array.from(s)[0]
const last = (s: string) => Array.from(s).pop()!

describe('wrapLines', () => {
  const ja = 'ビルドが完了しました。次に、テストを実行して結果を確認します（約3分）。問題がなければ「公開」へ進みます！'
  it('どの行も maxPx を超えない', () => {
    for (const w of [120, 200, 300]) for (const l of wrapLines(ja, w)) expect(getTextWidth(l)).toBeLessThanOrEqual(w)
  })
  it('日本語: 行頭禁則・行末禁則を守る', () => {
    for (const w of [100, 130, 160, 200, 260]) {
      const ls = wrapLines(ja, w)
      for (const l of ls.slice(1)) expect(NS.has(first(l)), `行頭 ${l}`).toBe(false)
      for (const l of ls.slice(0, -1)) expect(NE.has(last(l)), `行末 ${l}`).toBe(false)
    }
  })
  it('英文は収まる単語を途中で割らない', () => {
    const words = 'the quick brown fox jumps over the lazy dog and keeps running far away'.split(' ')
    const ls = wrapLines(words.join(' '), 150)
    expect(ls.length).toBeGreaterThan(1)
    expect(ls.join(' ').split(' ')).toEqual(words)
    for (const l of ls) expect(l).toBe(l.trim())
  })
  it('200文字のURLも幅内に折り返す', () => {
    const url = 'https://example.com/' + 'a1b2c3d4e5/'.repeat(17)
    const ls = wrapLines(url, W)
    expect(ls.length).toBeGreaterThan(1)
    for (const l of ls) expect(getTextWidth(l)).toBeLessThanOrEqual(W)
    expect(ls.join('')).toBe(url)
  })
  it('字形が無い文字は消えず代替される', () => {
    const missing = Array.from({ length: 0x3000 }, (_, i) => 0x2400 + i).map((c) => String.fromCodePoint(c)).find((c) => getAdvW(c.codePointAt(0)!) === 0)
    expect(missing).toBeTruthy()
    const out = wrapLines(`A${missing}B`, W)[0]
    expect(out.length).toBe(3)
    expect(getAdvW(out.codePointAt(1)!)).toBeGreaterThan(0)
  })
  it('半角カナは全角になる', () => {
    expect(wrapLines('ｱｲｳ', W)[0]).toBe('アイウ')
  })
  it('空行は保持される', () => {
    expect(wrapLines('a\n\nb', W)).toEqual(['a', '', 'b'])
  })
})

describe('truncatePx', () => {
  it('収まる題はそのまま', () => {
    expect(truncatePx('abc', W)).toBe('abc')
  })
  it('長い題は幅内に切り詰める', () => {
    const title = '日本語とEnglishが混ざった、とても長いセッションの題名をここに書きます'
    for (const w of [60, 120, 200]) {
      const r = truncatePx(title, w)
      expect(getTextWidth(r)).toBeLessThanOrEqual(w)
      expect(r.length).toBeLessThan(title.length)
    }
  })
})
