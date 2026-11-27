const get = id => document.getElementById(id)
const login = get('admin-login')
const settings = get('admin-settings')
const list = get('admin-messages')
let token = ''
let cursor = null

async function adminApi(path, options) {
  const response = await fetch('/api/admin/' + path, {
    ...options, headers: { Authorization: 'Bearer ' + token }, cache: 'no-store',
  })
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw Error(data.error || 'Операция не выполнена. Попробуйте снова.')
  }
  return response
}

function renderMessage(message) {
  const item = document.createElement('li')
  const author = document.createElement('strong')
  author.textContent = [message.first, message.last, message.company].join(' · ')
  const text = document.createElement('p')
  text.textContent = message.message
  item.append(author, text)
  if (message.photo) {
    const image = document.createElement('img')
    image.src = '/api/photo/' + encodeURIComponent(message.id)
    image.alt = 'Вложение к сообщению'
    image.loading = 'lazy'
    item.append(image)
  }
  const remove = document.createElement('button')
  remove.className = 'text-button'
  remove.textContent = 'Удалить сообщение'
  remove.addEventListener('click', async () => {
    if (!window.confirm('Удалить сообщение и прикреплённое фото?')) return
    remove.disabled = true
    try {
      await adminApi('chat/' + message.id, { method: 'DELETE' })
      await load()
      get('admin-status').textContent = 'Сообщение удалено.'
    } catch (error) {
      get('admin-status').textContent = error.message
      remove.disabled = false
    }
  })
  item.append(remove)
  return item
}

async function load(older = false) {
  const response = await adminApi('state' + (older && cursor ? '?before=' + cursor : ''))
  const state = await response.json()
  if (!older) {
    list.replaceChildren()
    settings.elements.phase.value = state.phase
    settings.elements.chat.value = state.chatOpen ? 'open' : 'closed'
    get('chat-config-note').hidden = state.chatReady
  }
  list.append(...state.messages.map(renderMessage))
  cursor = state.next
  get('empty-admin').hidden = list.children.length > 0
  get('admin-older').hidden = !cursor
}

const status = message => { get('admin-status').textContent = message }
login.addEventListener('submit', async event => {
  event.preventDefault()
  token = login.elements.token.value
  try {
    await load()
    login.reset()
    login.hidden = true
    get('admin-content').hidden = false
    status('')
  } catch (error) {
    token = ''
    status(error.message)
  }
})
get('admin-exit').addEventListener('click', () => {
  token = ''
  cursor = null
  list.replaceChildren()
  get('admin-content').hidden = true
  login.hidden = false
  login.elements.token.focus()
  status('Вы вышли из панели.')
})
settings.addEventListener('submit', async event => {
  event.preventDefault()
  try {
    await adminApi('settings', { method: 'POST', body: new URLSearchParams(new FormData(settings)) })
    await load()
    status('Настройки сохранены.')
  } catch (error) {
    status(error.message)
  }
})
get('admin-older').addEventListener('click', () => load(true).catch(error => status(error.message)))
get('download-music').addEventListener('click', async () => {
  try {
    const data = await (await adminApi('music.csv')).blob()
    const url = URL.createObjectURL(data)
    const download = document.createElement('a')
    download.href = url
    download.download = 'music-requests.csv'
    download.click()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  } catch (error) {
    status(error.message)
  }
})
