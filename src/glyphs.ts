import { getAdvW } from '@evenrealities/pretext'

// G2のフォントに無い文字は「幅0」で描かれる＝画面から黙って消える。
// ⚠(U+26A0) がまさにそれで、承認待ちの目印が空白になっとった。
// 字幅を測って、無ければASCIIの代替に落とす。
export function glyph(ch: string, alt: string): string {
  return getAdvW(ch.codePointAt(0)!) > 0 ? ch : alt
}

export const STATUS_ICON: Record<string, string> = {
  busy: glyph('▶', '>'),
  idle: glyph('・', '-'),
  awaiting: glyph('⚠', '!'),
}
