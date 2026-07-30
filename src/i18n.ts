// 画面に出る文字を1か所に集める。HUDは576pxで折り返しも自前なので、
// 各言語とも「短く」を優先する（英語は特に長くなりやすい）。
// ponytail: 辞書は素のオブジェクト。i18nライブラリは3言語・数十語には過剰

export type Lang = 'ja' | 'en' | 'zh'

export function detectLang(): Lang {
  const l = (navigator.language || 'en').toLowerCase()
  if (l.startsWith('ja')) return 'ja'
  if (l.startsWith('zh')) return 'zh'
  return 'en'
}

interface Strings {
  // 一覧・詳細
  loading: string
  empty: string
  noSessions: string
  noHistory: string
  connError: string
  thinking: string
  // 承認
  approve: string
  approveAlways: string
  deny: string
  awaiting: string
  permExpired: string
  // メニュー・確認
  backToList: string
  cancel: string
  send: string
  retake: string
  quit: string
  // 録音
  recording: (sec: number) => string
  micWarmup: string
  tapWhenDone: string
  transcribing: string
  notRecognized: string
  voiceOff: string
  // 凡例
  hintList: string
  hintView: string
  hintViewNoVoice: string
  hintChoose: string
  hintRecord: string
  // オンボーディング（グラス側）
  setupGlasses: string
  // オンボーディング（スマホ側）
  setupTitle: string
  setupLead: string
  stepsTitle: string
  steps: string[]
  fieldApi: string
  fieldToken: string
  fieldStt: string
  fieldSttNote: string
  optional: string
  save: string
  errRequired: string
  errScheme: string
  tryDemo: string
  tryDemoNote: string
  sendBlocked: string
  helpTitle: string
  helpBody: string
  feedback: string
  donate: string
  // 音声送信時に付ける前置き
  voicePrefix: string
}

const ja: Strings = {
  loading: '(読込中)',
  empty: '(空)',
  noSessions: 'セッションなし',
  noHistory: '(履歴なし)',
  connError: '接続エラー',
  thinking: '考え中',
  approve: '許可',
  approveAlways: '常に許可',
  deny: '拒否',
  awaiting: '承認待ち',
  permExpired: '承認は期限切れ/処理済み',
  backToList: '一覧に戻る',
  cancel: 'キャンセル',
  send: '送信',
  retake: '録り直し',
  quit: 'やめる',
  recording: s => `🎤 録音中 ${s}秒`,
  micWarmup: 'マイク起動中…',
  tapWhenDone: '話し終わったらタップ',
  transcribing: '変換中…',
  notRecognized: '(認識できず)',
  voiceOff: '音声返信は未設定',
  hintList: 'タップ:開く スワイプ:選択 ダブル:終了',
  hintView: 'タップ:🎤返信 スワイプ:移動 ダブル:メニュー',
  hintViewNoVoice: 'スワイプ:移動 ダブル:メニュー',
  hintChoose: 'タップ:決定 スワイプ:選択 ダブル:戻る',
  hintRecord: 'タップ:変換へ ダブル:中止',
  setupGlasses: 'はじめに\n\nスマホ画面で接続設定を\n入力してください',
  setupTitle: 'Claude Code Remote 初期設定',
  setupLead: '自分のPCで動いているClaude Codeに接続します。まだ準備ができていない場合は、下の「使い方」を先に読んでください。',
  stepsTitle: '使い方',
  steps: [
    'PCに even-terminal を入れて起動する（ポート3456、起動時に -t でトークンを決める）',
    'そのポートをトンネルで外に出す。例: tailscale funnel 3456',
    '出てきた https:// のURLとトークンを下の欄に入れる',
    '音声で返信したい場合だけ、STTサーバー（ポート3458）も同じようにトンネルで出してURLを入れる',
  ],
  fieldApi: '接続先URL',
  fieldToken: 'トークン',
  fieldStt: '音声サーバーURL',
  fieldSttNote: '空欄でも使えます（音声返信だけが無効になります）',
  optional: '任意',
  save: '保存して起動',
  errRequired: '接続先URLとトークンは必須です',
  errScheme: 'URLは https:// で始めてください（http:// は開発用サイドロード時のみ有効）',
  sendBlocked: '送信できず（ターミナル複数）',
  tryDemo: 'まずデモを試す',
  tryDemoNote: '接続先が無くても、偽のデータで全画面を操作できます。設定はあとから変更できます。',
  helpTitle: 'うまく繋がらないとき',
  helpBody: 'アプリが接続できるのは Tailscale / Cloudflare / ngrok / localtunnel のURLだけです。自宅LANのIPアドレスや http:// のURLはブロックされます。',
  feedback: '不具合の報告・要望',
  donate: '開発を応援する（コーヒーを奢る）',
  voicePrefix: '（G2音声入力・誤変換は文脈補正・返答は簡潔に）',
}

const en: Strings = {
  loading: '(loading)',
  empty: '(empty)',
  noSessions: 'No sessions',
  noHistory: '(no history)',
  connError: 'Connection error',
  thinking: 'Thinking',
  approve: 'Allow',
  approveAlways: 'Always allow',
  deny: 'Deny',
  awaiting: 'Needs approval',
  permExpired: 'Request expired or handled',
  backToList: 'Back to list',
  cancel: 'Cancel',
  send: 'Send',
  retake: 'Record again',
  quit: 'Discard',
  recording: s => `🎤 Recording ${s}s`,
  micWarmup: 'Starting mic…',
  tapWhenDone: 'Tap when you finish',
  transcribing: 'Transcribing…',
  notRecognized: '(not recognized)',
  voiceOff: 'Voice reply not set up',
  hintList: 'Tap:open Swipe:select Double:exit',
  hintView: 'Tap:🎤reply Swipe:scroll Double:menu',
  hintViewNoVoice: 'Swipe:scroll Double:menu',
  hintChoose: 'Tap:confirm Swipe:select Double:back',
  hintRecord: 'Tap:transcribe Double:cancel',
  setupGlasses: 'Welcome\n\nFinish the setup\non your phone screen',
  setupTitle: 'Claude Code Remote - Setup',
  setupLead: 'Connects to Claude Code running on your own PC. If you have not set that up yet, read "How to set up" below first.',
  stepsTitle: 'How to set up',
  steps: [
    'Install and start even-terminal on your PC (port 3456; pick a token with -t)',
    'Expose that port through a tunnel. Example: tailscale funnel 3456',
    'Paste the resulting https:// URL and your token below',
    'Only if you want voice replies: expose the STT server (port 3458) the same way and paste its URL',
  ],
  fieldApi: 'Server URL',
  fieldToken: 'Token',
  fieldStt: 'Voice server URL',
  fieldSttNote: 'Can be left empty - only voice replies are disabled',
  optional: 'optional',
  save: 'Save and start',
  errRequired: 'Server URL and token are required',
  errScheme: 'The URL must start with https:// (http:// only works in a sideloaded dev build)',
  sendBlocked: 'Not sent - multiple terminals',
  tryDemo: 'Try the demo first',
  tryDemoNote: 'Explore every screen with sample data, no server needed. You can change this later.',
  helpTitle: 'If it will not connect',
  helpBody: 'Only Tailscale, Cloudflare, ngrok and localtunnel URLs can be reached. Local LAN addresses and plain http:// URLs are blocked.',
  feedback: 'Report a bug / request a feature',
  donate: 'Support development (buy me a coffee)',
  voicePrefix: '(Voice input from G2 - fix likely mis-transcriptions from context, answer briefly)',
}

const zh: Strings = {
  loading: '(载入中)',
  empty: '(空)',
  noSessions: '没有会话',
  noHistory: '(无记录)',
  connError: '连接错误',
  thinking: '思考中',
  approve: '允许',
  approveAlways: '始终允许',
  deny: '拒绝',
  awaiting: '等待批准',
  permExpired: '请求已过期或已处理',
  backToList: '返回列表',
  cancel: '取消',
  send: '发送',
  retake: '重新录音',
  quit: '放弃',
  recording: s => `🎤 录音中 ${s}秒`,
  micWarmup: '麦克风启动中…',
  tapWhenDone: '说完后轻点',
  transcribing: '转写中…',
  notRecognized: '(无法识别)',
  voiceOff: '未设置语音回复',
  hintList: '轻点:打开 滑动:选择 双击:退出',
  hintView: '轻点:🎤回复 滑动:滚动 双击:菜单',
  hintViewNoVoice: '滑动:滚动 双击:菜单',
  hintChoose: '轻点:确定 滑动:选择 双击:返回',
  hintRecord: '轻点:转写 双击:取消',
  setupGlasses: '欢迎\n\n请在手机屏幕上\n完成连接设置',
  setupTitle: 'Claude Code Remote 初始设置',
  setupLead: '连接到你自己电脑上运行的 Claude Code。如果还没准备好，请先阅读下面的「使用方法」。',
  stepsTitle: '使用方法',
  steps: [
    '在电脑上安装并启动 even-terminal（端口 3456，用 -t 设定令牌）',
    '用隧道把该端口暴露出去。例如：tailscale funnel 3456',
    '把得到的 https:// 网址和令牌填入下面',
    '只有需要语音回复时：用同样方式暴露语音服务器（端口 3458）并填入网址',
  ],
  fieldApi: '服务器网址',
  fieldToken: '令牌',
  fieldStt: '语音服务器网址',
  fieldSttNote: '可以留空，仅语音回复会被禁用',
  optional: '可选',
  save: '保存并启动',
  errRequired: '服务器网址和令牌为必填项',
  errScheme: '网址必须以 https:// 开头（http:// 仅在开发侧载版本中有效）',
  sendBlocked: '发送失败：终端有多个',
  tryDemo: '先试用演示',
  tryDemoNote: '无需服务器，用示例数据体验全部界面。之后可以随时修改设置。',
  helpTitle: '如果连不上',
  helpBody: '只能访问 Tailscale、Cloudflare、ngrok、localtunnel 的网址。局域网 IP 和 http:// 网址会被拦截。',
  feedback: '报告问题 / 功能建议',
  donate: '支持开发（请我喝杯咖啡）',
  voicePrefix: '（来自 G2 的语音输入，请根据上下文修正误识别，回答简洁）',
}

export const t: Strings = { ja, en, zh }[detectLang()]

export const LINK_FEEDBACK =
  'https://github.com/soran0806/claude-code-remote/issues/new?template=feedback.yml'
export const LINK_DONATE = 'https://ko-fi.com/s0r4n'
export const LINK_REPO = 'https://github.com/soran0806/claude-code-remote'
