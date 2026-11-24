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

    # WCHAR は UTF-16 の1単位。絵文字(U+10000以上)は2単位に割って送らんと
    # ctypes が "one character expected" で落ちる（🖤 で実際に落ちた）
    u16 = text.encode("utf-16-le")
    units = [chr(u16[i] | (u16[i + 1] << 8)) for i in range(0, len(u16), 2)]
    write([r for ch in units for r in keys(ch)])
    time.sleep(0.2)  # 貼り付け判定と分離してからEnterで送信
    write(keys("\r", 0x0D))


# 対話用でない claude.exe（-p の単発実行、Remote Control の待ち受け、MCP サーバ等）は
# 打ち込む先にならんので数えん。ここを数えると、ターミナルは1個しか開いとらんのに
# 「ターミナル複数」で送信が止まる
NON_INTERACTIVE_ARGS = (" -p ", " --print", " remote-control", " mcp ", " --output-format", " --sdk")


def find_claude_pids() -> list[int]:
    """対話中のclaude.exeを探す（even-terminal配下のSDK版は除外）"""
    # ブラックリストだと将来同名プロセス(Claude Desktopアプリのclaude.exe等)が増えるたび
    # 誤爆するため、本物のターミナルCLIの実体パスでホワイトリスト指定する
    ps = (
        "Get-CimInstance Win32_Process -Filter \"Name='claude.exe'\" | "
        "Where-Object { $_.CommandLine -like '*\\.local\\bin\\claude.exe*' } | "
        "ForEach-Object { \"$($_.ProcessId)`t$($_.CommandLine)\" }"
    )
    out = subprocess.run(
        ["powershell", "-NoProfile", "-Command", ps],
        capture_output=True, text=True, timeout=20,
    ).stdout.splitlines()
    pids = []
    for line in out:
        pid, _, cmd = line.partition("\t")
        if not pid.strip().isdigit():
            continue
        if any(a in f" {cmd} " for a in NON_INTERACTIVE_ARGS):
            continue
        pids.append(int(pid))
    return pids


def process_cwd(pid: int) -> str | None:
    """他プロセスのカレントディレクトリを PEB から読む（64bit Windows 前提）。取れんかったら None"""
    try:
        import ctypes
        from ctypes import wintypes
        k32 = ctypes.windll.kernel32
        ntdll = ctypes.windll.ntdll
        k32.OpenProcess.restype = wintypes.HANDLE
        k32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        k32.ReadProcessMemory.argtypes = [wintypes.HANDLE, ctypes.c_void_p, ctypes.c_void_p,
                                          ctypes.c_size_t, ctypes.POINTER(ctypes.c_size_t)]
        k32.CloseHandle.argtypes = [wintypes.HANDLE]
        ntdll.NtQueryInformationProcess.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p,
                                                    wintypes.ULONG, ctypes.c_void_p]
        h = k32.OpenProcess(0x0410, False, pid)  # QUERY_INFORMATION | VM_READ
        if not h:
            return None
        try:
            class PBI(ctypes.Structure):
                _fields_ = [("ExitStatus", ctypes.c_void_p), ("PebBaseAddress", ctypes.c_void_p),
                            ("AffinityMask", ctypes.c_void_p), ("BasePriority", ctypes.c_void_p),
                            ("UniqueProcessId", ctypes.c_void_p), ("InheritedFrom", ctypes.c_void_p)]
            pbi = PBI()
            if ntdll.NtQueryInformationProcess(h, 0, ctypes.byref(pbi), ctypes.sizeof(pbi), None) != 0:
                return None

            def read(addr, size):
                buf = ctypes.create_string_buffer(size)
                n = ctypes.c_size_t()
                if not k32.ReadProcessMemory(h, ctypes.c_void_p(addr), buf, size, ctypes.byref(n)):
                    raise OSError("ReadProcessMemory")
                return buf.raw[:n.value]

            # PEB+0x20 = ProcessParameters, その +0x38 = CurrentDirectory.DosPath (UNICODE_STRING)
            params = int.from_bytes(read(pbi.PebBaseAddress + 0x20, 8), "little")
            us = read(params + 0x38, 16)
            length = int.from_bytes(us[0:2], "little")
            buf_addr = int.from_bytes(us[8:16], "little")
            return read(buf_addr, length).decode("utf-16-le").rstrip("\\") or None
        finally:
            k32.CloseHandle(h)
    except Exception:
        return None


def pick_terminal_pid(pids: list[int], cwd: str, cwd_of=process_cwd) -> int | None:
    """注入先を1個に絞る。1個なら即決、複数ならプロジェクトの cwd が一致するものだけ残す。
    それでも1個に決まらんかったら None（どれか分からんまま打ち込むと別プロジェクトに誤爆する）"""
    if len(pids) == 1:
        return pids[0]

    def key(p):
        import re
        return re.sub(r"[^A-Za-z0-9]", "-", p).lower()

    same = [p for p in pids if (c := cwd_of(p)) and key(c) == key(cwd)]
    return same[0] if len(same) == 1 else None


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


# 守りは「どこで待つか」でやる（2026-10-07）。0.0.0.0 やと LAN から /inject が叩けて、
# sessionId 無しなら EVEN_TOKEN 付きで 3456 に中継＝LAN から Claude セッションを立てられた（9/28 レビュー）。
# 127.0.0.1 と Tailscale のアドレスだけで待てば LAN からは繋がらん。tailnet はそらんの端末だけ。
# 一度トークン認証にしたら、トークンを送らんアプリと起床時ショートカットが 10/4 から 401 で全滅した。


@app.after_request
def cors(r):
    r.headers["Access-Control-Allow-Origin"] = "*"
    # * は Authorization を含まん（CORS 仕様）。v0.6.2 以降のアプリはトークンを送ってくる
    r.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    return r


def tailnet_ip() -> str:
    """このPCの Tailscale IPv4。Tailscale が上がっとらんかったら空"""
    exe = r"C:\Program Files\Tailscale\tailscale.exe"
    try:
        out = subprocess.run([exe if os.path.exists(exe) else "tailscale", "ip", "-4"],
                             capture_output=True, text=True, timeout=10).stdout.split()
    except (OSError, subprocess.TimeoutExpired):
        return ""
    return out[0] if out and out[0].startswith("100.") else ""


def serve(port=3458):
    import threading
    from werkzeug.serving import make_server
    ip = tailnet_ip()
    if not ip:
        # 起動直後で Tailscale がまだ。127.0.0.1 だけで上がると番人(ポートを見るだけ)が
        # 正常と見なして iPhone から繋がらんまま固まるので、落ちて5分後の番人に任せる
        sys.exit("Tailscale の IP が取れん")
    servers = [make_server(h, port, app, threaded=True) for h in ("127.0.0.1", ip)]
    for s in servers[1:]:
        threading.Thread(target=s.serve_forever, daemon=True).start()
    print(f"listening 127.0.0.1:{port} {ip}:{port}", flush=True)
    servers[0].serve_forever()


@app.route("/transcribe", methods=["POST", "OPTIONS"])
def transcribe():
    if request.method == "OPTIONS":
        return ""
    raw = request.get_data()
    if len(raw) < 3200:  # 0.1秒未満は無音扱い
        return jsonify({"text": ""})
    pcm = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    return jsonify({"text": stt(pcm)})


def stt(pcm) -> str:
    """無音に対する幻聴（「ご視聴ありがとうございました」等）を落として書き起こす。

    Whisperの学習データがYouTube字幕なので、無音・雑音を食わせると
    字幕の定型句を最尤系列として吐く。VADで無音を切り、
    no_speech_prob が高いセグメントを捨てる。
    """
    segments, _ = model.transcribe(
        pcm,
        language="ja",
        beam_size=5,
        vad_filter=True,  # Silero VADで無音区間をデコーダに渡さない
        condition_on_previous_text=False,  # 幻聴が次のチャンクに伝染するのを断つ
        no_speech_threshold=0.5,
    )
    text = "".join(s.text for s in segments if s.no_speech_prob < 0.5).strip()
    # ponytail: VADをすり抜けた分の保険。増えたらここに足す
    return "" if text in HALLUCINATIONS else text


HALLUCINATIONS = {
    "ご視聴ありがとうございました",
    "ご視聴ありがとうございました。",
    "ありがとうございました",
    "ありがとうございました。",
    "おやすみなさい",
    "おやすみなさい。",
    "チャンネル登録お願いします",
    "チャンネル登録よろしくお願いします",
    "字幕視聴ありがとうございました",
    "エンディング",
    "。",
}


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

    # fork_risk=True は「対象が今動いとる本物のターミナルセッション」やのに注入できんかった場合。
    # ここでグラス側が /api/prompt にフォールバックすると、稼働中セッションへの送信＝
    # フォーク復元になり、返事が別セッションIDに付いてターミナルにも出ん。黙って壊れるより
    # エラーを見せる方がマシなので、クライアントにフォールバック禁止を伝える。
    def give_up(why, code=409, fork_risk=False):
        if auto:
            # 点呼由来。sessionId無しの新規セッションに流すのでフォークにはならない
            return prompt_fallback(text, cwd, why)
        return (jsonify({"error": why, "fork_risk": fork_risk}), code)

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
    if not pids:
        return give_up("claude terminal count = 0", fork_risk=True)
    # ターミナルが複数開いとっても、同じプロジェクトで開いとるのが1個なら そこへ送る
    pid = pick_terminal_pid(pids, cwd)
    if pid is None:
        return give_up(f"claude terminal count = {len(pids)} (same cwd not unique)", fork_risk=True)
    import time
    t0 = time.time() - 2      # ファイル時刻の誤差ぶん少し前から見る
    r = subprocess.run(
        [sys.executable, __file__, "--inject", str(pid)],
        input=text.encode("utf-8"), capture_output=True, timeout=15,
    )
    if r.returncode != 0:
        return give_up(r.stderr.decode("utf-8", errors="replace"), 500, fork_risk=True)
    # 注入が成功しても着弾したとは限らん。ターミナルが選択UI（承認プロンプト・質問・
    # スラッシュコマンド補完）を出しとると、キー入力がそっちに食われてEnterが
    # 選択の決定に消える＝プロンプトにならん。無言で消えるのが一番タチ悪いので実際に確認する。
    if landed(proj, t0, text):
        return jsonify({"ok": True, "pid": pid, "via": "inject"})
    return give_up("注入したがJSONLに現れず（選択UIに食われた可能性）", fork_risk=True)


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
    if "--selftest" in sys.argv:
        # 無音3秒と微小ノイズ3秒。どちらも空文字が返らんかったら幻聴対策が効いてない
        rng = np.random.default_rng(0)
        for name, pcm in [
            ("silence", np.zeros(16000 * 3, dtype=np.float32)),
            ("noise", rng.normal(0, 0.001, 16000 * 3).astype(np.float32)),
        ]:
            got = stt(pcm)
            assert got == "", f"{name}: 幻聴が出た -> {got!r}"
            print(f"ok {name}")
        # プリフライトが Authorization を許すこと（アプリはトークン付きで来る）。/inject は {} で 400 止まり
        c = app.test_client()
        h = c.options("/transcribe").headers["Access-Control-Allow-Headers"]
        assert "Authorization" in h, h
        assert c.post("/inject", json={}).status_code == 400
        assert c.post("/transcribe", data=b"").get_json() == {"text": ""}
        # 注入先の絞り込み: 1個なら即決、複数なら cwd 一致が1個の時だけ
        cwds = {1: r"C:\Users\a\proj", 2: r"C:\Users\a\other", 3: None}
        assert pick_terminal_pid([9], "x", lambda p: None) == 9
        assert pick_terminal_pid([1, 2, 3], r"c:\users\a\proj", cwds.get) == 1
        assert pick_terminal_pid([1, 2], r"C:\Users\a\nope", cwds.get) is None
        assert pick_terminal_pid([1, 1], r"C:\Users\a\proj", cwds.get) is None
        print("ok pick_terminal_pid")
        # 実機: 今動いとる claude.exe の cwd が読めるか（読めんと複数ターミナル時に毎回止まる）
        for p in find_claude_pids():
            print(f"  claude pid={p} cwd={process_cwd(p)}")
        assert tailnet_ip().startswith("100."), "Tailscale の IP が取れん"
        print("ok cors/tailnet")
        sys.exit(0)
    serve()
