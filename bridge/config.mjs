// 設定は今までと同じ ~/.even-terminal/kuroko.env から読む（KEY=VALUE を1行ずつ）。
//   EVEN_TOKEN   必須。グラスのアプリに入れるのと同じトークン
//   BRIDGE_PORT  待ち受けポート（既定 3460）
//   BRIDGE_HOST  待ち受けアドレス（既定 127.0.0.1。外からはトンネル経由で届く）
//   STT_URL      音声認識サーバ（既定 http://127.0.0.1:3458）
//   PYTHON       キー入力の注入に使う Python（既定 python）
//   PERMISSION_WAIT_SEC  承認をグラスで待つ秒数（既定 45）
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

export const ENV_FILE = process.env.KUROKO_ENV ?? join(homedir(), '.even-terminal', 'kuroko.env')

export function parseEnv(text) {
  const kv = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || !line.includes('=')) continue
    const i = line.indexOf('=')
    kv[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return kv
}

export function loadConfig(file = ENV_FILE) {
  let kv = {}
  try { kv = parseEnv(readFileSync(file, 'utf8')) } catch { /* 無ければ既定値＋環境変数 */ }
  const get = k => process.env[k] ?? kv[k]
  return {
    token: get('EVEN_TOKEN') ?? '',
    port: Number(get('BRIDGE_PORT') ?? 3460),
    host: get('BRIDGE_HOST') ?? '127.0.0.1',
    sttUrl: (get('STT_URL') ?? 'http://127.0.0.1:3458').replace(/\/$/, ''),
    python: get('PYTHON') ?? 'python',
    permissionWaitMs: Number(get('PERMISSION_WAIT_SEC') ?? 45) * 1000,
  }
}
