import { describe, it, expect } from 'vitest'
import { getTextWidth } from '@evenrealities/pretext'
import { ageText, listRow, positionBar, rightAlign } from '../src/layout'

const L = { now: 'now', m: 'm', h: 'h', d: 'd' }
const W = 568
const T0 = Date.parse('2026-10-07T12:00:00Z')
const ago = (ms: number) => new Date(T0 - ms).toISOString()

describe('ageText', () => {
  it('now / 分 / 時間 / 日', () => {
    expect(ageText(ago(20_000), T0, L)).toBe('now')
    expect(ageText(ago(3 * 60_000), T0, L)).toBe('3m')
    expect(ageText(ago(59 * 60_000), T0, L)).toBe('59m')
    expect(ageText(ago(2 * 3600_000 + 5), T0, L)).toBe('2h')
    expect(ageText(ago(5 * 86400_000), T0, L)).toBe('5d')
  })
  it('未来や不正な時刻でも壊れない', () => {
    expect(ageText(ago(-5000), T0, L)).toBe('now')
    expect(ageText('xx', T0, L)).toBe('')
  })
})

describe('listRow', () => {
  const long = '日本語とEnglishが混ざった、とても長いセッションの題名をここに書きます。さらに続きます'
  it('長い題でも幅を超えない', () => {
    for (const title of ['a', long]) expect(getTextWidth(listRow('▶', title, '12h', W))).toBeLessThanOrEqual(W)
  })
  it('経過時間が右端に寄る（幅が空白1つ分以内に収まる）', () => {
    const row = listRow('・', 'short', '3m', W)
    expect(row.endsWith('3m')).toBe(true)
    expect(W - getTextWidth(row)).toBeLessThan(getTextWidth(' '))
  })
  it('状態アイコンで始まる（選択の印は枠が持つ）', () => {
    expect(listRow('・', 'x', 'now', W).startsWith('・ x')).toBe(true)
  })
})

describe('positionBar', () => {
  const clock = '21:05'
  const bar = (top: number, max: number) => positionBar(top, max, clock, W)
  const at = (s: string) => s.indexOf('╋')
  it('収まる時はバー無し・時計は右端', () => {
    const s = bar(0, 0)
    expect(s).not.toContain('╋')
    expect(s.endsWith(clock)).toBe(true)
    expect(getTextWidth(s)).toBeLessThanOrEqual(W)
  })
  it('先頭・中間・末尾で ╋ が動き、幅を超えない', () => {
    const [a, b, c] = [bar(0, 20), bar(10, 20), bar(20, 20)]
    expect(at(a)).toBe(0)
    expect(at(c)).toBeGreaterThan(at(b))
    expect(at(b)).toBeGreaterThan(at(a))
    expect(c.replace(/ \d\d:\d\d$/, '').endsWith('╋')).toBe(true)
    for (const s of [a, b, c]) expect(getTextWidth(s)).toBeLessThanOrEqual(W)
  })
  it('left を付けても幅内', () => {
    expect(getTextWidth(positionBar(5, 20, clock, W, '考え中'))).toBeLessThanOrEqual(W)
    expect(getTextWidth(rightAlign('考え中', clock, W))).toBeLessThanOrEqual(W)
  })
})
