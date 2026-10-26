import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'
import { mergeConfig } from 'vite'
import webConfig from '../vite.web.config'

export default mergeConfig(webConfig, {
  plugins: [
    {
      name: 'harmony-native-bootstrap',
      transformIndexHtml: {
        order: 'pre',
        handler(html) {
          const source = readFileSync(resolve('src/renderer/src/harmony/bootstrap.ts'), 'utf8')
          const script = transformSync(source, {
            loader: 'ts',
            format: 'iife',
            target: 'chrome120'
          }).code
          return html.replace(
            '<script src="./harmony-bootstrap.js"></script>',
            `<script>${script}</script>`
          )
        }
      }
    }
  ],
  build: {
    outDir: resolve('native/harmonyos/.local/renderer-build'),
    cssCodeSplit: false,
    modulePreload: false,
    rollupOptions: { input: resolve('src/renderer/harmony-index.html') }
  }
})
