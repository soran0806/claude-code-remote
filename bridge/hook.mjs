#!/usr/bin/env node
// Claude Code のフックから呼ばれる小さな中継役。標準入力の JSON をブリッジに渡し、返事があれば標準出力へ書く。
// 大原則: ブリッジが落ちとる・遅い時は何も出さずに 0 で終わる（＝Claude Code は普段どおり動く）。
import http from 'node:http'
import { loadConfig } from './config.mjs'

const event = process.argv[2]
if (!event) process.exit(0)
const cfg = loadConfig()
// 承認だけはグラスの返事を待つ。他は投げっぱなしで即終了
const blocking = event === 'PermissionRequest'
// 初回だけブリッジがプロセスを特定するのに1秒ほどかかるので、投げっぱなし側も少し待つ
const timeoutMs = blocking ? cfg.permissionWaitMs + 5_000 : 5_000

let buf = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', c => { buf += c })
process.stdin.on('end', () => {
  let input
  try { input = JSON.parse(buf || '{}') } catch { process.exit(0) }
  const body = JSON.stringify({ event, input, pid: process.pid, ppid: process.ppid })
  const req = http.request({
    host: '127.0.0.1', port: cfg.port, path: '/hook', method: 'POST', timeout: timeoutMs,
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), Authorization: `Bearer ${cfg.token}` },
  }, res => {
    let out = ''
    res.setEncoding('utf8')
    res.on('data', c => { out += c })
    res.on('end', () => {
      if (res.statusCode === 200 && out.trim()) process.stdout.write(out)
      process.exit(0)
    })
  })
  req.on('error', () => process.exit(0))
  req.on('timeout', () => { req.destroy(); process.exit(0) })
  req.end(body)
})
