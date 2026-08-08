# STT(3458) の死活＋認識までを1発で確認する。
# Windows標準のSAPIで日本語を合成 → 16kHz/mono/16bit の生PCMにして POST /transcribe。
# 期待した語が返れば PASS。グラスの「音声入力が認識しない」と同じ経路を叩く。
#
# 使い方: powershell -NoProfile -File check_stt.ps1
# 終了コード: 0=PASS / 1=FAIL

$ErrorActionPreference = "Stop"
$Base   = if ($env:STT_BASE) { $env:STT_BASE } else { "http://127.0.0.1:3458" }
$Phrase = "きょうはいいてんきです"
$Expect = "天気"          # 認識できていれば必ず入る語
$Wav    = Join-Path $env:TEMP "stt_check.wav"

function Fail($msg) { Write-Host "FAIL: $msg" -ForegroundColor Red; exit 1 }

# 1) 合成（16000Hz / 16bit / mono ＝ グラスのマイクと同じ形式）
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer

# 既定の音声は en-US（Zira）のことがある。英語ボイスに仮名を読ませると
# 音は出るのに Whisper が空を返す＝サーバが壊れていると誤診する。必ず ja-JP を選ぶ。
$ja = $synth.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -eq "ja-JP" } | Select-Object -First 1
if (-not $ja) { Fail "日本語のSAPI音声が無い。設定→時刻と言語→音声認識 で日本語音声を追加する" }
$synth.SelectVoice($ja.VoiceInfo.Name)

$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, `
        [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, `
        [System.Speech.AudioFormat.AudioChannel]::Mono)
$synth.SetOutputToWaveFile($Wav, $fmt)
$synth.Speak($Phrase)
$synth.Dispose()

$bytes = [IO.File]::ReadAllBytes($Wav)
if ($bytes.Length -lt 3200) { Fail "合成に失敗（$($bytes.Length) bytes）。日本語音声が入っていない可能性" }

# WAVヘッダ(44byte)を落として生PCMにする。stt_server.py は生のint16 LEを受け取る。
# ⚠ $bytes[44..N] は Object[] になり、Invoke-RestMethod がこれを「数値を並べた文字列」として
#    送ってしまう（サーバは200を返すが中身はノイズ扱いで text が空になる）。必ず byte[] に詰め直す。
$pcm = New-Object byte[] ($bytes.Length - 44)
[Array]::Copy($bytes, 44, $pcm, 0, $pcm.Length)

# 2) POST（サーバが死んでいればここで接続拒否＝RED）
try {
    $res = Invoke-RestMethod -Uri "$Base/transcribe" -Method Post -Body $pcm `
            -ContentType "application/octet-stream" -TimeoutSec 60
} catch {
    Fail "POST $Base/transcribe に到達できず: $($_.Exception.Message)"
}

# 3) 認識できたか（ここが本命。200が返るだけでは合格にしない）
$text = "$($res.text)"
if ([string]::IsNullOrWhiteSpace($text)) { Fail "200は返ったが text が空。モデルがロードできていない可能性" }
if ($text -notmatch $Expect)             { Fail "認識はしたが期待と違う。得た text: 「$text」（期待: $Expect を含む）" }

Write-Host "PASS: 「$text」" -ForegroundColor Green
exit 0
