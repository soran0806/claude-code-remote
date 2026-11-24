import { getTextWidth } from '@evenrealities/pretext'
import { truncatePx } from './wrap'

// グラスの行レイアウトの純関数。SDK（bridge）に触らんのでテストできる。

export interface AgeLabels { now: string; m: string; h: string; d: string }

/** 経過時間を短く: いま / 3分 / 2時間 / 5日。解釈できん時刻は空 */
export function ageText(iso: string, nowMs: number, L: AgeLabels): string {
  const ms = nowMs - Date.parse(iso)
  if (!Number.isFinite(ms)) return ''
  const min = Math.floor(ms / 60000)
  if (min < 1) return L.now
  if (min < 60) return `${min}${L.m}`
  if (min < 1440) return `${Math.floor(min / 60)}${L.h}`
  return `${Math.floor(min / 1440)}${L.d}`
}

/** left と right の間を空白（実測幅）で埋めて right を右端に寄せる。最低1つは空ける */
export function rightAlign(left: string, right: string, widthPx: number): string {
  const n = Math.max(1, Math.floor((widthPx - getTextWidth(left) - getTextWidth(right)) / getTextWidth(' ')))
  return left + ' '.repeat(n) + right
}

/** 一覧の1行: `▶ 題名 …… 3m`。題名は経過時間と余白を除いた幅で切る。選択の印は枠（main.ts）が持つ */
export function listRow(icon: string, title: string, age: string, widthPx: number): string {
  const prefix = `${icon} `
  const room = widthPx - getTextWidth(prefix) - getTextWidth(age) - 2 * getTextWidth(' ')
  return rightAlign(prefix + truncatePx(title, room), age, widthPx)
}

/** 最下行（読み表示）。╋ が topLine の位置。全部収まる（maxTop<=0）時はバーを出さず時計だけ。
 *  ━ と ─ は 20px（g2-epub-reader の statusLine と同じ形） */
export function positionBar(topLine: number, maxTop: number, clock: string, widthPx: number, left = ''): string {
  if (maxTop <= 0) return rightAlign(left, clock, widthPx)
  const lead = left ? `${left} ` : ''
  const right = ` ${clock}`
  const cells = Math.max(2, Math.floor((widthPx - getTextWidth(lead) - getTextWidth(right)) / 20))
  const at = Math.round((cells - 1) * Math.min(1, Math.max(0, topLine / maxTop)))
  return lead + '━'.repeat(at) + '╋' + '─'.repeat(cells - 1 - at) + right
}
