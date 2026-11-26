import { createServer } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { createWorker } from '../server/worker.mjs'
import { entryFor, assetHeaders, videoAssetResponse } from '../server/assets.mjs'

mkdirSync('.data', { recursive: true })
const database = new DatabaseSync(process.env.DATABASE_PATH || '.data/local.sqlite')
const migration = readFileSync(new URL('../drizzle/0000_initial.sql', import.meta.url), 'utf8')
database.exec(migration)
if (!database.prepare("PRAGMA table_info(music)").all().some(column => column.name === 'visitor')) {
  database.exec("ALTER TABLE music ADD COLUMN visitor TEXT NOT NULL DEFAULT ''")
}

function statement(sql, params = []) {
  const prepared = database.prepare(sql)
  return {
    bind: (...values) => statement(sql, values.map(value => value instanceof ArrayBuffer ? new Uint8Array(value) : value)),
    first: async () => prepared.get(...params) ?? null,
    all: async () => ({ results: prepared.all(...params) }),
    run: async () => ({ meta: prepared.run(...params) }),
  }
}

const DB = {
  prepare: statement,
  async batch(statements) {
    database.exec('BEGIN')
    try {
      const results = await Promise.all(statements.map(item => item.run()))
      database.exec('COMMIT')
      return results
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  },
}

const worker = createWorker(async (path, method, headers, range) => {
  const entry = entryFor(path)
  if (!entry) return null
  let bytes
  try {
    bytes = await readFile(new URL('../public' + entry, import.meta.url))
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
  const responseHeaders = assetHeaders(entry, headers)
  if (entry.endsWith('.mp4')) return videoAssetResponse(bytes, method, responseHeaders, range)
  return new Response(method === 'HEAD' ? null : bytes, { headers: responseHeaders })
})

let queue = Promise.resolve()
const arguments_ = process.argv.slice(2)
const portIndex = arguments_.indexOf('--port')
const port = Number(portIndex >= 0 ? arguments_[portIndex + 1] : process.env.PORT || 3000)
createServer((incoming, outgoing) => {
  const perform = async () => {
    const method = incoming.method
    const request = new Request('http://' + incoming.headers.host + incoming.url, {
      method, headers: incoming.headers,
      ...(['GET', 'HEAD'].includes(method) ? {} : { body: Readable.toWeb(incoming), duplex: 'half' }),
    })
    const response = await worker.fetch(request, { ...process.env, DB })
    outgoing.writeHead(response.status, Object.fromEntries(response.headers))
    if (response.body) Readable.fromWeb(response.body).pipe(outgoing)
    else outgoing.end()
  }
  queue = queue.then(perform).catch(error => {
    console.error(error)
    if (!outgoing.headersSent) outgoing.writeHead(500)
    outgoing.end('Ошибка сервера')
  })
}).listen(port, process.env.HOST || '127.0.0.1', () => console.log('Preview listening on port ' + port))
