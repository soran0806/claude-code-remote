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

const S = {
  label: 'display:block;margin-bottom:14px;font-size:13px;color:#c9c9c9;',
  input: 'width:100%;box-sizing:border-box;margin-top:5px;padding:9px;border-radius:6px;'
       + 'border:1px solid #3E3E3E;background:#1c1c1c;color:#fff;font-size:15px;',
  note: 'color:#919191;font-size:12px;margin-top:4px;',
  card: 'background:#242424;border:1px solid #3E3E3E;border-radius:10px;padding:14px 16px;margin-bottom:20px;',
  link: 'display:block;padding:10px 0;color:#8AE68A;font-size:13px;text-decoration:none;',
}

export function mountOnboardingForm(bridge: Bridge, onDone: () => void): void {
  const app = document.querySelector<HTMLDivElement>('#app')!
  app.innerHTML = `
    <main style="margin:auto;padding:24px;max-width:460px;box-sizing:border-box;
                 font:14px/1.6 -apple-system,system-ui,sans-serif;color:#E5E5E5;">
      <h1 style="font-size:19px;margin:0 0 6px;">${t.setupTitle}</h1>
      <p style="color:#919191;margin:0 0 20px;font-size:13px;">${t.setupLead}</p>

      <div style="${S.card}">
        <div style="font-weight:600;margin-bottom:8px;">${t.stepsTitle}</div>
        <ol style="margin:0;padding-left:20px;color:#c9c9c9;font-size:13px;">
          ${t.steps.map(s => `<li style="margin-bottom:6px;">${s}</li>`).join('')}
        </ol>
      </div>

      <label style="${S.label}">${t.fieldApi}
        <input id="s-api" inputmode="url" autocapitalize="off" autocorrect="off"
               placeholder="https://your-pc.tail1234.ts.net" style="${S.input}">
      </label>
      <label style="${S.label}">${t.fieldToken}
        <input id="s-token" autocapitalize="off" autocorrect="off" style="${S.input}">
      </label>
      <label style="${S.label}">${t.fieldStt} <span style="color:#919191;">(${t.optional})</span>
        <input id="s-stt" inputmode="url" autocapitalize="off" autocorrect="off"
               placeholder="https://your-pc-stt.tail1234.ts.net" style="${S.input}">
        <div style="${S.note}">${t.fieldSttNote}</div>
      </label>

      <button id="s-save" style="width:100%;padding:12px;border-radius:8px;border:none;
              background:#8AE68A;color:#111;font-weight:600;font-size:15px;">${t.save}</button>
      <p id="s-err" style="color:#e68a8a;font-size:13px;margin-top:10px;min-height:1em;"></p>

      <button id="s-demo" style="width:100%;padding:11px;border-radius:8px;background:transparent;
              border:1px solid #3E3E3E;color:#E5E5E5;font-size:14px;">${t.tryDemo}</button>
      <div style="${S.note}margin-bottom:20px;">${t.tryDemoNote}</div>

      <div style="${S.card}">
        <div style="font-weight:600;margin-bottom:6px;">${t.helpTitle}</div>
        <div style="color:#c9c9c9;font-size:13px;">${t.helpBody}</div>
      </div>

      <a href="${LINK_FEEDBACK}" target="_blank" rel="noopener" style="${S.link}">${t.feedback}</a>
      <a href="${LINK_DONATE}" target="_blank" rel="noopener" style="${S.link}">${t.donate}</a>
    </main>
  `

  const val = (id: string) => (document.getElementById(id) as HTMLInputElement).value.trim().replace(/\/+$/, '')

  document.getElementById('s-save')!.addEventListener('click', () => {
    const apiBase = val('s-api')
    const token = (document.getElementById('s-token') as HTMLInputElement).value.trim()
    const sttBase = val('s-stt')
    const err = document.getElementById('s-err')!

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
  document.getElementById('s-demo')!.addEventListener('click', () => {
    saveSettings(bridge, { apiBase: DEMO_BASE, token: DEMO_BASE, sttBase: '' }).then(onDone)
  })
}
