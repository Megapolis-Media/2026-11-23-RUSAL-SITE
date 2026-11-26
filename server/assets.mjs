const extension = /\.(html|css|js|webp|jpg|png|svg|woff2|mp4)$/
const allowed = /^\/(?:index\.html|admin\.html|[\w-]+\.(?:css|js)|assets\/[\w-]+\.(?:webp|jpg|png|svg|woff2|mp4))$/
const types = {
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  webp: 'image/webp',
  jpg: 'image/jpeg',
  png: 'image/png',
  svg: 'image/svg+xml',
  woff2: 'font/woff2',
  mp4: 'video/mp4',
}

export function videoAssetResponse(bytes, method, headers, range) {
  const length = bytes.byteLength
  const responseHeaders = { ...headers, 'Accept-Ranges': 'bytes', 'Content-Length': String(length) }
  if (method === 'HEAD') return new Response(null, { headers: responseHeaders })

  const match = /^bytes=(\d*)-(\d*)$/i.exec(range || '')
  if (!match || (!match[1] && !match[2])) return new Response(bytes, { headers: responseHeaders })
  const [, first, last] = match
  const start = first ? Number(first) : Math.max(0, length - Number(last))
  const end = first && last ? Math.min(Number(last), length - 1) : length - 1
  if (start > end) {
    responseHeaders['Content-Range'] = `bytes */${length}`
    responseHeaders['Content-Length'] = '0'
    return new Response(null, { status: 416, headers: responseHeaders })
  }
  responseHeaders['Content-Range'] = `bytes ${start}-${end}/${length}`
  responseHeaders['Content-Length'] = String(end - start + 1)
  return new Response(bytes.subarray(start, end + 1), { status: 206, headers: responseHeaders })
}
export function entryFor(path) {
  if (path === '/') return '/index.html'
  if (path === '/admin' || path === '/admin/') return '/admin.html'
  return allowed.test(path) ? path : null
}
export function assetHeaders(entry, headers) {
  const ext = entry.match(extension)?.[1]
  return {
    ...headers,
    'Content-Type': types[ext],
    'Cache-Control': entry.startsWith('/assets/') ? 'public, max-age=3600' : 'no-cache',
  }
}
