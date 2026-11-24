import { getAdvW, getTextWidth } from '@evenrealities/pretext'
import { glyph } from './glyphs'

// 禁則文字（g2-epub-reader/src/reader/paginate.ts からコピー。importはしない）
export const NO_START = '、。，．・：；？！）〕］｝〉》」』】゛゜ー々ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮ…‥”’,.!?)]}:;'
export const NO_END = '（〔［｛〈《「『【([{“‘'
const NO_START_SET = new Set(Array.from(NO_START, (c) => c.codePointAt(0)!))
const NO_END_SET = new Set(Array.from(NO_END, (c) => c.codePointAt(0)!))

// 半角カナ U+FF61..FF9F → 全角（1コードポイント→1コードポイント）
const HW_KANA = '。「」、・ヲァィゥェォャュョッーアイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン゛゜'
// フォントに無いが近い字がある物（epub側の実測で出た4種＋⋯）
const SUBST = new Map([[0xb4, 0x2019], [0x60, 0x2018], [0x203e, 0xffe3], [0xaf, 0xffe3], [0x22ef, 0x2026]])
// G2のフォントに無い字は幅0で黙って消える。〓が無ければ ? に落とす
const REPL = getAdvW(0x3013) > 0 ? 0x3013 : 0x3f

const mapCp = (cp: number): number => {
  if (cp >= 0xff61 && cp <= 0xff9f) cp = HW_KANA.codePointAt(cp - 0xff61)!
  if (getAdvW(cp) !== 0) return cp
  return SUBST.get(cp) ?? REPL
}

/** 字形が無い文字を代替に置き換える（1コードポイント→1コードポイント）。改行・タブは触らない側で処理 */
export function fixGlyphs(text: string): string {
  return Array.from(text, (ch) => String.fromCodePoint(mapCp(ch.codePointAt(0)!))).join('')
}

// 英単語・パス・URL は1塊（ASCII/Latin の空白以外の連続）。それ以外は1文字ずつ
const TOKEN_RE = /[\x21-ɏ]+| |./gu

// デバイス側の再折返しを防ぐため、実測幅で保守的に(短めに)行分割する。
// ponytail: 禁則は「押し込めるなら押し込む／ダメなら直前1字を道連れ」の1段のみ。ぶら下げ・追い出しの連鎖は見ない
export function wrapLines(source: string, maxPx: number): string[] {
  const out: string[] = []
  const w = (s: string) => getTextWidth(s)
  for (const raw of source.split('\n')) {
    const para = raw.replace(/\r/g, '').replace(/\t/g, ' ')
    if (!para.trim()) { out.push(''); continue }
    let line = ''
    // 改行位置で行を確定。次の字が行頭禁則／直前の字が行末禁則なら末尾1字を次行へ道連れ
    const flush = (next: string): string => {
      const chars = Array.from(line)
      let carry = ''
      if (chars.length > 1 && NO_START_SET.has(next.codePointAt(0)!)) carry = chars.pop()!
      while (chars.length > 1 && NO_END_SET.has(chars[chars.length - 1].codePointAt(0)!)) carry = chars.pop()! + carry
      out.push(chars.join('').trimEnd())
      return carry
    }
    const add = (tok: string): void => {
      if (w(line + tok) <= maxPx) { line += tok; return }
      if (tok === ' ') { if (line) { out.push(line.trimEnd()); line = '' } return } // 折返し位置の空白は捨てる
      if (line) line = flush(tok)
      if (w(line + tok) <= maxPx) { line += tok; return }
      if (Array.from(tok).length > 1) { for (const ch of tok) add(ch); return } // 1行より長い塊は文字単位
      if (line) { out.push(line); line = '' } // 道連れ込みで入らん時は禁則を諦める
      line = tok
    }
    for (const m of fixGlyphs(para).matchAll(TOKEN_RE)) add(m[0])
    if (line.trim()) out.push(line.trimEnd())
  }
  return out
}

/** 実測幅 maxPx に収まるよう切り詰める。切ったら … （字形があれば）を付ける */
export function truncatePx(s: string, maxPx: number): string {
  const t = fixGlyphs(s.replace(/\s+/g, ' '))
  if (getTextWidth(t) <= maxPx) return t
  const ell = glyph('…', '')
  let acc = ''
  for (const ch of t) {
    if (getTextWidth(acc + ch + ell) > maxPx) break
    acc += ch
  }
  return acc + ell
}

/** 画面幅いっぱいの罫線（会話ターンの区切り用） */
export function separator(maxPx: number): string {
  let s = '─'
  while (getTextWidth(s + '─') <= maxPx) s += '─'
  return s
}
