// electron-builder afterPack hook — runs after the .app bundle is
// assembled but before the dmg is created. Ad-hoc sign the whole
// bundle so Gatekeeper doesn't reject it outright as "damaged".
// (electron-builder skips signing entirely on CI without a certificate;
// an unsigned bundle triggers the harsher "damaged" error on macOS.)
const { execSync } = require('child_process')

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const appPath = `${context.appOutDir}/${context.packager.appInfo.productFilename}.app`
  execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: 'inherit' })
}
