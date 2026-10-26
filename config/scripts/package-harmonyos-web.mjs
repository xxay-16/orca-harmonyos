import { build } from 'esbuild'
import { readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'

const source = path.resolve('native/harmonyos/.local/renderer-build')
const target = path.resolve('native/harmonyos/entry/src/main/resources/rawfile/console')
const rawfiles = path.resolve('native/harmonyos/entry/src/main/resources/rawfile')
if (path.dirname(target) !== rawfiles || path.basename(target) !== 'console') {
  throw new Error('Invalid resource destination')
}
await rm(target, { recursive: true, force: true })
await mkdir(target, { recursive: true })
await cp(source, target, { recursive: true })
let html = await readFile(path.join(source, 'harmony-index.html'), 'utf8')
const entry = html.match(/<script[^>]*type="module"[^>]*src="([^"]+)"[^>]*><\/script>/)
if (!entry) {
  throw new Error('The upstream renderer entry was not emitted')
}
const built = await build({
  entryPoints: [path.resolve(source, entry[1])],
  outfile: path.join(target, 'assets/harmony.js'),
  write: false,
  bundle: true,
  minify: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome120',
  define: {
    'import.meta.url': 'globalThis.__ORCA_HARMONY_SCRIPT_URL__',
    'import.meta.resolve': 'undefined'
  }
})
const script = built.outputFiles[0].contents
const digest = createHash('sha256').update(script).digest('hex').slice(0, 12)
const output = `assets/harmony-${digest}.js`
await writeFile(path.join(target, output), script)
html = html
  .replace(
    entry[0],
    `<script>globalThis.__ORCA_HARMONY_SCRIPT_URL__=new URL('./${output}',document.baseURI).href;</script><script defer src="./${output}"></script>`
  )
  .replaceAll(' crossorigin', '')
await writeFile(path.join(target, 'index.html'), html)
console.log('Packaged the original Orca renderer for ArkWeb')
