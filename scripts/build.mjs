import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'

async function assetsFrom(dir, prefix = '') {
  const assets = {}
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const location = dir + '/' + entry.name
    const path = prefix + '/' + entry.name
    if (entry.isDirectory()) Object.assign(assets, await assetsFrom(location, path))
    else assets[path] = (await readFile(location)).toString('base64')
  }
  return assets
}

const assets = await assetsFrom('public')
for (const asset of [
  '/index.html', '/app.js', '/carriage-motion.js', '/carriage-motion.css',
  '/assets/express-carriage.webp', '/assets/new-year-express.mp4', '/assets/new-year-express-start.jpg',
  '/assets/new-year-express-still.jpg', '/assets/train.webp',
  '/assets/holiday-broadcast-table-invitation.webp', '/assets/chat-compartment.jpg',
  '/assets/carriage-trim.png', '/assets/carriage-hd-left.jpg', '/assets/carriage-hd-right.jpg',
  '/assets/prediction-landscape-v2.jpg', '/assets/prediction-frame.png', '/assets/prediction-wagon.png',
  '/assets/paper-corner.png',
  '/assets/great-vibes-cyrillic.woff2', '/assets/great-vibes-latin.woff2',
  '/assets/marck-script-cyrillic.woff2', '/assets/marck-script-latin.woff2',
]) {
  if (!assets[asset]) throw Error('Missing asset ' + asset)
}
const worker = (await readFile('server/worker.mjs', 'utf8')).replace('export function', 'function')
const helpers = (await readFile('server/assets.mjs', 'utf8')).replaceAll('export function', 'function')
await mkdir('dist/server', { recursive: true })
await writeFile('dist/server/index.js', worker + '\n' + helpers + '\nconst files = ' + JSON.stringify(assets) + `
export default createWorker((path, method, headers, range) => {
  const entry = entryFor(path)
  const asset = entry && files[entry]
  if (!asset) return null
  if (entry.endsWith('.mp4')) {
    return videoAssetResponse(Uint8Array.from(atob(asset), char => char.charCodeAt(0)), method, assetHeaders(entry, headers), range)
  }
  const data = method === 'HEAD' ? null : Uint8Array.from(atob(asset), char => char.charCodeAt(0))
  return new Response(data, { headers: assetHeaders(entry, headers) })
})
`)
