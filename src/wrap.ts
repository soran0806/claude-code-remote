import { getTextWidth } from '@evenrealities/pretext'

// デバイス側の再折返しを防ぐため、実測幅で保守的に(短めに)行分割する。
// ponytail: 文字単位の詰め込み。英単語は途中で折れるが日本語主体なので許容
export function wrapLines(source: string, maxPx: number): string[] {
  const out: string[] = []
  for (const para of source.split('\n')) {
    if (!para.trim()) { out.push(''); continue }
    let line = ''
    for (const ch of para) {
      if (line && getTextWidth(line + ch) > maxPx) {
        out.push(line)
        line = ch === ' ' ? '' : ch
      } else {
        line += ch
      }
    }
    if (line) out.push(line)
  }
  return out
}

/** 画面幅いっぱいの罫線（会話ターンの区切り用） */
export function separator(maxPx: number): string {
  let s = '─'
  while (getTextWidth(s + '─') <= maxPx) s += '─'
  return s
}
