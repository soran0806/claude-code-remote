import { cfg } from './config'
import { t, LINK_FEEDBACK, LINK_DONATE } from './i18n'
import { DEMO_BASE } from './demo'

// Evenアプリのローカルストレージに保存する接続設定。初回起動時にスマホ画面（コンパニオン
// WebView）でフォーム入力させ、以後は自動で読み込む。グラス側にはトークン等を一切出さない。
const KEYS = ['apiBase', 'token', 'sttBase'] as const

// sttBase は任意。空でも本体は動き、音声返信だけが無効になる。
const REQUIRED = ['apiBase', 'token'] as const

interface Bridge {
  getLocalStorage(key: string): Promise<string>
  setLocalStorage(key: string, value: string): Promise<boolean>
}

export async function loadSettings(bridge: Bridge): Promise<boolean> {
  // ponytail: シミュレータの自動操作APIはグラスのタッチパッドしか送れず、スマホ画面の
  // ボタンは押せない。スクショ撮影を自動化するため、起動URLの ?demo でデモに入れる。
  // 保存はしないので、通常のインストールには何の影響もない。
  if (new URLSearchParams(location.search).has('demo')) {
    cfg.apiBase = DEMO_BASE
    cfg.token = DEMO_BASE
    cfg.sttBase = ''
    return true
  }
  const values = await Promise.all(KEYS.map(k => bridge.getLocalStorage(`kuroko_${k}`).catch(() => '')))
  KEYS.forEach((k, i) => { cfg[k] = values[i] || '' })
  return REQUIRED.every(k => cfg[k])
}

export function voiceEnabled(): boolean {
  return !!cfg.sttBase
}

async function saveSettings(bridge: Bridge, values: Record<(typeof KEYS)[number], string>): Promise<void> {
  await Promise.all(KEYS.map(k => bridge.setLocalStorage(`kuroko_${k}`, values[k])))
  KEYS.forEach(k => { cfg[k] = values[k] })
}

/** グラスには案内文だけ、実際の入力はスマホのコンパニオン画面のフォームで行う */
export function renderOnboardingGlasses(): string {
  return t.setupGlasses
}

// フォームは onboarding（全画面）と設定の窓（<dialog>）で共用する。見た目は phone.css
type FormOpts = { full: boolean } // full=手順・デモ・つながらない時の案内まで出す（初回）

function formHtml(o: FormOpts): string {
  return `
    ${o.full ? `
      <h1>${t.setupTitle}</h1>
      <p class="lead">${t.setupLead}</p>
      <div class="card">
        <b>${t.stepsTitle}</b>
        <ol>${t.steps.map(s => `<li>${s}</li>`).join('')}</ol>
      </div>` : `<h2>${t.settings}</h2>`}
    <label class="f">${t.fieldApi}
      <input class="in" id="s-api" inputmode="url" autocapitalize="off" autocorrect="off"
             placeholder="your-pc.tail1234.ts.net（https:// から入力）">
    </label>
    <label class="f">${t.fieldToken}
      <input class="in" id="s-token" autocapitalize="off" autocorrect="off">
    </label>
    <label class="f">${t.fieldStt} (${t.optional})
      <input class="in" id="s-stt" inputmode="url" autocapitalize="off" autocorrect="off"
             placeholder="your-pc-stt.tail1234.ts.net（https:// から入力）">
      <div class="note">${t.fieldSttNote}</div>
    </label>
    <button class="btn primary" id="s-save">${t.save}</button>
    <p class="err" id="s-err" role="alert"></p>
    ${o.full ? `
      <button class="btn" id="s-demo">${t.tryDemo}</button>
      <div class="note" style="margin-bottom:16px">${t.tryDemoNote}</div>
      <div class="card">
        <b>${t.helpTitle}</b>
        <div class="note">${t.helpBody}</div>
      </div>` : `<button class="btn" id="s-cancel" style="margin-top:8px">${t.cancel}</button>`}
  `
}

function wireForm(root: ParentNode, bridge: Bridge, onDone: () => void, o: FormOpts): void {
  const $ = (id: string) => root.querySelector<HTMLInputElement>('#' + id)!
  const val = (id: string) => $(id).value.trim().replace(/\/+$/, '')
  if (!o.full) { // 設定の窓は今の値を入れて開く（デモ中は空）
    $('s-api').value = cfg.apiBase === DEMO_BASE ? '' : cfg.apiBase
    $('s-token').value = cfg.apiBase === DEMO_BASE ? '' : cfg.token
    $('s-stt').value = cfg.sttBase
  }
  $('s-save').addEventListener('click', () => {
    const apiBase = val('s-api')
    const token = $('s-token').value.trim()
    const sttBase = val('s-stt')
    const err = $('s-err')

    if (!apiBase || !token) { err.textContent = t.errRequired; return }
    // 打ち間違い（スキーム無し等）だけ弾く。http:// は開発用サイドロードでは実際に動くので
    // 通すが、パッケージ版ではwhitelistに阻まれるため下の注意書きで警告する。
    if (![apiBase, sttBase].filter(Boolean).every(u => /^https?:\/\//.test(u))) {
      err.textContent = t.errScheme
      return
    }
    err.textContent = ''
    saveSettings(bridge, { apiBase, token, sttBase }).then(onDone)
  })
  // サーバを持っていない人がそのまま全画面を触れるようにする（審査員もここを通る）
  root.querySelector('#s-demo')?.addEventListener('click', () => {
    saveSettings(bridge, { apiBase: DEMO_BASE, token: DEMO_BASE, sttBase: '' }).then(onDone)
  })
}

export function mountOnboardingForm(bridge: Bridge, onDone: () => void): void {
  const app = document.querySelector<HTMLDivElement>('#app')!
  app.className = 'phone'
  app.innerHTML = `<main class="form">${formHtml({ full: true })}
    <div class="links"><a href="${LINK_FEEDBACK}" target="_blank" rel="noopener">${t.feedback}</a>
    <a href="${LINK_DONATE}" target="_blank" rel="noopener">${t.donate}</a></div></main>`
  wireForm(app, bridge, onDone, { full: true })
}

/** 設定の窓。保存したら閉じて onDone（呼び出し側が設定を読み直す） */
export function openSettingsDialog(bridge: Bridge, onDone: () => void): void {
  const app = document.querySelector<HTMLDivElement>('#app')!
  const dlg = document.createElement('dialog')
  dlg.className = 'modal'
  dlg.setAttribute('aria-label', t.settings)
  dlg.innerHTML = formHtml({ full: false })
  app.appendChild(dlg)
  dlg.addEventListener('close', () => dlg.remove())
  wireForm(dlg, bridge, () => { dlg.close(); onDone() }, { full: false })
  dlg.querySelector('#s-cancel')!.addEventListener('click', () => dlg.close())
  dlg.showModal()
}
