// dist を消してビルド → URL 検査 → パック。どれかが落ちたら止まる（古い dist をパックしない）
// ponytail: evenhub-cli 0.1.13 に --sdk-ver は無い（main.js 実読）。付けると未知オプションで落ちる。CLI更新後に再確認
import { rmSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const run = (cmd) => {
  const r = spawnSync(cmd, { stdio: 'inherit', shell: true })
  if (r.status !== 0) process.exit(r.status || 1)
}
const { version } = JSON.parse(readFileSync('app.json', 'utf8'))
rmSync('dist', { recursive: true, force: true })
run('npm run build')
run('npm run check:urls')
run(`npx evenhub pack app.json dist -o claude-code-remote-${version}.ehpk`)
