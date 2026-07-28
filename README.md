# Claude Code Remote

Watch and steer Claude Code running on your own PC — from your Even Realities G2 glasses.

日本語は下 / 中文在下

> **Unofficial.** A personal side project. Not affiliated with, endorsed by, or supported by Anthropic or Even Realities.

---

## English

### What it does

- Lists your Claude Code sessions with their state (running / idle / waiting for approval)
- Shows the full response text on the glasses, scrollable with the ring or temple touchpad
- Approve or deny permission prompts without touching your phone
- Reply by voice (optional — needs a speech-to-text server on your PC)

Everything talks to **your own machine**. There is no server in the middle and no account to create.

### What you need

| | |
|---|---|
| Glasses | Even Realities G2 (R1 ring optional but nicer) |
| PC | Any machine running Claude Code |
| Bridge | [`@evenrealities/even-terminal`](https://www.npmjs.com/package/@evenrealities/even-terminal) on that PC |
| Tunnel | Tailscale Funnel, Cloudflare Tunnel, ngrok or localtunnel |

### Setup

**1. Run the bridge on your PC**

```bash
npm i -g @evenrealities/even-terminal
even-terminal start -p 3456 -t YOUR_SECRET_TOKEN
```

Use a long random string for `YOUR_SECRET_TOKEN`. Anyone holding it can drive Claude Code on your machine.

**2. Expose it**

The app can only reach `https://` URLs on a few tunnel providers, so a LAN IP will not work.
Tailscale Funnel is recommended because the URL survives reboots:

```bash
tailscale funnel 3456
# -> https://your-pc.tailXXXX.ts.net
```

Cloudflare (`cloudflared tunnel --url http://localhost:3456`), ngrok and localtunnel also work,
but their free URLs change on every restart and you will have to paste the new one each time.

**3. Install the app and fill in the form**

On first launch the glasses show a short message and the setup form appears on your phone screen.
Paste the tunnel URL and the token. Leave the voice field empty unless you do step 4.

**4. Voice replies (optional)**

Create `~/.even-terminal/kuroko.env`:

```
EVEN_TOKEN=YOUR_SECRET_TOKEN
EVEN_CWD=C:\path\to\your\project
```

Then run `stt/stt_server.py` (local Whisper, port 3458), expose it the same way, and paste that URL
into the voice field. Skip all of this and everything except voice replies still works.

### Controls

| Gesture | Session list | Reading a session |
|---|---|---|
| Tap | open session | start voice reply |
| Swipe up / down | move selection | scroll |
| Double tap | exit app | menu |

### Security

A tunnel puts your bridge on the public internet. The token is the only thing between a stranger and
your machine — treat it like a password, and close the tunnel when you are not using it.

### Build it yourself

```bash
npm install
npm run build
npx evenhub pack app.json dist -o app.ehpk
```

### Feedback

- [Report a bug or request a feature](https://github.com/soran0806/claude-code-remote/issues/new?template=feedback.yml)
- [Buy me a coffee](https://ko-fi.com/s0r4n)

MIT licensed — see [LICENSE](LICENSE) and the [privacy policy](docs/privacy.md).

---

## 日本語

### できること

- Claude Code のセッション一覧と状態（実行中 / 待機 / 承認待ち）をグラスに表示
- 応答の全文をグラスで読む（リングやテンプルのタッチパッドでスクロール）
- 権限の承認・拒否をスマホを触らずに行う
- 音声で返信する（任意。PC側に音声認識サーバーが要る）

通信先は**自分のPCだけ**。中継サーバーもアカウント登録もない。

### 必要なもの

| | |
|---|---|
| グラス | Even Realities G2（R1リングはあると快適） |
| PC | Claude Code が動いている環境 |
| 橋渡し | そのPCに [`@evenrealities/even-terminal`](https://www.npmjs.com/package/@evenrealities/even-terminal) |
| トンネル | Tailscale Funnel / Cloudflare Tunnel / ngrok / localtunnel |

### セットアップ

**1. PCで橋渡しを動かす**

```bash
npm i -g @evenrealities/even-terminal
even-terminal start -p 3456 -t 好きなトークン
```

トークンは長いランダム文字列にすること。これを知っている人は誰でもあなたのPCのClaude Codeを操作できる。

**2. 外から届くようにする**

アプリが接続できるのは特定のトンネル業者の `https://` URL だけ。自宅LANのIPアドレスでは繋がらない。
**Tailscale Funnel が本命**（再起動してもURLが変わらないため）:

```bash
tailscale funnel 3456
# -> https://your-pc.tailXXXX.ts.net
```

Cloudflare（`cloudflared tunnel --url http://localhost:3456`）、ngrok、localtunnel も使えるが、
無料枠のURLは起動のたびに変わるので毎回貼り直しになる。

**3. アプリを入れてフォームを埋める**

初回起動時、グラスには案内だけが出て、入力フォームはスマホ画面に表示される。
トンネルのURLとトークンを貼る。音声欄は手順4をやらないなら空でよい。

**4. 音声返信（任意）**

`~/.even-terminal/kuroko.env` を作る:

```
EVEN_TOKEN=決めたトークン
EVEN_CWD=C:\プロジェクトのパス
```

そのうえで `stt/stt_server.py` を動かし（ローカルWhisper、ポート3458）、同じようにトンネルで外に出して
URLを音声欄に貼る。やらなくても、音声返信以外は全部動く。

### 操作

| 動作 | 一覧 | セッション表示中 |
|---|---|---|
| タップ | 開く | 音声返信を開始 |
| 上下スワイプ | 選択を移動 | スクロール |
| ダブルタップ | アプリ終了 | メニュー |

### セキュリティ

トンネルを張るとPCがインターネットから届く状態になる。**赤の他人とあなたのPCの間にあるのはトークン1個だけ**。
パスワードと同じ扱いにして、使わないときはトンネルを止めること。

### その他

MIT ライセンス。[LICENSE](LICENSE) と[プライバシーポリシー](docs/privacy.md)を参照。
不具合や要望は [Issues](https://github.com/soran0806/claude-code-remote/issues/new?template=feedback.yml) へ。
気に入ったら [Ko-fi](https://ko-fi.com/s0r4n) で応援してもらえると喜びます。

---

## 中文

### 功能

- 在眼镜上显示 Claude Code 的会话列表与状态（运行中 / 空闲 / 等待批准）
- 在眼镜上阅读完整回复（用戒指或镜腿触控板滚动）
- 不用碰手机即可批准或拒绝权限请求
- 语音回复（可选，需要在电脑上运行语音识别服务器）

只与**你自己的电脑**通信。没有中转服务器，也不需要注册账号。

### 需要准备

| | |
|---|---|
| 眼镜 | Even Realities G2（有 R1 戒指更方便） |
| 电脑 | 运行 Claude Code 的机器 |
| 桥接 | 在该电脑上安装 [`@evenrealities/even-terminal`](https://www.npmjs.com/package/@evenrealities/even-terminal) |
| 隧道 | Tailscale Funnel / Cloudflare Tunnel / ngrok / localtunnel |

### 设置

**1. 在电脑上启动桥接**

```bash
npm i -g @evenrealities/even-terminal
even-terminal start -p 3456 -t 你的令牌
```

令牌请使用足够长的随机字符串。任何拿到它的人都能操作你电脑上的 Claude Code。

**2. 暴露到外网**

应用只能访问特定隧道服务商的 `https://` 网址，局域网 IP 无法连接。
**推荐 Tailscale Funnel**，因为重启后网址不变：

```bash
tailscale funnel 3456
# -> https://your-pc.tailXXXX.ts.net
```

Cloudflare、ngrok、localtunnel 也可以，但免费网址每次重启都会变，需要重新粘贴。

**3. 安装应用并填写表单**

首次启动时眼镜上只显示提示，输入表单会出现在手机屏幕上。
粘贴隧道网址和令牌。如果不做第 4 步，语音栏留空即可。

**4. 语音回复（可选）**

先创建 `~/.even-terminal/kuroko.env`：

```
EVEN_TOKEN=你的令牌
EVEN_CWD=C:\你的项目路径
```

然后运行 `stt/stt_server.py`（本地 Whisper，端口 3458），同样用隧道暴露并把网址填入语音栏。
不做也没关系，除语音回复外的功能都能正常使用。

### 操作

| 手势 | 列表 | 阅读会话时 |
|---|---|---|
| 轻点 | 打开会话 | 开始语音回复 |
| 上下滑动 | 移动选择 | 滚动 |
| 双击 | 退出应用 | 菜单 |

### 安全

建立隧道后，你的电脑就能从公网访问。**陌生人和你的电脑之间只隔着一个令牌**。
请像对待密码一样对待它，不用时关闭隧道。

### 其他

MIT 许可证。参见 [LICENSE](LICENSE) 与[隐私政策](docs/privacy.md)。
问题与建议请提交 [Issues](https://github.com/soran0806/claude-code-remote/issues/new?template=feedback.yml)。
如果觉得有用，欢迎在 [Ko-fi](https://ko-fi.com/s0r4n) 支持开发。
