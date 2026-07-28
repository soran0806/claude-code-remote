import {
  waitForEvenAppBridge,
  TextContainerProperty,
  CreateStartUpPageContainer,
  TextContainerUpgrade,
  OsEventTypeList,
} from '@evenrealities/even_hub_sdk'
import { getAdvW } from '@evenrealities/pretext'
import { wrapLines, separator } from './wrap'
import {
  Session, PermissionRequest,
  listSessions, fetchHistory, fetchPendingPermission, respondPermission, sendPrompt,
} from './api'
import { POLL_MS, MAX_RECORD_MS } from './config'
import { normalizePcm, Recorder, transcribe, injectTerminal } from './voice'
import { loadSettings, mountOnboardingForm, renderOnboardingGlasses, voiceEnabled } from './settings'
import { t, LINK_FEEDBACK, LINK_DONATE } from './i18n'

// ── レイアウト ──
// [本文 552px][スクロールバー 24px] / 下段: [凡例 400px][状態 176px]
const BODY_W = 552
const BODY_H = 240
const BODY_PAD = 4
const INNER_W = BODY_W - 2 * BODY_PAD
const INNER_H = BODY_H - 2 * BODY_PAD
const MAX_ROWS = Math.floor(INNER_H / 27) // 8行
const BAR_SLOTS = MAX_ROWS

// ── 状態 ──
type Mode = 'list' | 'view' | 'approve' | 'menu' | 'record' | 'confirm'
let mode: Mode = 'list'
let sessions: Session[] = []
let cursor = 0
let current: Session | null = null
let lines: string[] = [t.loading]
let topLine = 0
let followTail = true // 末尾追従（新しい応答が来たら最下部へ飛ぶ）
const SWIPE_LINES = 4 // スワイプ1回の総移動量
// ponytail: HUDは27px行単位でしか動かせん（ファーム制約）。減速グライドで慣性スクロール風に見せる
const SEP = separator(INNER_W - 8)
let pending: PermissionRequest | null = null
let approveChoice = 0 // 0=許可 1=常に許可 2=拒否
let lastError = ''
let notice = '' // 一時通知（承認期限切れ等）。次の画面遷移で消す
let jumpedFromList = false // 承認自動ジャンプで来た場合、決着後に一覧へ戻す
// 音声返信
let menuChoice = 0
let confirmChoice = 0
let transcriptText = ''
let transcribing = false
let transcribeAbort: AbortController | null = null
const recorder = new Recorder()

// 思考中表示: 動く演出が苦手というフィードバックにより静止表示に固定（2026-07-23）

// スクロールバー用グリフ（フォント非対応なら代替文字）
const BAR_THUMB = getAdvW('█'.codePointAt(0)!) > 0 ? '█' : '#'
const BAR_TRACK = getAdvW('│'.codePointAt(0)!) > 0 ? '│' : '|'
const APPROVE_LABELS = [t.approve, t.approveAlways, t.deny]
const MENU_LABELS = [t.backToList, t.cancel]
const CONFIRM_LABELS = [t.send, t.retake, t.quit]
const STATUS_ICON: Record<string, string> = { busy: '▶', idle: '・', awaiting: '⚠' }

const bridge = await waitForEvenAppBridge()
// 接続先/トークンは配布物に埋め込まず、Evenアプリのローカルストレージから読む。
// 未設定なら初回だけスマホ画面にフォームを出し、以後は自動起動する。
let settingsReady = await loadSettings(bridge)

const body = new TextContainerProperty({
  xPosition: 0, yPosition: 0, width: BODY_W, height: BODY_H,
  borderWidth: 0, borderColor: 5, paddingLength: BODY_PAD,
  containerID: 1, containerName: 'body',
  content: settingsReady ? t.loading : renderOnboardingGlasses(), isEventCapture: 1,
})
const footer = new TextContainerProperty({
  xPosition: 0, yPosition: 250, width: 400, height: 30,
  borderWidth: 0, borderColor: 5, paddingLength: 4,
  containerID: 2, containerName: 'footer',
  content: '', isEventCapture: 0,
})
const scrollbar = new TextContainerProperty({
  xPosition: BODY_W, yPosition: 0, width: 576 - BODY_W, height: BODY_H,
  borderWidth: 0, borderColor: 5, paddingLength: 0, // ponytail: █=20px、内幅24pxで余裕確保
  containerID: 3, containerName: 'scrollbar',
  content: '', isEventCapture: 0,
})
const status = new TextContainerProperty({
  xPosition: 400, yPosition: 250, width: 176, height: 30,
  borderWidth: 0, borderColor: 5, paddingLength: 4,
  containerID: 4, containerName: 'status',
  content: '', isEventCapture: 0,
})
const created = await bridge.createStartUpPageContainer(
  new CreateStartUpPageContainer({ containerTotalNum: 4, textObject: [body, footer, scrollbar, status] }),
)
if (created !== 0) console.error('createStartUpPageContainer failed:', created)

// ── 描画 ──
function listBody(): string {
  if (!sessions.length) return lastError ? `${t.connError}: ${lastError}` : t.noSessions
  return sessions.slice(0, MAX_ROWS).map((s, i) => {
    const mark = i === cursor ? '>' : ' '
    const icon = STATUS_ICON[s.status] ?? '?'
    return `${mark}${icon} ${s.title.slice(0, 22)}`
  }).join('\n')
}

function approveBody(): string {
  const p = pending
  const head = p ? `⚠ ${t.awaiting}: ${p.toolName}\n${p.description.slice(0, 60)}\n${p.detail.slice(0, 80)}` : `⚠ ${t.awaiting}`
  const menu = APPROVE_LABELS.map((l, i) => `${i === approveChoice ? '>' : ' '} ${l}`).join('\n')
  return `${head}\n\n${menu}`
}

function menuBody(): string {
  const title = current ? current.title.slice(0, 24) : ''
  const items = MENU_LABELS.map((l, i) => `${i === menuChoice ? '>' : ' '} ${l}`).join('\n')
  return `${title}\n\n${items}`
}

function recordBody(): string {
  return `${t.recording(Math.floor(recorder.seconds()))}\n\n${t.tapWhenDone}`
}

function confirmBody(): string {
  if (transcribing) return t.transcribing
  const items = CONFIRM_LABELS.map((l, i) => `${i === confirmChoice ? '>' : ' '} ${l}`).join('\n')
  return `${transcriptText.slice(0, 160) || t.notRecognized}\n\n${items}`
}

// 凡例（モードが変わったときしか変化しない＝ずれない）
function footerText(): string {
  if (mode === 'list') return t.hintList
  if (mode === 'approve' || mode === 'menu' || mode === 'confirm') return t.hintChoose
  if (mode === 'record') return t.hintRecord
  return voiceEnabled() ? t.hintView : t.hintViewNoVoice
}

// 状態表示（右下の独立コンテナ。ここだけ動くので凡例に影響しない）
function statusText(): string {
  if (notice) return notice
  const err = lastError ? ' ⚠' : ''
  if ((mode === 'view' || mode === 'menu') && current?.status === 'busy') {
    return `${t.thinking}${err}`
  }
  const st = current ? STATUS_ICON[current.status] ?? '' : ''
  return `${st}${err}`
}

// 右端の縦スクロールバー（8スロット、つまみの長さは表示割合に比例）
function scrollbarText(): string {
  if (mode !== 'view' || lines.length <= MAX_ROWS) return ''
  const thumb = Math.max(1, Math.round(BAR_SLOTS * MAX_ROWS / lines.length))
  const maxTop = lines.length - MAX_ROWS
  const pos = Math.min(BAR_SLOTS - thumb, Math.round((BAR_SLOTS - thumb) * (topLine / maxTop)))
  return Array.from({ length: BAR_SLOTS }, (_, i) =>
    i >= pos && i < pos + thumb ? BAR_THUMB : BAR_TRACK,
  ).join('\n')
}

function bodyText(): string {
  if (mode === 'list') return listBody()
  if (mode === 'approve') return approveBody()
  if (mode === 'menu') return menuBody()
  if (mode === 'record') return recordBody()
  if (mode === 'confirm') return confirmBody()
  return lines.slice(topLine, topLine + MAX_ROWS).join('\n') || t.empty
}

// BLE帯域節約: 内容が変わったコンテナだけ送る。書き込みは直列化。
const lastSent: Record<number, string> = {}
let rendering: Promise<unknown> = Promise.resolve()
function render() {
  const parts: [number, string, string][] = [
    [1, 'body', bodyText().slice(0, 1900)],
    [2, 'footer', footerText().slice(0, 190)],
    [3, 'scrollbar', scrollbarText()],
    [4, 'status', statusText().slice(0, 60)],
  ]
  rendering = rendering.then(async () => {
    for (const [id, name, content] of parts) {
      if (lastSent[id] === content) continue
      lastSent[id] = content
      await bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: id, containerName: name, content }))
    }
  }).catch(err => console.error('render failed:', err))
  mirrorCompanion(parts[0][2], `${parts[1][2]}  ${parts[3][2]}`)
}

// ── データ更新 ──
function historyToText(entries: { role: string; text: string }[]): string {
  return entries
    .filter(e => e.text?.trim())
    .map(e => (e.role === 'user' ? `◆ ${e.text.trim()}` : e.text.trim()))
    .join(`\n${SEP}\n`) || t.noHistory
}

async function refreshList() {
  try {
    sessions = await listSessions(MAX_ROWS)
    lastError = ''
    if (cursor >= sessions.length) cursor = Math.max(0, sessions.length - 1)
    // 承認待ちを検知したら一覧からでも自動でそのセッションへ飛ぶ（60秒期限を最大限使う）
    const aw = sessions.find(s => s.status === 'awaiting')
    if (aw && mode === 'list') {
      notice = ''
      jumpedFromList = true
      openSession(aw).catch(() => {})
      return
    }
  } catch (err: any) {
    lastError = String(err?.message ?? err)
  }
  render()
}

async function refreshSession() {
  if (!current) return
  try {
    const [hist, perm, list] = await Promise.all([
      fetchHistory(current.id),
      fetchPendingPermission(current.id),
      listSessions(MAX_ROWS),
    ])
    lastError = ''
    sessions = list
    const updated = list.find(s => s.id === current!.id)
    if (updated) current = updated
    pending = perm
    const newLines = wrapLines(historyToText(hist), INNER_W - 8)
    const changed = newLines.length !== lines.length || newLines[newLines.length - 1] !== lines[lines.length - 1]
    lines = newLines.length ? newLines : [t.empty]
    const maxTop = Math.max(0, lines.length - MAX_ROWS)
    if (followTail && changed) topLine = maxTop
    if (topLine > maxTop) topLine = maxTop
    if (!gliding) scrollTarget = topLine
    // 承認待ちを検知したら自動で承認画面へ（表示中セッションのみ）
    if (perm && mode === 'view') { mode = 'approve'; approveChoice = 0; notice = '' }
    if (!perm && mode === 'approve') {
      notice = t.permExpired
      // 自動ジャンプで来とった場合は一覧に帰る（テストセッションに居座らない）
      if (jumpedFromList) { jumpedFromList = false; mode = 'list'; current = null; refreshList().catch(() => {}); return }
      mode = 'view'
    }
  } catch (err: any) {
    lastError = String(err?.message ?? err)
  }
  render()
}

async function openSession(s: Session) {
  current = s
  mode = 'view'
  notice = ''
  followTail = true
  lines = [t.loading]
  topLine = 0
  render()
  await refreshSession()
}

// ── ポーリング ──（設定未完了の間は何もしない。オンボーディング完了で自然に動き出す）
const timer = setInterval(() => {
  if (!settingsReady) return
  if (mode === 'list') refreshList().catch(() => {})
  else refreshSession().catch(() => {})
}, POLL_MS)

// ── 音声返信 ──
async function startRecording() {
  recorder.clear()
  transcriptText = ''
  mode = 'record'
  render()
  await bridge.audioControl(true)
}

async function stopRecordingAndTranscribe() {
  mode = 'confirm'
  transcribing = true
  confirmChoice = 0
  render()
  await bridge.audioControl(false)
  const ctrl = new AbortController()
  transcribeAbort = ctrl
  const timeoutId = setTimeout(() => ctrl.abort(), 20000) // ponytail: STTサーバ死亡時に変換中で無限待ちしないための保険
  try {
    transcriptText = await transcribe(recorder.concat(), ctrl.signal)
    lastError = ''
  } catch (err: any) {
    if (err?.name !== 'AbortError') {
      transcriptText = ''
      lastError = String(err?.message ?? err)
    }
  } finally {
    clearTimeout(timeoutId)
    if (transcribeAbort === ctrl) transcribeAbort = null
  }
  if (mode !== 'confirm') return // ユーザーが変換中にキャンセル済み（既にview等へ遷移）
  transcribing = false
  render()
}

function cancelRecording() {
  bridge.audioControl(false)
  recorder.clear()
  mode = 'view'
  render()
}

function cancelTranscribing() {
  transcribeAbort?.abort()
  transcribeAbort = null
  transcribing = false
  mode = 'view'
  render()
}

// ── 送信ルーティング ──
// まず注入を試す。対象が「ターミナルで開いとるセッション」かはサーバがJSONLの
// entrypoint(cli/sdk-cli)で判定し、違えば409 → 従来の/api/promptにフォールバック
async function deliver(s: Session, text: string): Promise<void> {
  try {
    await injectTerminal(s.id, s.cwd, `${t.voicePrefix} ${text}`)
    return
  } catch {
    // ターミナル対象外・ターミナル無し/複数 → 通常送信へ
  }
  const newId = await sendPrompt(s.id, t.voicePrefix + '\n' + text, s.cwd)
  if (newId && newId !== s.id && current) current = { ...current, id: newId }
}

// ── 入力（R1リング/テンプルタップ） ──
function onTap() {
  if (mode === 'list') {
    const s = sessions[cursor]
    if (s) openSession(s).catch(err => console.error(err))
    return
  }
  if (mode === 'menu') {
    if (menuChoice === 0) { mode = 'list'; current = null; refreshList().catch(() => {}) }
    else { mode = 'view'; render() }
    return
  }
  if (mode === 'record') {
    stopRecordingAndTranscribe().catch(err => { lastError = String(err?.message ?? err); transcribing = false; render() })
    return
  }
  if (mode === 'confirm') {
    if (transcribing) return
    const s = current
    if (confirmChoice === 0 && s && transcriptText) {
      mode = 'view'
      followTail = true
      render()
      deliver(s, transcriptText)
        // 送信直後はまだターミナル側がJSONLにbusyの痕跡を書けてないことがあるため、
        // 少し待ってから状態確認する（そうしないと次の定期ポーリングまで「考え中」が出ない）
        .then(() => new Promise(resolve => setTimeout(resolve, 1500)))
        .then(() => refreshSession())
        .catch(err => { lastError = String(err?.message ?? err); render() })
    } else if (confirmChoice === 1) {
      startRecording().catch(err => { lastError = String(err?.message ?? err); mode = 'view'; render() })
    } else {
      mode = 'view'
      render()
    }
    return
  }
  if (mode === 'approve') {
    const s = current
    if (!s) return
    const decision = approveChoice === 0 ? 'allow' : approveChoice === 1 ? 'allowAlways' : 'deny'
    pending = null
    // 自動ジャンプで来とった場合は決定後すぐ一覧へ帰る
    if (jumpedFromList) {
      jumpedFromList = false
      mode = 'list'
      current = null
      respondPermission(s.id, decision)
        .then(() => refreshList())
        .catch(err => { lastError = String(err?.message ?? err); render() })
      render()
      return
    }
    mode = 'view'
    render()
    respondPermission(s.id, decision)
      .then(() => refreshSession())
      .catch(err => { lastError = String(err?.message ?? err); render() })
    return
  }
  // view: タップ一発で音声返信開始（ページ送りはスクロールで）。
  // STTサーバ未設定なら音声は使えんので、黙って無反応にせず理由を出す。
  if (!voiceEnabled()) { notice = t.voiceOff; render(); return }
  startRecording().catch(err => { lastError = String(err?.message ?? err); mode = 'view'; render() })
}

// 慣性風グライド: 目的地まで 2行→1行…と減速しながら流す。
// スワイプ連打は目的地に積み増しされ、進行中のグライドがそのまま追いかける（中断・再目標OK）
let scrollTarget = 0
let gliding = false
function scrollView(dir: 1 | -1) {
  const maxTop = Math.max(0, lines.length - MAX_ROWS)
  if (!gliding) scrollTarget = topLine
  scrollTarget = Math.max(0, Math.min(maxTop, scrollTarget + dir * SWIPE_LINES))
  startGlide()
}

function startGlide() {
  if (gliding) return
  gliding = true
  const tick = () => {
    if (mode !== 'view' || topLine === scrollTarget) {
      gliding = false
      followTail = topLine >= Math.max(0, lines.length - MAX_ROWS)
      render()
      return
    }
    const diff = scrollTarget - topLine
    topLine += Math.sign(diff) * (Math.abs(diff) > 2 ? 2 : 1)
    followTail = false
    render()
    window.setTimeout(tick, 140)
  }
  tick()
}

function onScrollUp() {
  if (mode === 'list') { cursor = (cursor - 1 + Math.max(1, sessions.length)) % Math.max(1, sessions.length); render(); return }
  if (mode === 'approve') { approveChoice = (approveChoice + 1) % APPROVE_LABELS.length; render(); return }
  if (mode === 'menu') { menuChoice = (menuChoice + 1) % MENU_LABELS.length; render(); return }
  if (mode === 'confirm') { if (!transcribing) { confirmChoice = (confirmChoice + 1) % CONFIRM_LABELS.length; render() } return }
  if (mode === 'record') return
  scrollView(-1)
}

function onScrollDown() {
  if (mode === 'list') { cursor = (cursor + 1) % Math.max(1, sessions.length); render(); return }
  if (mode === 'approve') { approveChoice = (approveChoice + 1) % APPROVE_LABELS.length; render(); return }
  if (mode === 'menu') { menuChoice = (menuChoice + 1) % MENU_LABELS.length; render(); return }
  if (mode === 'confirm') { if (!transcribing) { confirmChoice = (confirmChoice + 1) % CONFIRM_LABELS.length; render() } return }
  if (mode === 'record') return
  scrollView(1)
}

function onDoubleTap() {
  if (mode === 'view') { mode = 'menu'; menuChoice = 0; render(); return }
  if (mode === 'menu') { mode = 'view'; render(); return }
  if (mode === 'record') { cancelRecording(); return }
  if (mode === 'confirm') { if (transcribing) cancelTranscribing(); else { mode = 'view'; render() }; return }
  if (mode === 'approve') { mode = 'view'; render(); return } // 決定せず戻る（承認待ちは残る）
  bridge.shutDownPageContainer(1)
}

let cleanedUp = false
function cleanup() {
  if (cleanedUp) return
  cleanedUp = true
  clearInterval(timer)
  if (mode === 'record') bridge.audioControl(false)
  unsubscribe()
}

// protobufは0値を省略するのでCLICK_EVENT(0)はundefinedで届く。
// エンベロープ(sysEvent/textEvent)が存在するのにeventTypeが無い場合はCLICKとみなす。
// 文字列("CLICK"等)で届く実装もあるため fromJson で正規化。
function evType(env: { eventType?: unknown } | null | undefined): OsEventTypeList | null {
  if (!env) return null
  return OsEventTypeList.fromJson(env.eventType) ?? OsEventTypeList.CLICK_EVENT
}
const unsubscribe = bridge.onEvenHubEvent(event => {
  // マイクPCM（録音中のみ収集。秒表示はrenderのdiffで1秒毎にBLE送信）
  if (event.audioEvent) {
    const pcm = normalizePcm(event.audioEvent.audioPcm)
    if (pcm && mode === 'record') {
      recorder.push(pcm)
      if (recorder.seconds() * 1000 >= MAX_RECORD_MS) {
        stopRecordingAndTranscribe().catch(err => { lastError = String(err?.message ?? err); transcribing = false; render() })
      } else render()
    }
    return
  }

  const sysType = evType(event.sysEvent)
  const textType = evType(event.textEvent)

  // ライフサイクル系(4-7)を先に処理してから0(CLICK)判定する。
  // 空エンベロープがCLICK扱いになる誤爆を順序で防ぐ。
  if (sysType === OsEventTypeList.SYSTEM_EXIT_EVENT || sysType === OsEventTypeList.ABNORMAL_EXIT_EVENT) { cleanup(); return }
  if (sysType === OsEventTypeList.FOREGROUND_ENTER_EVENT || sysType === OsEventTypeList.FOREGROUND_EXIT_EVENT) return
  if (sysType === OsEventTypeList.DOUBLE_CLICK_EVENT || textType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
    onDoubleTap()
    return
  }
  if (textType === OsEventTypeList.SCROLL_TOP_EVENT || sysType === OsEventTypeList.SCROLL_TOP_EVENT) { onScrollUp(); return }
  if (textType === OsEventTypeList.SCROLL_BOTTOM_EVENT || sysType === OsEventTypeList.SCROLL_BOTTOM_EVENT) { onScrollDown(); return }
  if (sysType === OsEventTypeList.CLICK_EVENT || textType === OsEventTypeList.CLICK_EVENT) { onTap(); return }
})

window.addEventListener('beforeunload', cleanup)

// ── スマホ側ミラー ──
function mountMirrorUI() {
  const app = document.querySelector<HTMLDivElement>('#app')!
  app.innerHTML = `
    <style>
      #think { display:none; align-items:center; gap:7px; margin-top:14px; color:#8AE68A; font-size:13px; }
      .tdot { width:6px; height:6px; border-radius:50%; background:#8AE68A; box-shadow:0 0 6px rgba(138,230,138,.6); animation:tpulse 900ms cubic-bezier(.65,0,.35,1) infinite; }
      .tdot:nth-child(2) { animation-delay:120ms; }
      .tdot:nth-child(3) { animation-delay:240ms; }
      @keyframes tpulse { 0%,60%,100% { transform:scale(.6); opacity:.35 } 30% { transform:scale(1); opacity:1 } }
    </style>
    <main style="margin:auto;padding:24px;max-width:680px;box-sizing:border-box;">
      <header style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <h1 style="font-size:18px;font-weight:600;margin:0;">Claude Code Remote</h1>
        <span id="foot" style="font-size:12px;color:#919191;"></span>
      </header>
      <pre id="mirror" style="background:#2E2E2E;border:1px solid #3E3E3E;border-radius:12px;padding:20px;font-size:15px;line-height:1.55;white-space:pre-wrap;word-break:break-word;color:#E5E5E5;margin:0;min-height:200px;"></pre>
      <div id="think"><span class="tdot"></span><span class="tdot"></span><span class="tdot"></span><span>${t.thinking}…</span></div>
      <footer style="margin-top:22px;padding-top:14px;border-top:1px solid #3E3E3E;">
        <a href="${LINK_FEEDBACK}" target="_blank" rel="noopener" style="display:block;padding:8px 0;color:#8AE68A;font-size:13px;text-decoration:none;">${t.feedback}</a>
        <a href="${LINK_DONATE}" target="_blank" rel="noopener" style="display:block;padding:8px 0;color:#8AE68A;font-size:13px;text-decoration:none;">${t.donate}</a>
      </footer>
    </main>
  `
}
function mirrorCompanion(b: string, f: string) {
  const mirror = document.getElementById('mirror')
  const foot = document.getElementById('foot')
  const think = document.getElementById('think')
  if (mirror) mirror.textContent = b
  if (foot) foot.textContent = f
  if (think) think.style.display = current?.status === 'busy' ? 'flex' : 'none'
}

// 初回ロード。未設定ならスマホ画面にフォームを出し、保存されたら通常起動に切り替える
if (settingsReady) {
  mountMirrorUI()
  refreshList().catch(() => {})
} else {
  mountOnboardingForm(bridge, () => {
    settingsReady = true
    lastSent[1] = '' // body再送を強制（起動中…→一覧に切り替えるため）
    mountMirrorUI()
    refreshList().catch(() => {})
  })
}
