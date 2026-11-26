const LIVE = Date.parse('2026-12-23T08:00:00+03:00')
const REPLAY = Date.parse('2026-12-23T12:00:00+03:00')
const MAX_END = Date.parse('2026-12-19T00:00:00+03:00')
const MAX_PHOTO = 5 * 1024 * 1024
const CHUNK_BYTES = 512 * 1024
const PAGE_SIZE = 30
const moods = new Set(['auto', 'before', 'live', 'replay'])
const idPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow', dateStyle: 'short', timeStyle: 'medium',
})
const radioDefault = 'https://m5m128.hostingradio.ru:8074/m5m128.mp3'
const csp = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; frame-src https://facecast.net https://*.facecast.net https://facecast.ru https://*.facecast.ru; media-src 'self' https:; object-src 'none'; base-uri 'none'; form-action 'self'"
const security = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' }

function rows(db, sql, ...params) {
  return db.prepare(sql).bind(...params).all().then(result => result.results)
}

function first(db, sql, ...params) {
  return db.prepare(sql).bind(...params).first()
}

function change(db, sql, ...params) {
  return db.prepare(sql).bind(...params).run()
}

function fail(status, message) {
  return Response.json({ error: message }, { status, headers: { ...security, 'Cache-Control': 'no-store' } })
}

function json(data, status = 200) {
  return Response.json(data, { status, headers: { ...security, 'Cache-Control': 'no-store' } })
}

function httpsUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password ? url : null
  } catch {
    return null
  }
}

function facecast(value) {
  if (!value) return ''
  const iframeSource = value.match(/<iframe\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/i)?.[1]
  const url = httpsUrl((iframeSource || value).replaceAll('&amp;', '&'))
  return url && /(?:^|\.)facecast\.(net|ru)$/.test(url.hostname) ? url.href : ''
}

async function config(env, now = Date.now()) {
  const saved = env.DB ? Object.fromEntries((await rows(env.DB, 'SELECT name, value FROM settings')).map(row => [row.name, row.value])) : {}
  const manual = saved.phase || env.BROADCAST_PHASE || 'auto'
  const automatic = now >= REPLAY ? 'replay' : now >= LIVE ? 'live' : 'before'
  const phase = moods.has(manual) && manual !== 'auto' ? manual : automatic
  const policyUrl = httpsUrl(env.CHAT_POLICY_URL)?.href || ''
  const consentText = env.CHAT_CONSENT_TEXT?.trim() || ''
  const chatOpen = Boolean(env.DB && policyUrl && consentText && env.CHAT_CONSENT_VERSION && saved.chat !== 'closed' && env.CHAT_ENABLED !== 'false')
  const musicClose = Date.parse(env.MUSIC_CLOSE_AT || '')
  const musicOpen = Boolean(env.DB && phase !== 'replay' && env.MUSIC_ENABLED !== 'false' && !(now >= musicClose))
  return {
    phase, manual, maxOpen: phase !== 'replay' && now < MAX_END, chatOpen, musicOpen,
    consentText, policyUrl, radioUrl: httpsUrl(env.RADIO_STREAM_URL || radioDefault)?.href || radioDefault,
    videoUrl: phase === 'live' ? facecast(env.FACECAST_EMBED_URL || env.FACECAST_EMBED_CODE)
      : phase === 'replay' ? facecast(env.FACECAST_RECORDING_URL || env.FACECAST_RECORDING_EMBED_CODE) : '',
  }
}

function field(data, key, limit) {
  const value = data.get(key)
  if (typeof value !== 'string') return null
  const trimmed = value.replace(/\r\n/g, '\n').trim()
  return trimmed && trimmed.length <= limit ? trimmed : null
}

async function formData(request, maxBytes) {
  const declared = Number(request.headers.get('content-length') || 0)
  if (declared > maxBytes) return null
  const reader = request.body?.getReader()
  if (!reader) return null
  const chunks = []
  let length = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.byteLength
    if (length > maxBytes) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  try {
    return await new Response(new Blob(chunks), {
      headers: { 'Content-Type': request.headers.get('content-type') || '' },
    }).formData()
  } catch {
    return null
  }
}

const encoder = new TextEncoder()
async function digest(text) {
  const value = await crypto.subtle.digest('SHA-256', encoder.encode(text))
  return Array.from(new Uint8Array(value), byte => byte.toString(16).padStart(2, '0')).join('')
}

async function adminAuthorized(request, env) {
  const secret = env.ADMIN_TOKEN
  const authorization = request.headers.get('Authorization') || ''
  if (!secret || authorization.length > 520 || !authorization.startsWith('Bearer ')) return false
  const [expected, actual] = await Promise.all([digest(secret), digest(authorization.slice(7))])
  let mismatch = 0
  for (let i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ actual.charCodeAt(i)
  return mismatch === 0
}

function visitorKey(request) {
  const cookie = request.headers.get('Cookie')?.match(/(?:^|;\s*)rusal_client=([a-f0-9-]{36})(?:;|$)/)?.[1]
  return request.headers.get('oai-authenticated-user-id') || cookie || request.headers.get('CF-Connecting-IP') || 'local'
}

async function rateLimit(request, env, route, seconds, now) {
  const ip = request.headers.get('CF-Connecting-IP') || 'local'
  const client = visitorKey(request)
  const slot = Math.floor(now / (seconds * 1000))
  const day = Math.floor(now / 86400000)
  const visitor = await digest((env.RATE_SALT || env.ADMIN_TOKEN || '') + ':' + day + ':' + ip + ':' + client)
  const result = await env.DB.batch([
    env.DB.prepare('DELETE FROM rate_limits WHERE expires < ?').bind(now),
    env.DB.prepare('INSERT OR IGNORE INTO rate_limits (route, visitor, slot, expires) VALUES (?, ?, ?, ?)')
      .bind(route, visitor, slot, (slot + 2) * seconds * 1000),
  ])
  return result[1].meta.changes > 0
}

async function submitMusic(request, env, now) {
  if (!(await config(env, now)).musicOpen) return fail(403, 'Приём музыкальных заявок закрыт.')
  const data = await formData(request, 8192)
  const song = data && field(data, 'song', 200)
  const id = data?.get('id')
  if (!song || !idPattern.test(id)) return fail(400, 'Укажите песню и исполнителя. Максимум 200 символов.')
  if (await first(env.DB, 'SELECT id FROM music WHERE id = ?', id)) return json({ ok: true })
  if (!await rateLimit(request, env, 'music', 10, now)) return fail(429, 'Подождите несколько секунд и попробуйте снова.')
  const normalized = song.normalize('NFKC').toLocaleLowerCase('ru-RU').replace(/\s+/g, ' ')
  const visitor = await digest((env.RATE_SALT || env.ADMIN_TOKEN || '') + ':music:' + visitorKey(request))
  const result = await change(env.DB, `INSERT OR IGNORE INTO music (id, song, normalized, created, visitor)
    SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM music WHERE normalized = ? AND visitor = ? AND created > ?)`,
    id, song, normalized, now, visitor, normalized, visitor, now - 86400000)
  if (!result.meta.changes && !await first(env.DB, 'SELECT id FROM music WHERE id = ?', id)) {
    return fail(409, 'Такая заявка уже есть.')
  }
  return json({ ok: true }, 201)
}

function photoType(bytes) {
  const starts = (...prefix) => prefix.every((byte, i) => bytes[i] === byte)
  if (starts(255, 216, 255) && bytes.at(-2) === 255 && bytes.at(-1) === 217) return 'image/jpeg'
  if (starts(137, 80, 78, 71, 13, 10, 26, 10) && bytes.length >= 33 &&
      String.fromCharCode(...bytes.slice(12, 16)) === 'IHDR' &&
      String.fromCharCode(...bytes.slice(-8, -4)) === 'IEND') return 'image/png'
  if (bytes.length >= 20 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
      String.fromCharCode(...bytes.slice(8, 15)) === 'WEBPVP8' &&
      new DataView(bytes.buffer, bytes.byteOffset).getUint32(4, true) + 8 === bytes.length) return 'image/webp'
  return ''
}

async function submitChat(request, env, now) {
  if (!(await config(env, now)).chatOpen) return fail(403, 'Отправка сообщений временно закрыта.')
  const data = await formData(request, MAX_PHOTO + 64 * 1024)
  if (!data) return fail(400, 'Проверьте данные формы и размер фотографии.')
  const id = data.get('id')
  const firstName = field(data, 'first', 70)
  const lastName = field(data, 'last', 70)
  const company = field(data, 'company', 150)
  const message = field(data, 'message', 1000)
  if (!idPattern.test(id) || !firstName || !lastName || !company || !message) {
    return fail(400, 'Заполните имя, фамилию, предприятие и сообщение в пределах указанных размеров.')
  }
  if (data.get('consent') !== 'yes') return fail(400, 'Подтвердите согласие на обработку данных.')
  if (await first(env.DB, 'SELECT id FROM messages WHERE id = ?', id)) return json({ ok: true })
  const photo = data.get('photo')
  let bytes = null
  let mime = null
  if (photo !== null) {
    if (!(photo instanceof File) || !photo.size || photo.size > MAX_PHOTO) return fail(400, 'Размер фотографии должен быть не более 5 МБ.')
    bytes = new Uint8Array(await photo.arrayBuffer())
    mime = photoType(bytes)
    if (!mime || mime !== photo.type) return fail(400, 'Фотография должна быть в формате JPG, PNG или WebP.')
  }
  if (!await rateLimit(request, env, 'chat', 8, now)) return fail(429, 'Подождите несколько секунд перед отправкой.')
  const statements = [
    env.DB.prepare('INSERT INTO messages (id, first, last, company, message, created, consent_version, photo) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, firstName, lastName, company, message, now, env.CHAT_CONSENT_VERSION, mime),
  ]
  if (bytes) {
    for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
      statements.push(env.DB.prepare('INSERT INTO photo_chunks (message_id, part, bytes) VALUES (?, ?, ?)')
        .bind(id, offset / CHUNK_BYTES, bytes.slice(offset, offset + CHUNK_BYTES).buffer))
    }
  }
  try {
    await env.DB.batch(statements)
  } catch (error) {
    if (!await first(env.DB, 'SELECT id FROM messages WHERE id = ?', id)) throw error
  }
  return json({ ok: true }, 201)
}

async function listChat(env, url) {
  const before = Number(url.searchParams.get('before'))
  const cursor = Number.isSafeInteger(before) && before > 0 ? before : Number.MAX_SAFE_INTEGER
  const requestedLimit = Number(url.searchParams.get('limit'))
  const limit = Number.isSafeInteger(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, PAGE_SIZE) : PAGE_SIZE
  const [messages, stamp] = await Promise.all([
    rows(env.DB, 'SELECT seq, id, first, last, company, message, created, photo FROM messages WHERE seq < ? ORDER BY seq DESC LIMIT ?', cursor, limit + 1),
    first(env.DB, "SELECT value FROM settings WHERE name = 'messages_stamp'"),
  ])
  return json({ messages: messages.slice(0, limit), next: messages.length > limit ? messages[limit - 1].seq : null, stamp: stamp?.value || '' })
}

async function readPhoto(env, id) {
  if (!idPattern.test(id)) return fail(404, 'Фото не найдено.')
  const chunks = await rows(env.DB, `SELECT m.photo, p.bytes FROM messages m JOIN photo_chunks p
    ON p.message_id = m.id WHERE m.id = ? ORDER BY p.part`, id)
  if (!chunks.length) return fail(404, 'Фото не найдено.')
  const bytes = chunks.map(row => new Uint8Array(row.bytes))
  return new Response(new Blob(bytes), { headers: {
    ...security, 'Content-Type': chunks[0].photo, 'Cache-Control': 'no-store',
  } })
}

const upsert = 'INSERT INTO settings (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value'

async function admin(request, env, url) {
  if (!await adminAuthorized(request, env)) return fail(401, 'Ключ администратора не принят.')
  const { pathname } = url
  if (request.method === 'GET' && pathname === '/api/admin/state') {
    const state = await config(env)
    const cursor = Number(url.searchParams.get('before'))
    const before = Number.isSafeInteger(cursor) && cursor > 0 ? cursor : Number.MAX_SAFE_INTEGER
    const messages = await rows(env.DB, 'SELECT seq, id, first, last, company, message, created, photo FROM messages WHERE seq < ? ORDER BY seq DESC LIMIT ?', before, PAGE_SIZE + 1)
    return json({ phase: state.manual, chatOpen: state.chatOpen, chatReady: Boolean(state.consentText && state.policyUrl && env.CHAT_CONSENT_VERSION && env.CHAT_ENABLED !== 'false'), messages: messages.slice(0, PAGE_SIZE), next: messages.length > PAGE_SIZE ? messages[PAGE_SIZE - 1].seq : null })
  }
  if (request.method === 'GET' && pathname === '/api/admin/music.csv') {
    const items = await rows(env.DB, 'SELECT song, created FROM music ORDER BY created DESC')
    const csv = value => '"' + (/^[=+\-@\t\r\n]/.test(value) ? "'" : '') + value.replaceAll('"', '""') + '"'
    const lines = items.map(({ song, created }) => csv(dateFormatter.format(created)) + ';' + csv(song))
    return new Response('\ufeffДата и время (мск);Песня и исполнитель\r\n' + lines.join('\r\n'), { headers: {
      ...security, 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store',
      'Content-Disposition': 'attachment; filename="music-requests.csv"',
    } })
  }
  if (request.method === 'POST' && pathname === '/api/admin/settings') {
    const data = await formData(request, 8192)
    const phase = data?.get('phase')
    const chat = data?.get('chat')
    if (!moods.has(phase) || !['open', 'closed'].includes(chat)) return fail(400, 'Проверьте параметры.')
    await env.DB.batch([env.DB.prepare(upsert).bind('phase', phase), env.DB.prepare(upsert).bind('chat', chat)])
    return json({ ok: true })
  }
  if (request.method === 'DELETE' && pathname.startsWith('/api/admin/chat/')) {
    const id = pathname.split('/').at(-1)
    if (!idPattern.test(id)) return fail(400, 'Некорректный идентификатор.')
    await env.DB.batch([
      env.DB.prepare('DELETE FROM photo_chunks WHERE message_id = ?').bind(id),
      env.DB.prepare('DELETE FROM messages WHERE id = ?').bind(id),
      env.DB.prepare(upsert).bind('messages_stamp', crypto.randomUUID()),
    ])
    return json({ ok: true })
  }
  return fail(404, 'Страница не найдена.')
}

export function createWorker(assetResponse) {
  return {
    async fetch(request, env) {
      const url = new URL(request.url)
      const path = url.pathname
      try {
        if (!path.startsWith('/api/')) {
          if (request.method !== 'GET' && request.method !== 'HEAD') return fail(405, 'Метод не поддерживается.')
          return await assetResponse(path, request.method, { ...security, 'Content-Security-Policy': csp }, request.headers.get('Range'))
            || fail(404, 'Страница не найдена.')
        }
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          const origin = request.headers.get('Origin')
          if ((origin && origin !== url.origin) || request.headers.get('Sec-Fetch-Site') === 'cross-site') {
            return fail(403, 'Запрос с другого сайта отклонён.')
          }
        }
        if (path === '/api/config' && request.method === 'GET') {
          const { manual, ...publicConfig } = await config(env)
          const response = json(publicConfig)
          if (!/(?:^|;\s*)rusal_client=[a-f0-9-]{36}(?:;|$)/.test(request.headers.get('Cookie') || '')) {
            const secure = url.protocol === 'https:' ? '; Secure' : ''
            response.headers.set('Set-Cookie', 'rusal_client=' + crypto.randomUUID() + '; Path=/; Max-Age=86400; HttpOnly; SameSite=Lax' + secure)
          }
          return response
        }
        if (!env.DB) return fail(503, 'Хранилище временно недоступно.')
        if (path.startsWith('/api/admin/')) return await admin(request, env, url)
        if (path === '/api/music' && request.method === 'POST') return await submitMusic(request, env, Date.now())
        if (path === '/api/chat' && request.method === 'POST') return await submitChat(request, env, Date.now())
        if (path === '/api/chat' && request.method === 'GET') return await listChat(env, url)
        if (path.startsWith('/api/photo/') && request.method === 'GET') return await readPhoto(env, path.split('/').at(-1))
        return fail(404, 'Страница не найдена.')
      } catch (error) {
        console.error(error.name, error.message)
        return fail(503, 'Сервис временно недоступен. Попробуйте ещё раз.')
      }
    },
  }
}
