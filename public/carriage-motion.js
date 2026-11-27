const carriageCount = 7
const maxWagonsPerPass = 2.5

export function initCarriageMotion(section) {
  section.dataset.wagonMotion = ''

  const scenery = document.createElement('div')
  scenery.className = 'express-wagon-scenery'
  scenery.setAttribute('aria-hidden', 'true')
  const track = document.createElement('div')
  track.className = 'express-wagon-track'
  for (let index = 0; index < carriageCount; index += 1) {
    const carriage = document.createElement('div')
    carriage.className = 'express-wagon-car'
    const car = new Image()
    car.src = '/assets/express-carriage.webp'
    car.alt = ''
    car.draggable = false
    carriage.append(car)
    track.append(carriage)
  }
  const camera = document.createElement('div')
  camera.className = 'express-wagon-camera'
  camera.append(track)
  scenery.append(camera)
  section.prepend(scenery)

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
  const mobile = matchMedia('(max-width: 660px)')
  const frame = section.querySelector('.carriage-frame')
  const otherSections = [...section.parentElement.children].filter(item => item !== section && item.matches('.carriage'))
  const predictionTrain = section.querySelector('.prediction-train')
  const wagonsPerConsist = predictionTrain?.firstElementChild?.children.length
  let previousScroll = scrollY
  let animationFrame = 0
  let inStopZone = false
  let mode = 'moving'
  let openTimer = 0
  let closeTimer = 0

  function openCar() {
    clearTimeout(openTimer)
    openTimer = 0
    mode = 'stopped'
    section.dataset.wagonStopped = ''
  }

  function update() {
    animationFrame = 0
    if (mobile.matches) {
      updateMobileDoors(section, frame, reducedMotion.matches)
      return
    }
    const scrolled = scrollY !== previousScroll
    previousScroll = scrollY
    const { top, height } = section.getBoundingClientRect()
    const centerOffset = innerHeight / 2 - (top + height / 2)
    const distance = Math.abs(centerOffset)
    const focused = distance < innerHeight * .25 && !!section.querySelector(':focus-visible')
    const dialogOpen = mode === 'stopped' && !!document.querySelector('dialog[open]')
    const closeToCenter = distance < (mode === "stopped" ? .30 : .26) * innerHeight
    const isClosest = closeToCenter && otherSections.every(item => {
      const bounds = item.getBoundingClientRect()
      return distance <= Math.abs(innerHeight / 2 - (bounds.top + bounds.height / 2))
    })
    inStopZone = focused || dialogOpen || (scrollY > 1 && isClosest)

    if (!inStopZone || scrolled) {
      clearTimeout(openTimer)
      openTimer = 0
    }

    if (inStopZone && mode === 'moving' && !openTimer) {
      if (focused) openCar()
      else openTimer = setTimeout(() => {
        openTimer = 0
        if (scrollY === previousScroll && inStopZone) openCar()
        else schedule()
      }, 120)
    } else if (!inStopZone && mode === 'stopped') {
      mode = 'closing'
      section.dataset.wagonClosing = ''
      section.removeAttribute('data-intro-glow')
      closeTimer = setTimeout(() => {
        closeTimer = 0
        mode = 'moving'
        delete section.dataset.wagonStopped
        delete section.dataset.wagonClosing
        schedule()
      }, reducedMotion.matches ? 0 : 640)
    }

    // Shared scroll scale: every wagon moves the same fraction of its length per scroll pixel.
    const limit = maxWagonsPerPass / 2
    const travel = reducedMotion.matches ? 0 : Math.max(-limit, Math.min(limit, centerOffset / Math.max(1, innerHeight * .8)))
    const phase = ((travel % 1) + 1) % 1
    track.style.transform = `translate3d(${-(carriageCount / 2 + phase) / carriageCount * 100}%, -50%, 0)`
    if (wagonsPerConsist) {
      predictionTrain.style.transform = `translateX(${-(limit + travel) * 50 / wagonsPerConsist}%)`
    }
  }

  function schedule() {
    if (animationFrame) return
    animationFrame = requestAnimationFrame(update)
  }

  section.querySelector('.carriage-leaf--left').addEventListener('transitionend', event => {
    if (section.id !== 'chat' && event.propertyName === 'transform' && mode === 'stopped' && !reducedMotion.matches) {
      section.setAttribute('data-intro-glow', '')
    }
  })
  window.addEventListener('scroll', schedule, { passive: true })
  window.addEventListener('resize', schedule)
  window.addEventListener('pageshow', schedule)
  section.addEventListener('focusin', schedule)
  section.addEventListener('focusout', schedule)
  reducedMotion.addEventListener('change', schedule)
  mobile.addEventListener('change', () => {
    clearTimeout(openTimer)
    clearTimeout(closeTimer)
    openTimer = 0
    closeTimer = 0
    inStopZone = false
    mode = 'moving'
    previousScroll = scrollY
    delete section.dataset.wagonStopped
    delete section.dataset.wagonClosing
    section.removeAttribute('data-intro-glow')
    track.style.removeProperty('transform')
    predictionTrain?.style.removeProperty('transform')
    frame.style.removeProperty('--door-travel')
    schedule()
  })
  new ResizeObserver(() => {
    section.style.setProperty('--wagon-stage-height', `${section.offsetHeight}px`)
    schedule()
  }).observe(section)
  if (section.id === 'chat') reserveScrollRoom(section, mobile)
  schedule()
}

function updateMobileDoors(section, frame, reducedMotion) {
  const { top, bottom, height } = frame.getBoundingClientRect()
  const isChat = section.id === 'chat'
  const visible = !section.hidden && bottom > 0 && top < innerHeight
  const openingStart = isChat ? top : top + height / 2
  const openingDistance = isChat ? Math.max(1, height / 2) : innerHeight * .18
  const tableLead = section.id === 'announce' ? openingDistance : 0
  const opening = (innerHeight / 2 - openingStart + tableLead) / openingDistance
  const closingEnd = innerHeight * .18
  const closingStart = innerHeight * .27 + height / 2
  const closing = isChat ? 1 : (bottom - closingEnd) / (closingStart - closingEnd)
  const inOpeningZone = visible && scrollY > 1 && opening > 0 && closing > 0
  const progress = inOpeningZone ? (reducedMotion ? 1 : Math.min(1, opening, closing)) : 0
  const travel = progress * progress * (3 - 2 * progress) * 100
  frame.style.setProperty('--door-travel', `${travel.toFixed(2)}%`)

  if (isChat) return
  if (!visible || progress < .1 || reducedMotion) section.removeAttribute('data-intro-glow')
  else if (progress >= (section.id === 'announce' ? 1 : .9)) section.setAttribute('data-intro-glow', '')
}

function reserveScrollRoom(section, mobile) {
  const page = document.scrollingElement
  let extra = 0

  function adjust() {
    const target = mobile.matches ? section.querySelector('.carriage-frame') : section
    const { top, height } = target.getBoundingClientRect()
    const endWithoutExtra = page.scrollHeight - page.clientHeight - extra
    const sectionCenter = top + page.scrollTop + height / 2
    // The last carriage must be able to leave the stop zone before the page ends.
    const stopLine = page.clientHeight * (mobile.matches ? .50 : .18)
    const required = Math.max(0, Math.ceil(sectionCenter - stopLine - endWithoutExtra + 1))
    if (required === extra) return
    extra = required
    page.style.setProperty('--chat-opening-space', `${extra}px`)
  }

  const observer = new ResizeObserver(adjust)
  observer.observe(section)
  observer.observe(document.querySelector('footer'))
  observer.observe(document.querySelector('.broadcast-controls'))
  window.addEventListener('resize', adjust)
  mobile.addEventListener('change', adjust)
}
