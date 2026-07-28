# Privacy Policy — Claude Code Remote

Last updated: 2026-07-28

Claude Code Remote is an unofficial, personal open-source project. It is not affiliated with Anthropic or Even Realities.

## Short version

The developer receives nothing. The app talks only to a server address that you enter yourself, and it stores your settings only on your own phone.

## What the app collects

**Nothing is sent to the developer.** There is no analytics, no crash reporting, no telemetry, and no
backend operated by the developer. There is no account and nothing to sign up for.

## Where your data goes

| Data | Where it goes | Stored by the developer? |
|---|---|---|
| Server URL and access token you enter | Saved in the Even Realities App's local storage on your phone | No |
| Claude Code session titles and response text | Fetched from the server you specified, shown on your glasses | No |
| Voice recordings (only if you enable voice replies) | Sent to the speech-to-text server you specified, converted to text, then discarded | No |
| Text you send as a reply | Sent to the server you specified | No |

Every destination in that table is a machine **you** chose and control. The app cannot send data
anywhere else: the Even Hub platform blocks any network destination that is not in the app's declared
whitelist, and that whitelist contains only tunnel providers used to reach your own computer.

## Permissions the app requests

**Network** — to reach the Claude Code bridge running on your own computer, through the tunnel URL you
provide. Used only to read session state and to send your replies.

**Glasses microphone (`g2-microphone`)** — only used when you start a voice reply. Audio is captured
while you are recording, sent to the speech-to-text server address you entered, and discarded once it
has been converted to text. If you leave the voice server field empty, the microphone is never used
and the permission is never invoked.

## Deleting your data

Uninstalling the app removes the stored settings from your phone. Anything else lives on your own
computer, and you delete it the way you would delete any other file there.

## Security note

Exposing your computer through a tunnel makes it reachable from the public internet. The access token
is the only thing preventing someone else from using it. Keep the token secret and shut the tunnel
down when you are not using the app.

## Contact

Questions, or a privacy problem to report: <https://github.com/soran0806/claude-code-remote/issues>

---

# プライバシーポリシー — Claude Code Remote

最終更新: 2026年7月28日

本アプリは個人が開発した非公式のオープンソースソフトウェアです。Anthropic 社および Even Realities 社とは関係ありません。

## 要約

開発者は何も受け取りません。アプリが通信するのは、あなた自身が入力したサーバーのアドレスだけです。設定はあなたのスマートフォン内にのみ保存されます。

## 収集する情報

**開発者に送信される情報はありません。** 解析ツール、クラッシュレポート、利用統計の送信は一切行っていません。開発者が運営するサーバーも存在しません。アカウント登録もありません。

## データの流れ

| データ | 送信先 | 開発者による保存 |
|---|---|---|
| 入力したサーバーURLとトークン | スマートフォン内（Evenアプリのローカルストレージ） | なし |
| セッション名・応答テキスト | あなたが指定したサーバーから取得し、グラスに表示 | なし |
| 音声（音声返信を有効にした場合のみ） | あなたが指定した音声認識サーバーへ送信し、文字化後に破棄 | なし |
| 返信として送信したテキスト | あなたが指定したサーバー | なし |

上記の送信先はすべて、**あなたが選んで管理している機器**です。それ以外の場所へ送ることはできません。
Even Hub の仕組み上、アプリの宣言した接続先リストに無い宛先はプラットフォーム側でブロックされ、
そのリストには自分のPCへ到達するためのトンネル業者しか含まれていません。

## 要求する権限

**ネットワーク** — あなたが指定したトンネルURL経由で、自分のPCで動いている Claude Code に接続するために使用します。セッション状態の取得と返信の送信以外には使いません。

**グラスのマイク（`g2-microphone`）** — 音声返信を開始したときにのみ使用します。録音中の音声はあなたが入力した音声認識サーバーへ送られ、文字に変換された時点で破棄されます。音声サーバーの欄を空にしている場合、マイクは一度も使用されません。

## データの削除

アプリをアンインストールすると、スマートフォンに保存された設定は削除されます。それ以外のデータはあなたのPC上にあり、通常のファイルと同じように削除できます。

## セキュリティに関する注意

トンネルでPCを公開すると、インターネットから到達できる状態になります。第三者の利用を防いでいるのはアクセストークンだけです。トークンは他人に見せず、使わないときはトンネルを停止してください。

## 問い合わせ

<https://github.com/soran0806/claude-code-remote/issues>

---

# 隐私政策 — Claude Code Remote

最后更新：2026年7月28日

本应用是个人开发的非官方开源软件，与 Anthropic 和 Even Realities 均无关联。

## 摘要

开发者不会收到任何数据。应用只与你自己填写的服务器地址通信，设置仅保存在你的手机上。

## 收集的信息

**不会向开发者发送任何信息。** 没有分析统计、崩溃上报或遥测数据，也不存在开发者运营的服务器，无需注册账号。

## 数据流向

| 数据 | 去向 | 开发者是否保存 |
|---|---|---|
| 你填写的服务器网址与令牌 | 保存在手机上（Even 应用的本地存储） | 否 |
| 会话名称与回复文本 | 从你指定的服务器获取并显示在眼镜上 | 否 |
| 语音（仅在启用语音回复时） | 发送至你指定的语音识别服务器，转成文字后即丢弃 | 否 |
| 你发送的回复文本 | 你指定的服务器 | 否 |

上述所有去向都是**由你选择并掌控的设备**。应用无法把数据发往其他地方：Even Hub 平台会拦截
不在应用声明白名单中的任何网络目标，而该白名单只包含用于连接你自己电脑的隧道服务商。

## 申请的权限

**网络** — 通过你提供的隧道网址连接运行在你自己电脑上的 Claude Code，仅用于读取会话状态和发送回复。

**眼镜麦克风（`g2-microphone`）** — 仅在你开始语音回复时使用。录音会发送到你填写的语音识别服务器，转成文字后即被丢弃。若语音服务器一栏留空，则麦克风永远不会被使用。

## 删除数据

卸载应用即可删除手机上保存的设置。其余数据都在你自己的电脑上，按普通文件删除即可。

## 安全提示

通过隧道暴露电脑后，它就能从公网访问。阻止他人使用的只有访问令牌。请妥善保管令牌，不使用时关闭隧道。

## 联系方式

<https://github.com/soran0806/claude-code-remote/issues>
