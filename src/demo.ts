// デモモード。接続先を持っていない人（＝ストアの審査員と、試しに入れてみた人）が
// アプリの全画面を一通り触れるようにするための、通信しない偽データ。
// ponytail: サーバを立てずに動かすための最小限。凝ったシナリオは要らん
import { detectLang } from './i18n'
import { STATUS_ICON as I } from './glyphs'
import type { Session, HistoryEntry, PermissionRequest } from './api'

export const DEMO_BASE = 'demo'

const CWD = '/demo'

interface DemoStrings {
  titles: [string, string, string]
  reply: string
  permDesc: string
  permDetail: string
  sent: string
  ack: string
}

const S: Record<'ja' | 'en' | 'zh', DemoStrings> = {
  ja: {
    titles: ['デモ: 使い方の説明', 'デモ: テストを直す', 'デモ: 依存を更新'],
    reply: [
      'これはデモです。接続先を設定していなくても、アプリの操作をひと通り試せます。',
      '実際に使うときは、自分のPCで even-terminal を動かし、トンネルで外に出したURLを設定画面に入れてください。',
      'ここに黒子（Claude Code）の応答がそのまま表示されます。長い応答は上下スワイプでスクロールできます。行が多いときは右端にスクロールバーが出ます。',
      '一覧に戻るにはダブルタップでメニューを開いてください。音声サーバーを設定していれば、タップで音声返信を録音できます。',
      `一覧の左のアイコンは状態を表します。${I.busy} が実行中、${I.idle} が待機、${I.awaiting} が承認待ちです。`,
    ].join('\n'),
    permDesc: 'コマンドの実行許可を求めています',
    permDetail: 'npm test -- --watch=false',
    sent: 'デモなので実際には送信されません',
    ack: '（デモ応答）受け取りました。実際の環境では、ここに黒子からの返事が届きます。',
  },
  en: {
    titles: ['Demo: how this works', 'Demo: fix failing test', 'Demo: bump dependencies'],
    reply: [
      'This is a demo. You can try every screen without configuring a connection.',
      'To use it for real, run even-terminal on your own PC, expose it through a tunnel, and paste that URL into the setup form.',
      'Responses from Claude Code appear here in full. Swipe up or down to scroll long answers. A scrollbar shows up on the right when there is more than one screen of text.',
      'Double tap to open the menu and go back to the list. If you configured a speech-to-text server, a single tap starts a voice reply.',
      `The icon at the left of each row is the state: ${I.busy} running, ${I.idle} idle, ${I.awaiting} waiting for your approval.`,
    ].join('\n'),
    permDesc: 'Wants permission to run a command',
    permDetail: 'npm test -- --watch=false',
    sent: 'Nothing is actually sent in the demo',
    ack: '(demo reply) Got it. On a real setup, Claude Code answers here.',
  },
  zh: {
    titles: ['演示：使用方法', '演示：修复测试', '演示：更新依赖'],
    reply: [
      '这是演示模式。即使没有配置连接，也可以体验全部界面。',
      '实际使用时，请在自己的电脑上运行 even-terminal，用隧道暴露后把网址填入设置表单。',
      'Claude Code 的完整回复会显示在这里。上下滑动可以滚动较长的内容，超过一屏时右侧会出现滚动条。',
      '双击打开菜单即可返回列表。如果配置了语音识别服务器，轻点一次就能开始语音回复。',
      `列表左侧的图标表示状态：${I.busy} 运行中，${I.idle} 空闲，${I.awaiting} 等待批准。`,
    ].join('\n'),
    permDesc: '请求执行命令的权限',
    permDetail: 'npm test -- --watch=false',
    sent: '演示模式不会真正发送',
    ack: '（演示回复）已收到。在真实环境中，Claude Code 会在这里回答。',
  },
}

const d = S[detectLang()]

// 承認待ちは1回だけ出す。承認/拒否したら解決済みになり、実機と同じ流れをなぞれる
let permissionAnswered = false
const extra: Record<string, HistoryEntry[]> = {}

export function demoSessions(): Session[] {
  const now = new Date().toISOString()
  return [
    { id: 'demo-1', title: d.titles[0], timestamp: now, cwd: CWD, status: 'idle' },
    { id: 'demo-2', title: d.titles[1], timestamp: now, cwd: CWD, status: permissionAnswered ? 'busy' : 'awaiting' },
    { id: 'demo-3', title: d.titles[2], timestamp: now, cwd: CWD, status: 'busy' },
  ]
}

export function demoHistory(id: string): HistoryEntry[] {
  const base: HistoryEntry[] = [
    { role: 'user', text: d.titles[0] },
    { role: 'assistant', text: d.reply },
  ]
  return base.concat(extra[id] ?? [])
}

export function demoPermission(id: string): PermissionRequest | null {
  if (id !== 'demo-2' || permissionAnswered) return null
  return { toolName: 'Bash', description: d.permDesc, detail: d.permDetail }
}

export function demoRespondPermission(): void {
  permissionAnswered = true
}

export function demoSendPrompt(id: string, text: string): string {
  const list = extra[id] ?? (extra[id] = [])
  list.push({ role: 'user', text })
  list.push({ role: 'assistant', text: d.ack })
  return id
}

export const demoSentNotice = d.sent
