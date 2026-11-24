# ブリッジ（PC側）

グラスのアプリと、PCで開いとる Claude Code の間に立つ常駐プログラム。依存パッケージ無し、Node.js 18 以上で動く。

## 何をするか

- ターミナルで普段どおり `claude` で開いたセッションが、フック経由で「どのセッションが・どのプロセスか」をここに名乗る。
  同じフォルダで何個開いとっても、送り先を取り違えん。
- ターミナルの承認待ちをグラスに出し、許可・拒否を返す。誰も見とらん時や時間切れの時は、いつもの確認がターミナルに出る。
- 状態の変化（実行中・完了・承認待ち）を `/api/events` で即座に流す。
- 音声認識は今までの `stt/stt_server.py` に中継する（アプリの接続先を1つにするため）。

## 使い方

設定は今までと同じ `~/.even-terminal/kuroko.env`。`EVEN_TOKEN` だけ必須。

```
node bridge/server.mjs              # 起動（既定で 127.0.0.1:3460）
node bridge/install-hooks.mjs       # Claude Code にフックを登録（settings.json の控えを取る）
node bridge/install-hooks.mjs --remove   # 取り外し
node --test bridge/test/*.test.mjs  # テスト
```

追加で書ける設定: `BRIDGE_PORT`、`BRIDGE_HOST`、`STT_URL`、`PYTHON`、`PERMISSION_WAIT_SEC`（承認をグラスで待つ秒数、既定45）。

## 安全側の作り

- フックはブリッジが落ちとる時、何も出さずにすぐ終わる。Claude Code は普段どおり動く。
- 全ての口でトークンを確かめる（トンネル越しの要求も 127.0.0.1 から来るので、接続元では見分けん）。
- 承認待ちの間は送信を断る。入力が選択画面に食われるため。
- 送信は「打ち込んだ」で終わらせず、Claude Code が実際に受け取った通知（UserPromptSubmit）が来るまで確かめる。

## API

| | |
|---|---|
| `GET /api/sessions` | 開いとるセッション（承認待ち→実行中→待機の順）＋最近の記録 |
| `GET /api/sessions/:id/history?tools=1` | 会話。`tools=1` でツール実行を1行に畳んで混ぜる |
| `GET /api/events` | 変化の即時配信（SSE） |
| `GET /api/messages?sessionId=` | 承認待ち（旧アプリ互換の形） |
| `POST /api/permission-response` | `{sessionId, decision: allow\|allowAlways\|deny}` |
| `POST /api/prompt`、`POST /inject` | `{sessionId, text}` をターミナルへ届ける |
| `POST /transcribe` | 音声認識サーバへ中継 |
