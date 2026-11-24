// ターミナルで開いとる Claude Code に、キー入力として文を届ける。
// 実体は stt/stt_server.py の --inject（AttachConsole + WriteConsoleInputW）。Windows 専用。
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HELPER = join(dirname(fileURLToPath(import.meta.url)), '..', 'stt', 'stt_server.py')

export function injectText(pid, text, { python = 'python', helper = HELPER } = {}) {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') return reject(new Error('ターミナルへの入力は Windows でしか使えん'))
    const p = spawn(python, [helper, '--inject', String(pid)], { windowsHide: true })
    let err = ''
    const timer = setTimeout(() => { p.kill(); reject(new Error('inject timeout')) }, 15_000)
    p.stderr.on('data', d => { err += d })
    p.on('error', e => { clearTimeout(timer); reject(e) })
    p.on('close', code => {
      clearTimeout(timer)
      code === 0 ? resolve() : reject(new Error(err.trim() || `inject exit ${code}`))
    })
    p.stdin.end(Buffer.from(text, 'utf8'))
  })
}
