import { mkdir, rm } from 'node:fs/promises'

const targets = [
  ['bun-linux-x64', 'sofeed-linux-x64'],
  ['bun-linux-arm64', 'sofeed-linux-arm64'],
  ['bun-darwin-x64', 'sofeed-macos-x64'],
  ['bun-darwin-arm64', 'sofeed-macos-arm64'],
  ['bun-windows-x64', 'sofeed-windows-x64.exe'],
] as const
await mkdir('dist', { recursive: true })
for (const [target, name] of targets) {
  const process = Bun.spawn(['bun', 'build', '--compile', '--minify', `--target=${target}`, `--outfile=dist/${name}`,
    'src/cli.tsx'], { stdout: 'inherit', stderr: 'inherit' })
  if (await process.exited) throw new Error(`Build failed for ${target}`)
}
const checksum = Bun.spawn(['sha256sum', ...targets.map(([, name]) => `dist/${name}`)], {
  stdout: Bun.file('dist/SHA256SUMS'),
  stderr: 'inherit',
})
if (await checksum.exited) throw new Error('Checksum generation failed')
