import { predictions } from './predictions.js'

const get = id => document.getElementById(id)
const broadcastControls = document.querySelector('.broadcast-controls')
const maxLink = 'https://max.ru/u/f9LHodD0cOJ6PumvLtqvR1lmCM2Ba7pXV1cQtBHAm0lz2LD5R1pPDvz66fA'
const maxDeadline = Date.parse('2026-12-19T00:00:00+03:00')
const defaultRadio = 'https://m5m128.hostingradio.ru:8074/m5m128.mp3'
const radio = get('radio')
const radioToggle = get('radio-toggle')
const radioVolume = get('radio-volume')
const video = get('video')
const watchBroadcast = get('watch-broadcast')
const watchStatus = get('watch-status')
const fortune = get('fortune')
const chatForm = get('chat-form')
const mobileChat = matchMedia('(max-width: 660px)')
const chatDialog = get('chat-details')
const chatDialogClose = get('chat-details-close')
const chatContinue = get('chat-continue')
const musicForm = get('music-form')
let current = {}
let radioSource = defaultRadio
let radioState = 'idle'
let playAttempt = 0
let radioTimer
let videoTimer
let loadedVideo = ''
const feedPages = [null]
const reducedFeedMotion = matchMedia('(prefers-reduced-motion: reduce)')
let nextFeedPage = null
let feedRequest = 0
let latestMessages = []

for (const link of document.querySelectorAll('[data-max]')) {
  link.href = maxLink
  link.target = '_blank'
  link.rel = 'noopener'
}

for (const button of document.querySelectorAll('.table-hotspot')) {
  const dialog = get(button.getAttribute('aria-controls'))
  const object = button.closest('.table-object')
  button.addEventListener('click', () => {
    dialog.showModal()
    object.setAttribute('data-selected', '')
  })
  dialog.addEventListener('close', () => {
    object.removeAttribute('data-selected')
    button.focus({ preventScroll: true })
  })
}

function showStatus(id, message, error = false) {
  const node = get(id)
  node.textContent = message
  node.dataset.error = String(error)
}

async function api(path, options) {
  const response = await fetch('/api/' + path, { cache: 'no-store', ...options })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw Error(data.error || 'Сервис временно недоступен. Попробуйте ещё раз.')
  return data
}

function setRadio(state, message = '') {
  radioState = state
  const active = state === 'playing' || state === 'loading'
  const labels = {idle:'Слушать радио', loading:'Подключение…', playing:'Остановить радио', error:'Повторить радио'}
  radioToggle.dataset.state = state
  radioToggle.setAttribute('aria-pressed', String(active))
  radioToggle.setAttribute('aria-label', state === 'loading' ? 'Отменить подключение к радио' : labels[state])
  radioToggle.querySelector('span').textContent = labels[state]
  const note = get('radio-status')
  note.textContent = message
  note.hidden = !message
}

function radioNote() {
  return current.videoUrl ? 'Видеоплеер остановлен на время прослушивания радио.' : ''
}

function stopRadio(state = 'idle', message = '') {
  ++playAttempt
  clearTimeout(radioTimer)
  radio.pause()
  radio.removeAttribute('src')
  radio.load()
  setRadio(state, message)
  updateVideo()
}

function startRadioTimer() {
  clearTimeout(radioTimer)
  radioTimer = setTimeout(() => stopRadio('error', 'Радиопоток не ответил. Попробуйте ещё раз.'), 15000)
}

try {
  const savedVolume = localStorage.getItem('rusal-radio-volume')
  if (savedVolume !== null) radioVolume.value = savedVolume
} catch {}
function applyRadioVolume() {
  radio.volume = radioVolume.valueAsNumber / 100
  radio.muted = radioVolume.valueAsNumber === 0
}
applyRadioVolume()
radioVolume.addEventListener('input', () => {
  applyRadioVolume()
  try { localStorage.setItem('rusal-radio-volume', radioVolume.value) } catch {}
})

radioToggle.addEventListener('click', async () => {
  watchStatus.hidden = true
  if (radioState === 'playing' || radioState === 'loading') {
    stopRadio()
    return
  }
  const attempt = ++playAttempt
  setRadio('loading', radioNote())
  updateVideo()
  radio.src = radioSource
  startRadioTimer()
  try {
    await radio.play()
  } catch {
    if (attempt === playAttempt) stopRadio('error', 'Не удалось подключиться к радиопотоку. Попробуйте ещё раз.')
  }
})

radio.addEventListener('playing', () => {
  if (!radio.hasAttribute('src')) return
  clearTimeout(radioTimer)
  setRadio('playing', radioNote())
})
radio.addEventListener('waiting', () => {
  if (radioState !== 'playing') return
  setRadio('loading', radioNote())
  startRadioTimer()
})
for (const name of ['error', 'ended']) {
  radio.addEventListener(name, () => {
    if (radio.hasAttribute('src')) stopRadio('error', 'Радиопоток недоступен. Попробуйте ещё раз.')
  })
}

function noteVideo(text, retry = false) {
  get('video-note').hidden = !text
  get('video-message').textContent = text
  get('video-retry').hidden = !retry
}

function initHeroMotion() {
  const scenery = get('scenery')
  const motion = get('hero-motion')
  const still = get('hero-still')
  const button = get('hero-playback')
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
  let stillReady = false
  let showingStill = false
  let playing = false
  let autoAttempted = false
  motion.muted = true
  motion.playsInline = true

  const updateButton = () => {
    const label = playing ? 'Приостановить видео'
      : motion.ended || showingStill ? 'Воспроизвести видео заново'
      : motion.currentTime > 0 ? 'Продолжить видео' : 'Воспроизвести видео'
    button.toggleAttribute('data-playing', playing)
    button.setAttribute('aria-label', label)
  }
  const play = () => motion.play().catch(() => {
    playing = false
    updateButton()
  })
  const showStill = () => {
    showingStill = true
    playing = false
    motion.autoplay = false
    motion.pause()
    if (stillReady) still.setAttribute('data-visible', '')
    updateButton()
  }
  still.decode().then(() => {
    stillReady = true
    if (showingStill) still.setAttribute('data-visible', '')
  }).catch(() => {})
  for (const event of ['pause', 'ended']) motion.addEventListener(event, () => {
    playing = false
    updateButton()
  })
  motion.addEventListener('playing', () => {
    if (scenery.getBoundingClientRect().bottom <= 0) {
      showStill()
      return
    }
    playing = true
    motion.autoplay = false
    showingStill = false
    still.removeAttribute('data-visible')
    updateButton()
  })
  motion.addEventListener('error', showStill)
  button.addEventListener('click', () => {
    autoAttempted = true
    motion.autoplay = false
    if (playing && !motion.paused && !motion.ended) {
      motion.pause()
      return
    }
    if (motion.error) motion.load()
    else if ((motion.ended || showingStill) && motion.readyState >= HTMLMediaElement.HAVE_METADATA) motion.currentTime = 0
    play()
  })
  reducedMotion.addEventListener('change', () => {
    if (reducedMotion.matches) {
      motion.autoplay = false
      motion.pause()
    }
  })
  new IntersectionObserver(([entry]) => {
    if (entry.boundingClientRect.bottom <= 0 && !showingStill) showStill()
    else if (entry.isIntersecting && !autoAttempted && !showingStill && !reducedMotion.matches) {
      autoAttempted = true
      motion.autoplay = true
      play()
    }
  }).observe(scenery)
  button.hidden = false
  if (motion.error) showStill()
}

function updateVideo(retry = false) {
  const url = current.videoUrl
  const activeRadio = radioState === 'playing' || radioState === 'loading'
  if (!url || activeRadio) {
    clearTimeout(videoTimer)
    video.replaceChildren()
    video.hidden = true
    loadedVideo = ''
    noteVideo(activeRadio && url ? 'Остановите радио, чтобы вернуться к видео.' : current.phase === 'replay' ? 'Запись эфира пока недоступна.' : current.phase === 'live' ? 'Видеотрансляция пока недоступна.' : '')
    return
  }
  if (loadedVideo === url && !retry) return
  clearTimeout(videoTimer)
  loadedVideo = url
  const frame = document.createElement('iframe')
  frame.title = current.phase === 'replay' ? 'Запись эфира Facecast' : 'Видеотрансляция Facecast'
  frame.allow = 'fullscreen; picture-in-picture; encrypted-media'
  frame.allowFullscreen = true
  frame.referrerPolicy = 'strict-origin-when-cross-origin'
  frame.addEventListener('load', () => {
    clearTimeout(videoTimer)
    noteVideo('Если видео не открылось, перезагрузите плеер.', true)
  }, { once: true })
  frame.addEventListener('error', () => noteVideo('Не удалось загрузить видео.', true), { once: true })
  frame.src = url
  video.replaceChildren(frame)
  video.hidden = false
  noteVideo('Подключаем видеотрансляцию…', true)
  videoTimer = setTimeout(() => noteVideo('Не удалось загрузить видео.', true), 12000)
}
get('video-retry').addEventListener('click', () => updateVideo(true))
watchBroadcast.addEventListener('click', () => {
  if (!current.videoUrl) {
    watchStatus.textContent = current.phase === 'replay' ? 'Запись эфира пока недоступна.'
      : current.phase === 'live' ? 'Видеотрансляция пока недоступна.'
        : 'Видеотрансляция начнётся 23 декабря в 8:00 мск.'
    watchStatus.hidden = false
    return
  }
  watchStatus.hidden = true
  if (radioState === 'playing' || radioState === 'loading') stopRadio()
  else updateVideo()
  video.scrollIntoView({ block: 'center' })
  video.querySelector('iframe')?.focus({ preventScroll: true })
})

function setForm(form, enabled) {
  for (const field of form.querySelectorAll('input, textarea, button')) {
    if (field === chatDialogClose) continue
    field.disabled = !enabled || (field.matches('button') && form.dataset.busy === 'true')
  }
}

setForm(chatForm, current.chatOpen)
chatContinue.addEventListener('click', () => {
  if (!chatForm.elements.message.reportValidity()) return
  if (!chatForm.elements.message.value.trim()) {
    showStatus('chat-status', 'Введите сообщение.', true)
    return
  }
  showStatus('chat-status', '')
  showStatus('chat-dialog-status', '')
  chatDialog.showModal()
})
chatDialogClose.addEventListener('click', () => chatDialog.close())

function applyConfig(data) {
  if (current.phase !== data.phase || current.videoUrl !== data.videoUrl) watchStatus.hidden = true
  current = data
  watchBroadcast.textContent = data.phase === 'replay' ? 'Смотреть запись' : 'Смотреть эфир'
  for (const section of document.querySelectorAll('[data-promo]')) section.hidden = data.phase === 'replay'
  get('max-send').hidden = !data.maxOpen
  get('max-closed').hidden = data.maxOpen
  radioSource = data.radioUrl || defaultRadio
  get('consent-text').textContent = data.consentText || ''
  get('consent-text').hidden = !data.consentText
  const policyLink = get('policy-link')
  policyLink.hidden = !data.policyUrl
  if (data.policyUrl) policyLink.href = data.policyUrl
  else policyLink.removeAttribute('href')
  setForm(chatForm, data.chatOpen)
  setForm(musicForm, data.musicOpen)
  if (!data.musicOpen && data.phase !== 'replay') showStatus('music-status', 'Приём заявок временно закрыт.')
  else if (get('music-status').textContent === 'Приём заявок временно закрыт.') showStatus('music-status', '')
  updateVideo()
}

async function refreshConfig() {
  try {
    applyConfig(await api('config'))
  } catch {
    if (!current.phase) {
      const now = Date.now()
      const phase = now >= Date.parse('2026-12-23T12:00:00+03:00') ? 'replay'
        : now >= Date.parse('2026-12-23T08:00:00+03:00') ? 'live' : 'before'
      applyConfig({ phase, maxOpen: now < maxDeadline })
    }
  }
}

function initPredictionTrain() {
  const train = get('prediction-train')
  const trigger = get('prediction-trigger')
  const wagon = new Image(600, 188)
  wagon.src = '/assets/prediction-wagon.png'
  wagon.alt = ''
  wagon.draggable = false
  const consist = document.createElement('div')
  consist.className = 'prediction-consist'
  for (let index = 0; index < 10; index++) consist.append(wagon.cloneNode())
  train.append(consist, consist.cloneNode(true))

  const openFortune = () => {
    const [title, text] = predictions[Math.floor(Math.random() * predictions.length)]
    get('fortune-title').textContent = title
    get('fortune-text').textContent = text
    fortune.showModal()
  }
  train.addEventListener('click', openFortune)
  trigger.addEventListener('click', openFortune)
  fortune.addEventListener('close', () => trigger.focus({ preventScroll: true }))
}
fortune.addEventListener('click', event => {
  if (event.target !== fortune) return
  const box = fortune.getBoundingClientRect()
  if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) fortune.close()
})

function messageItem(message) {
  const item = document.createElement('li')
  item.dataset.messageId = message.id
  const author = document.createElement('strong')
  const company = document.createElement('small')
  const text = document.createElement('p')
  author.textContent = message.first + ' ' + message.last
  company.textContent = message.company
  text.textContent = message.message
  item.append(author, company, text)
  if (message.photo) {
    const image = document.createElement('img')
    image.src = '/api/photo/' + encodeURIComponent(message.id)
    image.alt = 'Фото к сообщению'
    image.loading = 'lazy'
    item.append(image)
  }
  return item
}

async function renderMessages(messages, mobile, request) {
  const container = get('messages')
  const visible = mobile ? messages.slice(0, 2).reverse() : messages
  const ids = visible.map(message => message.id).join(',')
  if (container.dataset.ids === ids) return

  const previous = new Map(Array.from(container.children, item => [item.dataset.messageId, item]))
  const items = visible.map(message => previous.get(message.id) || messageItem(message))
  const animate = request !== undefined && mobile && !reducedFeedMotion.matches &&
    previous.size > 0 && items.some(item => !previous.has(item.dataset.messageId))
  const position = item => item.getBoundingClientRect().top - container.getBoundingClientRect().top
  const offsets = new Map()

  if (animate) {
    const exits = []
    for (const item of previous.values()) {
      if (items.includes(item)) {
        offsets.set(item, position(item))
      } else {
        exits.push(item.animate([
          { transform: 'translateY(0)', opacity: 1 },
          { transform: 'translateY(-45%)', opacity: 0 },
        ], { duration: 140, easing: 'ease-in' }).finished)
      }
    }
    if (exits.length) await Promise.allSettled(exits)
    if (request !== feedRequest) return
  }

  container.replaceChildren(...items)
  container.dataset.ids = ids
  if (animate) {
    for (const item of items) {
      const existing = offsets.has(item)
      const distance = existing ? offsets.get(item) - position(item) : 24
      item.animate([
        { transform: `translateY(${distance}px)`, opacity: existing ? 1 : 0 },
        { transform: 'translateY(0)', opacity: 1 },
      ], { duration: 200, easing: 'ease-out' })
    }
  }
}

async function refreshMessages() {
  const request = ++feedRequest
  const mobile = mobileChat.matches
  try {
    const query = new URLSearchParams({ limit: mobile ? '2' : '3' })
    const before = mobile ? null : feedPages.at(-1)
    if (before) query.set('before', before)
    const { messages, next } = await api('chat?' + query)
    if (request !== feedRequest) return
    if (!before) latestMessages = messages
    await renderMessages(messages, mobile, request)
    if (request !== feedRequest) return
    if (!mobile) nextFeedPage = next
    get('chat-feed-status').textContent = messages.length ? '' : 'Здесь пока нет сообщений.'
    get('newer').hidden = mobile || feedPages.length <= 1
    get('older').hidden = mobile || !nextFeedPage
  } catch {
    if (request === feedRequest) get('chat-feed-status').textContent = 'Не удалось обновить чат. Попробуем снова.'
  }
}
mobileChat.addEventListener('change', () => {
  if (mobileChat.matches) renderMessages(latestMessages, true)
  refreshMessages()
})
get('older').addEventListener('click', () => {
  if (!nextFeedPage) return
  feedPages.push(nextFeedPage)
  nextFeedPage = null
  refreshMessages()
})
get('newer').addEventListener('click', () => {
  if (feedPages.length <= 1) return
  feedPages.pop()
  nextFeedPage = null
  refreshMessages()
})

function handleForm(form, route, allowed, status, build, success) {
  let requestId
  form.addEventListener('input', () => {
    if (form.dataset.busy !== 'true') requestId = undefined
  })
  form.addEventListener('submit', async event => {
    event.preventDefault()
    if (!current[allowed] || form.dataset.busy === 'true') return
    requestId ||= crypto.randomUUID()
    form.dataset.busy = 'true'
    const feedback = () => form === chatForm && chatDialog.open ? 'chat-dialog-status' : status
    setForm(form, true)
    showStatus(feedback(), 'Отправляем…')
    try {
      await api(route, { method: 'POST', body: build(form, requestId) })
      requestId = undefined
      form.reset()
      if (form === chatForm && chatDialog.open) chatDialog.close()
      showStatus(status, success)
      if (route === 'chat') {
        feedPages.length = 1
        nextFeedPage = null
        await refreshMessages()
      }
    } catch (error) {
      showStatus(feedback(), error.message, true)
    } finally {
      form.dataset.busy = 'false'
      setForm(form, current[allowed])
    }
  })
}
handleForm(musicForm, 'music', 'musicOpen', 'music-status', (form, id) => {
  const song = form.elements.song.value.trim()
  if (!song) throw Error('Укажите песню и исполнителя.')
  return new URLSearchParams({ song, id })
}, 'Заявка отправлена.')

const chatPhoto = get('chat-photo')
function showChatPhoto(file) {
  get('chat-attached-file').hidden = !file
  get('chat-file-name').textContent = file?.name || ''
}
chatPhoto.addEventListener('change', () => showChatPhoto(chatPhoto.files[0]))
chatForm.addEventListener('reset', () => showChatPhoto())
get('chat-remove-photo').addEventListener('click', () => {
  chatPhoto.value = ''
  showChatPhoto()
  chatPhoto.dispatchEvent(new Event('input', { bubbles: true }))
  chatPhoto.focus()
})

handleForm(chatForm, 'chat', 'chatOpen', 'chat-status', (form, id) => {
  const data = new FormData(form)
  const fullName = String(data.get('fullName') ?? '').trim()
  const [first, ...rest] = fullName.split(/\s+/)
  const last = rest.join(' ')
  const company = String(data.get('company') ?? '').trim()
  if (!first || !last || !company || first.length > 70 || last.length > 70 || company.length > 150) {
    throw Error('Укажите имя, фамилию и предприятие.')
  }
  if (!String(data.get('message')).trim()) throw Error('Введите сообщение.')
  data.delete('fullName')
  data.set('first', first)
  data.set('last', last)
  data.set('company', company)
  const photo = data.get('photo')
  if (!photo.size) data.delete('photo')
  else {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(photo.type)) throw Error('Загрузите фото в формате JPG, PNG или WebP.')
    if (photo.size > 5 * 1024 * 1024) throw Error('Размер фото превышает 5 МБ.')
  }
  data.set('id', id)
  return data
}, '')

function initCarriageDoors() {
  const carriages = [...document.querySelectorAll('.carriage:not([data-wagon-test])')].map(section => ({
    section,
    frame: section.querySelector('.carriage-frame'),
    linked: false,
  }))
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
  const mobileDoors = matchMedia('(max-width: 660px)')
  let animationFrame = 0
  let linkedSection = location.hash.slice(1)
  let chatOpeningSpace = 0

  function updateDoors() {
    animationFrame = 0
    const viewport = window.innerHeight
    const openingStart = viewport * .66
    const closingEnd = viewport * .18
    const page = document.scrollingElement
    const remaining = page.scrollHeight - page.clientHeight - page.scrollTop
    let nextChatOpeningSpace = 0
    const bounds = carriages.map(carriage => carriage.frame.getBoundingClientRect())
    carriages.forEach((carriage, index) => {
      const { top, bottom, height } = bounds[index]
      const visible = !carriage.section.hidden && bottom > 0 && top < viewport
      const isTable = carriage.section.id === 'announce'
      const isShowcase = isTable || carriage.section.id === 'predictions'
      if (!visible) carriage.linked = false
      // Short frames still need time fully open as they cross the middle of the screen.
      const openingEnd = Math.max(viewport * .16, viewport * .55 - height / 2)
      const closingStart = Math.min(viewport * .64, viewport * .45 + height / 2)
      const isChat = carriage.section.id === 'chat'
      let entering = (openingStart - top) / (openingStart - openingEnd)
      if (isChat && visible) entering = Math.max(entering, 1 - remaining / (viewport * .25))
      const leaving = isChat ? 1 : (bottom - closingEnd) / (closingStart - closingEnd)
      if (carriage.section.id === linkedSection && visible) {
        carriage.linked = true
        linkedSection = ''
      }
      let progress = reducedMotion.matches || carriage.linked ? 1 : Math.max(0, Math.min(1, entering, leaving))
      if (mobileDoors.matches) {
        const distancePastStart = viewport / 2 - (isChat ? top : (top + bottom) / 2)
        const openingDistance = isChat ? height / 2 : viewport * .18
        if (isChat) {
          // Leave enough room for the center of the last block to reach the midpoint.
          const available = distancePastStart + remaining - chatOpeningSpace
          nextChatOpeningSpace = Math.max(0, Math.ceil(openingDistance + 1 - available))
        }
        const tableLead = isTable ? openingDistance : 0
        const opening = (distancePastStart + tableLead) / openingDistance
        const mobileClosingStart = viewport * .27 + height / 2
        const closing = isChat ? 1 : (bottom - closingEnd) / (mobileClosingStart - closingEnd)
        const inOpeningZone = visible && page.scrollTop > 1 && opening > 0 && closing > 0
        progress = inOpeningZone ? (reducedMotion.matches ? 1 : Math.min(1, opening, closing)) : 0
      }
      const travel = progress * progress * (3 - 2 * progress) * 100
      carriage.frame.style.setProperty('--door-travel', `${travel.toFixed(2)}%`)
      if (isShowcase) {
        const glowStart = isTable ? 1 : .9
        if (!visible || progress < .1 || reducedMotion.matches) {
          carriage.section.removeAttribute('data-intro-glow')
        } else if (progress >= glowStart && !carriage.section.hasAttribute('data-intro-glow')) {
          carriage.section.setAttribute('data-intro-glow', '')
        }
      }
    })
    if (nextChatOpeningSpace !== chatOpeningSpace) {
      chatOpeningSpace = nextChatOpeningSpace
      document.documentElement.style.setProperty('--chat-opening-space', `${chatOpeningSpace}px`)
      scheduleDoors()
    }
  }

  function scheduleDoors() {
    if (!animationFrame) animationFrame = requestAnimationFrame(updateDoors)
  }

  document.documentElement.classList.add('has-carriage-motion')
  updateDoors()
  window.addEventListener('scroll', scheduleDoors, { passive: true })
  window.addEventListener('resize', scheduleDoors)
  window.addEventListener('pageshow', scheduleDoors)
  window.addEventListener('hashchange', () => {
    linkedSection = location.hash.slice(1)
    scheduleDoors()
  })
  reducedMotion.addEventListener('change', scheduleDoors)
  const layoutObserver = new ResizeObserver(scheduleDoors)
  layoutObserver.observe(get('main'))
  for (const { frame } of carriages) layoutObserver.observe(frame)
}

initHeroMotion()
initPredictionTrain()
function updateBroadcastSpace() {
  document.documentElement.style.setProperty('--broadcast-space', `${Math.ceil(broadcastControls.getBoundingClientRect().height + 8)}px`)
}
updateBroadcastSpace()
new ResizeObserver(updateBroadcastSpace).observe(broadcastControls)
if (new URLSearchParams(location.search).get('wagon-test') === '1') {
  const { initWagonTest } = await import('./wagon-test.js')
  for (const section of document.querySelectorAll('.carriage')) initWagonTest(section)
}
initCarriageDoors()
refreshConfig()
refreshMessages()
setInterval(() => {
  if (!document.hidden) {
    refreshConfig()
    refreshMessages()
  }
}, 6000)
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    refreshConfig()
    refreshMessages()
  }
})
