import {
  waitForEvenAppBridge,
  TextContainerProperty,
  CreateStartUpPageContainer,
  RebuildPageContainer,
  TextContainerUpgrade,
  OsEventTypeList,
} from '@evenrealities/even_hub_sdk'
import { wrapLines, separator, truncatePx } from './wrap'
import { ageText, listRow, positionBar, rightAlign } from './layout'
import './phone.css'
import {
  Session, PermissionRequest, HistoryEntry,
  listSessions, fetchHistory, fetchPendingPermission, respondPermission, sendPrompt,
} from './api'
import { POLL_MS, MAX_RECORD_MS } from './config'
import { normalizePcm, Recorder, transcribe, injectTerminal, ForkRisk } from './voice'
import { loadSettings, mountOnboardingForm, openSettingsDialog, renderOnboardingGlasses, voiceEnabled } from './settings'
import { t, LINK_FEEDBACK, LINK_DONATE } from './i18n'
import { glyph, STATUS_ICON } from './glyphs'

// ── レイアウト ──
// 全幅3段: [見出し 30px] / [本文 228px] / [最下行 30px]（高さ 288）。スクロールバーは廃止
const W = 576
const HEAD_H = 30
const BODY_H = 228
const BODY_Y = HEAD_H
const BAR_H = 30
const BODY_PAD = 4
// 見出し・最下行は padding 1（内高28px）。4 だと内高22pxで1行(27px)が溢れ、ファームが右端にスクロールの縦棒を描く
const LINE_PAD = 1
const INNER_W = W - 2 * BODY_PAD // 見出し・最下行は padding 1 なので実際の内幅は 574（6px 余る）
const INNER_H = BODY_H - 2 * BODY_PAD
const MAX_ROWS = Math.floor(INNER_H / 27) // 8行（27px/行）
// 実機は pretext の実測より手前で折り返す。本文コンテナに入れる文字はこの幅まで
const TEXT_W = INNER_W - 8
// 一覧は g2-epub-reader と同じ「上のまとまり＋選択行(枠)＋下のまとまり」。寸法も同じ（x16・幅544・行27・枠の行33）
const LIST_X = 16
const LIST_W = 544
const LH = 27
const LIST_ROWS = 7 // 6*27 + 6 + 6 + 33 = 207 <= BODY_H。8行やと 234 で最下行に食い込む
const ROW_W = LIST_W - 4 - 8 // 内幅540（枠2 or padding 2）から同じ 8px の余裕

// ── 状態 ──
type Mode = 'list' | 'view' | 'approve' | 'menu' | 'record' | 'confirm'
let mode: Mode = 'list'
let sessions: Session[] = []
let cursor = 0
let current: Session | null = null
let lines: string[] = [t.loading]
let hist: HistoryEntry[] = [] // スマホ側の会話表示用（折り返し前の原文）
let topLine = 0
let followTail = true // 末尾追従（新しい応答が来たら最下部へ飛ぶ）
const SWIPE_LINES = 4 // スワイプ1回の総移動量
// ponytail: HUDは27px行単位でしか動かせん（ファーム制約）。減速グライドで慣性スクロール風に見せる
const SEP = separator(TEXT_W)
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
let micReady = false  // audioControl(true)が返るまでマイクは実際には拾えん
let transcribeAbort: AbortController | null = null
const recorder = new Recorder()

// 思考中表示: 動く演出が苦手というフィードバックにより静止表示に固定（2026-07-23）

const ERR_MARK = glyph('⚠', '!')
const APPROVE_LABELS = [t.approve, t.approveAlways, t.deny]
const MENU_LABELS = [t.backToList, t.cancel]
const CONFIRM_LABELS = [t.send, t.retake, t.quit]

const bridge = await waitForEvenAppBridge()
// 接続先/トークンは配布物に埋め込まず、Evenアプリのローカルストレージから読む。
// 未設定なら初回だけスマホ画面にフォームを出し、以後は自動起動する。
let settingsReady = await loadSettings(bridge)

// コンテナ1個＝[id, 名前, 中身, 箱]。箱の並びが変わった時だけページを作り直す
type Box = Partial<TextContainerProperty>
type Part = [number, string, string, Box]
const BODY_BOX: Box = { xPosition: 0, yPosition: BODY_Y, width: W, height: BODY_H, paddingLength: BODY_PAD, isEventCapture: 1 }
const HEAD_BOX: Box = { xPosition: 0, yPosition: 0, width: W, height: HEAD_H, paddingLength: LINE_PAD }
const BAR_BOX: Box = { xPosition: 0, yPosition: BODY_Y + BODY_H, width: W, height: BAR_H, paddingLength: LINE_PAD }
const toContainers = (ps: Part[]) => ps.map(([id, name, content, box]) =>
  new TextContainerProperty({ borderWidth: 0, borderColor: 5, isEventCapture: 0, ...box, containerID: id, containerName: name, content }))
const layoutKey = (ps: Part[]) => JSON.stringify(ps.map(p => [p[0], p[3]]))

const startup: Part[] = [
  [1, 'body', settingsReady ? t.loading : renderOnboardingGlasses(), BODY_BOX],
  [2, 'header', '', HEAD_BOX],
  [3, 'bottom', '', BAR_BOX],
]
const created = await bridge.createStartUpPageContainer(
  new CreateStartUpPageContainer({ containerTotalNum: startup.length, textObject: toContainers(startup) }),
)
if (created !== 0) console.error('createStartUpPageContainer failed:', created)

// ── 描画 ──
function listRows(): string[] {
  const now = Date.now()
  return sessions.slice(0, LIST_ROWS).map(s =>
    listRow(STATUS_ICON[s.status] ?? '?', s.title, ageText(s.timestamp, now, t.age), ROW_W))
}

function listBody(): string {
  return lastError ? `${t.connError}: ${lastError}` : t.noSessions
}

function approveBody(): string {
  const p = pending
  const mark = STATUS_ICON.awaiting
  const head = p ? `${mark} ${t.awaiting}: ${p.toolName}\n${p.description.slice(0, 60)}\n${p.detail.slice(0, 80)}` : `${mark} ${t.awaiting}`
  const menu = APPROVE_LABELS.map((l, i) => `${i === approveChoice ? '>' : ' '} ${l}`).join('\n')
  return `${head}\n\n${menu}`
}

function menuBody(): string {
  const title = current ? truncatePx(current.title, TEXT_W) : ''
  const items = MENU_LABELS.map((l, i) => `${i === menuChoice ? '>' : ' '} ${l}`).join('\n')
  return `${title}\n\n${items}`
}

function recordBody(): string {
  // マイクが立ち上がる前に「録音中」と出すと、その間に喋った分が丸ごと落ちる。
  // 起動が終わるまでは別の文言にして、切り替わりを「喋ってええ」の合図にする。
  if (!micReady) return t.micWarmup
  return `${t.recording(Math.floor(recorder.seconds()))}\n\n${t.tapWhenDone}`
}

function confirmBody(): string {
  if (transcribing) return t.transcribing
  const items = CONFIRM_LABELS.map((l, i) => `${i === confirmChoice ? '>' : ' '} ${l}`).join('\n')
  return `${transcriptText.slice(0, 160) || t.notRecognized}\n\n${items}`
}

// 見出し: 一覧はアプリ名と件数、それ以外は「状態アイコン＋セッション題名」
function headerText(): string {
  if (mode === 'list' || !current) return rightAlign('Claude Code Remote', sessions.length ? t.sessionCount(sessions.length) : '', INNER_W)
  return truncatePx(`${STATUS_ICON[current.status] ?? ''} ${current.title}`, INNER_W)
}

function clockText(): string {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
// 最下行: 読み表示は位置バー＋時計、他は通知/状態＋時計（ここだけが動くので本文に影響しない）
function bottomText(): string {
  const err = lastError ? `${ERR_MARK} ` : ''
  const busy = (mode === 'view' || mode === 'menu') && current?.status === 'busy' ? t.thinking : ''
  const left = err + (notice || busy)
  if (mode === 'view' && !notice) return positionBar(topLine, Math.max(0, lines.length - MAX_ROWS), clockText(), INNER_W, left)
  return rightAlign(left, clockText(), INNER_W)
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
let lastSent: Record<number, string> = {}
let shownLayout = layoutKey(startup)
let rendering: Promise<unknown> = Promise.resolve()

// 一覧（1件以上）は本文コンテナを空の入力層にして、上に 上のまとまり／選択行(枠)／下のまとまり を重ねる
function pageParts(): Part[] {
  const rows = mode === 'list' ? listRows() : []
  const base: Part[] = [
    [1, 'body', rows.length ? ' ' : bodyText().slice(0, 1900), BODY_BOX],
    [2, 'header', headerText().slice(0, 190), HEAD_BOX],
    [3, 'bottom', bottomText().slice(0, 190), BAR_BOX],
  ]
  if (!rows.length) return base
  const sel = Math.min(cursor, rows.length - 1)
  const above = rows.slice(0, sel), below = rows.slice(sel + 1)
  const aH = above.length ? above.length * LH + 6 : 0
  const block = (id: number, name: string, rs: string[], y: number): Part =>
    [id, name, rs.join('\n'), { xPosition: LIST_X, yPosition: y, width: LIST_W, height: rs.length * LH + 6, paddingLength: 2 }]
  return [
    ...base,
    ...(above.length ? [block(4, 'above', above, BODY_Y)] : []),
    [5, 'selected', rows[sel], { xPosition: LIST_X, yPosition: BODY_Y + aH, width: LIST_W, height: 33, borderWidth: 2, paddingLength: 0 }],
    ...(below.length ? [block(6, 'below', below, BODY_Y + aH + 33)] : []),
  ]
}

function render() {
  const parts = pageParts()
  rendering = rendering.then(async () => {
    // 枠の位置は textContainerUpgrade で動かせん → 箱が変わったらページごと作り直す（EPUB の目次と同じ）
    const key = layoutKey(parts)
    if (key !== shownLayout) {
      await bridge.rebuildPageContainer(new RebuildPageContainer({ containerTotalNum: parts.length, textObject: toContainers(parts) }))
      shownLayout = key
      lastSent = Object.fromEntries(parts.map(([id, , content]) => [id, content]))
      return
    }
    for (const [id, name, content] of parts) {
      if (lastSent[id] === content) continue
      lastSent[id] = content
      await bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: id, containerName: name, content }))
    }
  }).catch(err => console.error('render failed:', err))
  renderPhone()
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
    sessions = await listSessions(LIST_ROWS)
    lastError = ''
    if (cursor >= sessions.length) cursor = Math.max(0, sessions.length - 1)
    // 承認待ちを検知したら一覧からでも自動でそのセッションへ飛ぶ（60秒期限を最大限使う）
    const aw = sessions.find(s => s.status === 'awaiting')
    if (aw && mode === 'list' && (!DEBUG || DEBUG === 'approve')) {
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
    const [h, perm, list] = await Promise.all([
      fetchHistory(current.id),
      fetchPendingPermission(current.id),
      listSessions(LIST_ROWS),
    ])
    lastError = ''
    sessions = list
    const updated = list.find(s => s.id === current!.id)
    if (updated) current = updated
    pending = perm
    hist = h
    const newLines = wrapLines(historyToText(h), TEXT_W)
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
      if (jumpedFromList) { jumpedFromList = false; mode = 'list'; current = null; saveResume(); refreshList().catch(() => {}); return }
      mode = 'view'
    }
  } catch (err: any) {
    lastError = String(err?.message ?? err)
  }
  render()
}

// ── ロック復帰対策 ──
// AndroidではバックグラウンドでWebViewごと破棄されることがあり、復帰は実質コールドスタートに
// なる（iOSは維持される）。開いとったセッションと読んどった位置だけ残して復元する。
// ponytail: 残すのは2つだけ。録音中/確認中は復帰しても音声が消えとるので保存しない
const RESUME_KEY = 'kuroko_resume'

function saveResume(): void {
  const v = mode === 'view' && current ? JSON.stringify({ id: current.id, topLine }) : ''
  bridge.setLocalStorage(RESUME_KEY, v).catch(() => {})
}

/** 復元できたら true。セッションが消えとったら false を返して通常起動に任せる */
async function restoreResume(): Promise<boolean> {
  const raw = await bridge.getLocalStorage(RESUME_KEY).catch(() => '')
  if (!raw) return false
  try {
    const saved = JSON.parse(raw) as { id: string; topLine: number }
    sessions = await listSessions(LIST_ROWS)
    const s = sessions.find(x => x.id === saved.id)
    if (!s) return false
    await openSession(s)
    const maxTop = Math.max(0, lines.length - MAX_ROWS)
    topLine = Math.min(saved.topLine, maxTop)
    scrollTarget = topLine
    followTail = topLine >= maxTop
    render()
    return true
  } catch {
    return false
  }
}

async function openSession(s: Session) {
  current = s
  mode = 'view'
  notice = ''
  followTail = true
  lines = [t.loading]
  hist = []
  topLine = 0
  render()
  saveResume()
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
  micReady = false
  mode = 'record'
  render()                       // タップの手応えは即返す（「マイク起動中…」）
  await bridge.audioControl(true)
  if (mode !== 'record') return  // 起動待ちの間に中止された
  recorder.clear()               // 起動途中に紛れ込んだPCMは捨てる
  micReady = true
  render()                       // ここで「録音中」に変わる＝喋ってええ合図
}

async function stopRecordingAndTranscribe() {
  micReady = false
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
  micReady = false
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
  } catch (err) {
    // 対象が稼働中の本物のターミナルセッションなら、/api/prompt はフォーク復元になる。
    // 返事が別セッションに付いてターミナルにも出ん＝黙って壊れるので、ここで止める。
    if (err instanceof ForkRisk) throw err
    // それ以外（ターミナル駆動でない/古いセッション）は普通の続きになるので通常送信へ
  }
  const newId = await sendPrompt(s.id, t.voicePrefix + '\n' + text, s.cwd)
  if (newId && newId !== s.id && current) current = { ...current, id: newId }
}

// 一覧へ戻る（グラスのメニューとスマホの「戻る」で共通）
function goList() {
  mode = 'list'
  current = null
  hist = []
  saveResume()
  refreshList().catch(() => {})
}

// 承認の決定（グラスのタップとスマホのボタンで共通。両方が同じ state を見る）
function decidePermission(choice: number) {
  const s = current
  if (!s) return
  const decision = choice === 0 ? 'allow' : choice === 1 ? 'allowAlways' : 'deny'
  pending = null
  // 自動ジャンプで来とった場合は決定後すぐ一覧へ帰る
  if (mode === 'approve' && jumpedFromList) {
    jumpedFromList = false
    mode = 'list'
    current = null
    respondPermission(s.id, decision)
      .then(() => refreshList())
      .catch(err => { lastError = String(err?.message ?? err); render() })
    render()
    return
  }
  // 録音中などに押された時は画面遷移せず、承認だけ返す
  if (mode === 'approve') mode = 'view'
  render()
  respondPermission(s.id, decision)
    .then(() => refreshSession())
    .catch(err => { lastError = String(err?.message ?? err); render() })
}

// ── 入力（R1リング/テンプルタップ） ──
function onTap() {
  if (mode === 'list') {
    const s = sessions[cursor]
    if (s) openSession(s).catch(err => console.error(err))
    return
  }
  if (mode === 'menu') {
    if (menuChoice === 0) goList()
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
        .catch(err => {
          if (err instanceof ForkRisk) notice = t.sendBlocked
          else lastError = String(err?.message ?? err)
          render()
        })
    } else if (confirmChoice === 1) {
      startRecording().catch(err => { lastError = String(err?.message ?? err); mode = 'view'; render() })
    } else {
      mode = 'view'
      render()
    }
    return
  }
  if (mode === 'approve') { decidePermission(approveChoice); return }
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
      saveResume()
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
  // 上スワイプは1つ前へ（以前は上下とも次へ進んどった）
  if (mode === 'approve') { approveChoice = (approveChoice + APPROVE_LABELS.length - 1) % APPROVE_LABELS.length; render(); return }
  if (mode === 'menu') { menuChoice = (menuChoice + MENU_LABELS.length - 1) % MENU_LABELS.length; render(); return }
  if (mode === 'confirm') { if (!transcribing) { confirmChoice = (confirmChoice + CONFIRM_LABELS.length - 1) % CONFIRM_LABELS.length; render() } return }
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
  if (sysType === OsEventTypeList.FOREGROUND_ENTER_EVENT) {
    // 復帰直後は表示が古い。次のポーリングを待たずに取り直す
    if (settingsReady) (mode === 'list' ? refreshList() : refreshSession()).catch(() => {})
    return
  }
  if (sysType === OsEventTypeList.FOREGROUND_EXIT_EVENT) {
    // Androidはこの後プロセスごと消える可能性がある。最後に位置を焼いておく
    saveResume()
    return
  }
  if (sysType === OsEventTypeList.DOUBLE_CLICK_EVENT || textType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
    onDoubleTap()
    return
  }
  if (textType === OsEventTypeList.SCROLL_TOP_EVENT || sysType === OsEventTypeList.SCROLL_TOP_EVENT) { onScrollUp(); return }
  if (textType === OsEventTypeList.SCROLL_BOTTOM_EVENT || sysType === OsEventTypeList.SCROLL_BOTTOM_EVENT) { onScrollDown(); return }
  if (sysType === OsEventTypeList.CLICK_EVENT || textType === OsEventTypeList.CLICK_EVENT) { onTap(); return }
})

window.addEventListener('beforeunload', cleanup)

// ── スマホ側コンパニオン ──
// グラスと同じ state（mode / sessions / current / pending / hist）を render() のたびに描き直す。
// ponytail: 領域ごとに html を前回と比べ、変わった所だけ差し替える（スクロール位置とフォーカスを守る）。仮想DOMは入れん
const DEBUG = new URLSearchParams(location.search).get('debug') ?? '' // 撮影用: list|conv|approve|settings（?demo と併用）

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const GEAR = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1"/></svg>'
const dot = (st: string) => `<span class="dot ${esc(st)}" role="img" aria-label="${esc(({ busy: t.thinking, idle: t.idle, awaiting: t.awaiting } as Record<string, string>)[st] ?? st)}"></span>`

function mountMirrorUI() {
  const app = document.querySelector<HTMLDivElement>('#app')!
  app.className = 'phone'
  app.innerHTML = `
    <main>
      <header class="top"><h1>Claude Code Remote</h1><button class="gear" data-a="settings" aria-label="${esc(t.settings)}">${GEAR}</button></header>
      <div class="body" id="pc"></div>
      <div class="cta">
        <a class="coffee" href="${LINK_DONATE}" target="_blank" rel="noopener" aria-label="${esc(t.donate)}">${t.coffee}&nbsp;<span aria-hidden="true">👍</span></a>
        <a class="fb" href="${LINK_FEEDBACK}" target="_blank" rel="noopener" aria-label="${esc(t.feedback)}">${t.feedbackShort}</a>
      </div>
    </main>`
  phoneKind = ''
  app.addEventListener('click', e => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-a]')
    if (!el) return
    const a = el.dataset.a
    if (a === 'settings') {
      openSettingsDialog(bridge, () => {
        settingsReady = true
        sessions = []; lastError = ''; lastSent[1] = ''
        goList()
      })
    } else if (a === 'open') {
      const i = Number(el.dataset.i)
      if (sessions[i]) { cursor = i; jumpedFromList = false; openSession(sessions[i]).catch(err => console.error(err)) }
    } else if (a === 'back') {
      if (mode === 'record') cancelRecording()
      else if (mode === 'confirm' && transcribing) cancelTranscribing()
      goList()
    } else if (a === 'perm') {
      decidePermission(Number(el.dataset.c))
    }
  })
}

let phoneKind = ''
let phoneSid = ''
const phoneSig: Record<string, string> = {}
// 領域の html が変わった時だけ差し替える。変えたら true
function put(id: string, html: string): HTMLElement | null {
  const el = document.getElementById(id)
  if (!el || phoneSig[id] === html) return null
  phoneSig[id] = html
  el.innerHTML = html
  return el
}

function renderPhone() {
  const pc = document.getElementById('pc')
  if (!pc) return
  const kind = mode === 'list' || !current ? 'list' : 'conv'
  if (kind !== phoneKind) {
    phoneKind = kind
    for (const k of Object.keys(phoneSig)) delete phoneSig[k]
    pc.innerHTML = kind === 'list'
      ? `<div class="scroll" tabindex="-1"><ul class="sess" id="p-sess"></ul></div>`
      : `<div class="tocbar"><button class="back" data-a="back"><span aria-hidden="true">←</span>${t.backToList}</button><div class="ctitle" id="p-title"></div></div>
         <div class="scroll" id="p-scroll" tabindex="0" role="region" aria-label="${esc(t.sessionsLabel)}"><div class="msgs" id="p-msgs"></div></div>
         <div class="think" id="p-think" hidden role="status"><i></i><i></i><i></i><span>${t.thinking}…</span></div>
         <div id="p-perm"></div>`
  }
  if (kind === 'list') {
    const now = Date.now()
    put('p-sess', sessions.length
      ? sessions.map((s, i) => `<li><button class="srow" data-a="open" data-i="${i}">${dot(s.status)}<span class="ti">${esc(s.title)}</span><span class="ag">${esc(ageText(s.timestamp, now, t.age))}</span></button></li>`).join('')
      : `<li class="empty">${esc(lastError ? `${t.connError}: ${lastError}` : t.noSessions)}</li>`)
    return
  }
  const s = current!
  put('p-title', `${dot(s.status)}<span>${esc(s.title)}</span>`)
  // 会話の全文（折り返し前）。末尾を見とった時と、開いた直後だけ最下部へ追従する
  const sc = document.getElementById('p-scroll')!
  const atBottom = sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 40
  const entries = hist.filter(e => e.text?.trim())
  const loading = !entries.length && lines.length === 1 && lines[0] === t.loading
  const changed = put('p-msgs', entries.length
    ? entries.map(e => `<div class="msg${e.role === 'user' ? ' u' : ''}">${esc(e.text.trim())}</div>`).join('')
    : `<div class="empty">${loading ? t.loading : t.noHistory}</div>`)
  if (changed && (atBottom || phoneSid !== s.id)) sc.scrollTop = sc.scrollHeight
  phoneSid = s.id
  const th = document.getElementById('p-think')!
  th.hidden = s.status !== 'busy'
  put('p-perm', pending && mode !== 'list'
    ? `<div class="perm" role="group" aria-label="${esc(t.awaiting)}">
        <div class="ph">${dot('awaiting')}<span>${esc(t.awaiting)}: ${esc(pending.toolName)}</span></div>
        ${pending.description ? `<div class="pd">${esc(pending.description)}</div>` : ''}
        ${pending.detail ? `<pre aria-label="${esc(t.detail)}">${esc(pending.detail)}</pre>` : '<div style="height:12px"></div>'}
        <div class="acts">
          <button class="btn allow" data-a="perm" data-c="0">${t.approve}</button>
          <button class="btn" data-a="perm" data-c="1">${t.approveAlways}</button>
          <button class="btn danger" data-a="perm" data-c="2">${t.deny}</button>
        </div></div>`
    : '')
}

// 撮影用: ?debug= で目的の画面へクリック無しで入る（EPUB の ?debug= と同じ発想）
async function debugStart() {
  if (DEBUG === 'conv' && sessions[0]) await openSession(sessions[0])
  if (DEBUG === 'settings') openSettingsDialog(bridge, () => {})
}

// 初回ロード。未設定ならスマホ画面にフォームを出し、保存されたら通常起動に切り替える
if (settingsReady) {
  mountMirrorUI()
  restoreResume()
    .then(ok => { if (!ok) return refreshList() })
    .catch(() => refreshList().catch(() => {}))
    .then(() => debugStart())
} else {
  mountOnboardingForm(bridge, () => {
    settingsReady = true
    lastSent[1] = '' // body再送を強制（起動中…→一覧に切り替えるため）
    mountMirrorUI()
    refreshList().catch(() => {})
  })
}
