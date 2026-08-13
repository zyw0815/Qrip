// Cross-platform post-compile step for the Electron main process:
// rename .js -> .cjs (project is ESM, Electron needs CJS) and rewrite
// the preload path reference. Replaces the sed/mv chain that only
// worked on macOS.
const fs = require('fs')

for (const base of ['main', 'preload']) {
  fs.renameSync(`dist-electron/${base}.js`, `dist-electron/${base}.cjs`)
}

let src = fs.readFileSync('dist-electron/main.cjs', 'utf8')
src = src.replace(/preload\.js/g, 'preload.cjs')
fs.writeFileSync('dist-electron/main.cjs', src)
console.log('electron main compiled: .cjs renamed, preload path rewritten')
