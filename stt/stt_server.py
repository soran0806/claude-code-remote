# 黒子モニタ用ローカルSTTサーバ。G2グラスのマイクPCM(s16le/16kHz/mono)を受けて日本語テキストを返す。
# --inject <pid> モード: 標準入力のテキストを対象プロセスのコンソール入力バッファに書き込む
# （ターミナルで開いとるclaudeセッションへのフォークなし送信用）
import os
import subprocess
import sys
import time
import types


def do_inject(pid: int) -> None:
    """AttachConsole + WriteConsoleInputW でテキスト+Enterをキー入力として注入する"""
    import ctypes
    from ctypes import wintypes

    text = sys.stdin.buffer.read().decode("utf-8").replace("\r", " ").replace("\n", " ")
    k32 = ctypes.windll.kernel32
    k32.FreeConsole()
    if not k32.AttachConsole(pid):
        sys.exit(f"AttachConsole({pid}) failed: {k32.GetLastError()}")
    h = k32.CreateFileW("CONIN$", 0xC0000000, 3, None, 3, 0, None)
    if h == wintypes.HANDLE(-1).value:
        sys.exit("CONIN$ open failed")

    class KeyEvent(ctypes.Structure):
        _fields_ = [
            ("bKeyDown", wintypes.BOOL), ("wRepeatCount", wintypes.WORD),
            ("wVirtualKeyCode", wintypes.WORD), ("wVirtualScanCode", wintypes.WORD),
            ("UnicodeChar", wintypes.WCHAR), ("dwControlKeyState", wintypes.DWORD),
        ]

    class InputRecord(ctypes.Structure):
        _fields_ = [("EventType", wintypes.WORD), ("KeyEvent", KeyEvent)]

    def write(records):
        arr = (InputRecord * len(records))(*records)
        written = wintypes.DWORD()
        if not k32.WriteConsoleInputW(h, arr, len(records), ctypes.byref(written)):
            sys.exit(f"WriteConsoleInputW failed: {k32.GetLastError()}")

    def keys(ch, vk=0):
        return [InputRecord(1, KeyEvent(down, 1, vk, 0, ch, 0)) for down in (1, 0)]

    write([r for ch in text for r in keys(ch)])
    time.sleep(0.2)  # 貼り付け判定と分離してからEnterで送信
    write(keys("\r", 0x0D))


def find_claude_pids() -> list[int]:
    """対話中のclaude.exeを探す（even-terminal配下のSDK版は除外）"""
    # ブラックリストだと将来同名プロセス(Claude Desktopアプリのclaude.exe等)が増えるたび
    # 誤爆するため、本物のターミナルCLIの実体パスでホワイトリスト指定する
    ps = (
        "Get-CimInstance Win32_Process -Filter \"Name='claude.exe'\" | "
        "Where-Object { $_.CommandLine -like '*\\.local\\bin\\claude.exe*' } | "
        "Select-Object -ExpandProperty ProcessId"
    )
    out = subprocess.run(
        ["powershell", "-NoProfile", "-Command", ps],
        capture_output=True, text=True, timeout=20,
    ).stdout.split()
    return [int(x) for x in out]


if len(sys.argv) >= 3 and sys.argv[1] == "--inject":
    do_inject(int(sys.argv[2]))
    sys.exit(0)

# ponytail: avはSmart App ControlにDLLブロックされるが、音声ファイルのデコード専用で
# 生PCM直入れの本サーバでは不要。import文だけ満たすダミーを差し込む
sys.modules["av"] = types.ModuleType("av")

from flask import Flask, request, jsonify
import numpy as np
from faster_whisper import WhisperModel

# ponytail: CPU int8のsmallモデル。遅い/精度不足ならdevice="cuda"(要cuDNN)+mediumに上げる
model = WhisperModel("small", device="cpu", compute_type="int8")
app = Flask(__name__)


@app.after_request
def cors(r):
    r.headers["Access-Control-Allow-Origin"] = "*"
    r.headers["Access-Control-Allow-Headers"] = "*"
    return r


@app.route("/transcribe", methods=["POST", "OPTIONS"])
def transcribe():
    if request.method == "OPTIONS":
        return ""
    raw = request.get_data()
    if len(raw) < 3200:  # 0.1秒未満は無音扱い
        return jsonify({"text": ""})
    pcm = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    segments, _ = model.transcribe(pcm, language="ja", beam_size=5)
    text = "".join(s.text for s in segments).strip()
    return jsonify({"text": text})


def last_entrypoint(path) -> str | None:
    """JSONL末尾64KBから最後の entrypoint 値を拾う（cli=ターミナル駆動 / sdk-cli=even-terminal駆動）"""
    import re
    try:
        with open(path, "rb") as f:
            f.seek(0, 2)
            f.seek(max(0, f.tell() - 65536))
            tail = f.read().decode("utf-8", errors="replace")
        hits = re.findall(r'"entrypoint":"([^"]+)"', tail)
        return hits[-1] if hits else None
    except OSError:
        return None


# 接続情報は公開リポジトリに入れられんので外部ファイルから読む。
# 書式は KEY=VALUE の1行ずつ。EVEN_TOKEN は start-hidden.vbs の -t と同じ値にすること。
ENV_FILE = os.path.join(os.path.expanduser("~"), ".even-terminal", "kuroko.env")


def _env():
    kv = {}
    try:
        with open(ENV_FILE, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    kv[k.strip()] = v.strip()
    except OSError:
        sys.exit(f"設定ファイルが無い: {ENV_FILE}\nEVEN_TOKEN と EVEN_CWD を書く")
    for key in ("EVEN_TOKEN", "EVEN_CWD"):
        if not kv.get(key):
            sys.exit(f"{ENV_FILE} に {key} が無い")
    return kv


_CONF = _env()
DEFAULT_CWD = _CONF["EVEN_CWD"]
EVEN_TOKEN = _CONF["EVEN_TOKEN"]


def project_dir(cwd: str):
    from pathlib import Path
    import re
    return Path.home() / ".claude" / "projects" / re.sub(r"[^A-Za-z0-9]", "-", cwd)


@app.route("/inject", methods=["POST", "OPTIONS"])
def inject():
    if request.method == "OPTIONS":
        return ""
    data = request.get_json() or {}
    text = data.get("text", "").strip()
    sid = data.get("sessionId", "")
    cwd = data.get("cwd", "")
    if not text:
        return jsonify({"error": "text required"}), 400

    # sessionId省略＝点呼スケジューラ/iPhoneショートカット由来（向こうはIDを知りようがない）。
    # グラスのアプリは必ずsessionIdを送ってくる。
    # この違いで失敗時の振る舞いを変える:
    #   auto=True  → サーバ側で /api/prompt にフォールバックする（無言で消させない）
    #   auto=False → 従来どおり409を返す。グラス側 deliver() が自分でフォールバックし、
    #                新セッションIDを自分で追跡する作りなので、ここで200を返すと追跡が壊れる
    auto = not sid

    def give_up(why, code=409):
        return prompt_fallback(text, cwd, why) if auto else (jsonify({"error": why}), code)

    if auto:
        cwd = cwd or DEFAULT_CWD
        cli_files = [p for p in project_dir(cwd).glob("*.jsonl") if last_entrypoint(p) == "cli"]
        if not cli_files:
            return give_up("no-terminal-session")
        sid = max(cli_files, key=lambda p: p.stat().st_mtime).stem
    if not cwd:
        return jsonify({"error": "cwd required"}), 400

    # 注入してええのは「ターミナルで開いとるセッション」だけ。
    # 判定: 対象JSONLの最終entrypointがcli、かつプロジェクト内で最新のcliセッション
    proj = project_dir(cwd)
    target = proj / f"{sid}.jsonl"
    if not target.exists() or last_entrypoint(target) != "cli":
        return give_up("not-terminal-session")
    cli_files = [p for p in proj.glob("*.jsonl") if last_entrypoint(p) == "cli"]
    newest = max(cli_files, key=lambda p: p.stat().st_mtime)
    if newest != target:
        # 古い（閉じた）ターミナルセッション宛て → 今開いとるターミナルに誤爆させない
        return give_up("not-active-terminal-session")

    pids = find_claude_pids()
    # ponytail: ターミナル1個前提。複数開いたらどれか特定できんので拒否（必要になったらpid指定APIに拡張）
    if len(pids) != 1:
        return give_up(f"claude terminal count = {len(pids)}")
    import time
    t0 = time.time() - 2      # ファイル時刻の誤差ぶん少し前から見る
    r = subprocess.run(
        [sys.executable, __file__, "--inject", str(pids[0])],
        input=text.encode("utf-8"), capture_output=True, timeout=15,
    )
    if r.returncode != 0:
        return give_up(r.stderr.decode("utf-8", errors="replace"), 500)
    # 注入が成功しても着弾したとは限らん。ターミナルが選択UI（承認プロンプト・質問・
    # スラッシュコマンド補完）を出しとると、キー入力がそっちに食われてEnterが
    # 選択の決定に消える＝プロンプトにならん。無言で消えるのが一番タチ悪いので実際に確認する。
    if landed(proj, t0, text):
        return jsonify({"ok": True, "pid": pids[0], "via": "inject"})
    return give_up("注入したがJSONLに現れず（選択UIに食われた可能性）")


def landed(proj, t0, text, timeout=10.0):
    """注入したテキストがどれかのセッションに現れるまで待つ。

    target 1本だけを見張ると、ターミナルを閉じて開き直した直後（新セッションの
    JSONLがまだ無く、targetが古い方を指している）に誤って「着弾せず」と判定して
    フォールバックし、同じ点呼が2回届く。プロジェクト内の更新されたJSONLを全部見る。
    """
    import time
    needle = text[:20]
    deadline = time.time() + timeout
    while time.time() < deadline:
        time.sleep(0.5)
        for p in proj.glob("*.jsonl"):
            try:
                if p.stat().st_mtime < t0:
                    continue
                with open(p, "rb") as f:
                    f.seek(max(0, f.seek(0, 2) - 262144))
                    if needle in f.read().decode("utf-8", errors="replace"):
                        return True
            except OSError:
                pass
    return False


def prompt_fallback(text, cwd, why):
    """even-terminal に新規セッションとして投げる。ターミナルには出ないがグラスの一覧には出る。"""
    import json
    import urllib.request
    body = json.dumps({"text": text, "cwd": cwd or DEFAULT_CWD}).encode("utf-8")
    req = urllib.request.Request(
        "http://127.0.0.1:3456/api/prompt", data=body, method="POST",
        headers={"Content-Type": "application/json",
                 "Authorization": f"Bearer {EVEN_TOKEN}"})
    try:
        with urllib.request.urlopen(req, timeout=20) as res:
            sid = json.load(res).get("sessionId")
        return jsonify({"ok": True, "via": "prompt-fallback", "sessionId": sid, "why": why})
    except Exception as e:
        return jsonify({"error": f"inject失敗({why}) かつ fallbackも失敗: {e}"}), 502


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=3458)
