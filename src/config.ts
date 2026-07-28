// 接続設定。トークン等は本番配布(.ehpk)にハードコードしないため、
// Evenアプリのローカルストレージから読み込む可変値にしてある（settings.tsが埋める）。
export const cfg = {
  apiBase: '',
  token: '',
  sttBase: '',
}
export const POLL_MS = 5000
export const MAX_RECORD_MS = 60000
