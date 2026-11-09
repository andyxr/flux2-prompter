import { ComfyRunner } from './comfy/run.js'
import { checkHealth } from './comfy/health.js'
import { patchT2I, addReference, captionWorkflow, CAPTION_MODEL, REF_CAPS } from './comfy/workflows.js'
import * as store from './gallery/store.js'

// Generate panel, gallery and viewer. Talks to the prompt builder through the
// small window.F2P bridge the main script exposes.

const F2P = window.F2P
const $ = (id) => document.getElementById(id)
const MODEL_KEY = 'flux2-gen-model'
const TURBO_KEY = 'flux2-gen-turbo'
const LABEL = { klein: 'FLUX.2 [klein] 9B', dev: 'FLUX.2 [dev]' }

const runner = new ComfyRunner()
let health = { status: 'checking' }
let job = null // { controller }
let images = [] // gallery records, newest first
let viewIndex = -1
let lastError = '' // the last job's failure, shown until the next edit or job
const urls = new Map() // id → object URL

const el = {
  card: $('gen-card'),
  model: $('gen-model'),
  turbo: $('gen-turbo'),
  turboWrap: $('gen-turbo-wrap'),
  turboHint: $('gen-turbo-hint'),
  go: $('gen-go'),
  cancel: $('gen-cancel'),
  sbText: $('sb-text'),
  sbRecheck: $('sb-recheck'),
  progress: $('gen-progress'),
  bar: $('gen-bar'),
  pct: $('gen-pct'),
  msg: $('gen-msg'),
  gallery: $('gallery'),
  count: $('gallery-count'),
  viewer: $('viewer'),
  vImg: $('v-img'),
  vMeta: $('v-meta'),
  vPrompt: $('v-prompt'),
}

el.card.classList.add('live')

/* ---------- local model picker ---------- */
function fromPromptModel(m) {
  return m === 'klein9' ? 'klein' : m === 'dev' ? 'dev' : null
}
function readPref(key) {
  try { return localStorage.getItem(key) } catch { return null }
}
function writePref(key, v) {
  try { localStorage.setItem(key, v) } catch {}
}
el.model.value = readPref(MODEL_KEY) || fromPromptModel(F2P.getState().model) || 'dev'
el.turbo.checked = readPref(TURBO_KEY) !== '0'
let lastPromptModel = F2P.getState().model
el.model.addEventListener('change', () => { writePref(MODEL_KEY, el.model.value); update() })
el.turbo.addEventListener('change', () => { writePref(TURBO_KEY, el.turbo.checked ? '1' : '0'); update() })
F2P.onChange(() => {
  lastError = ''
  const m = F2P.getState().model
  if (m !== lastPromptModel) {
    lastPromptModel = m
    const local = fromPromptModel(m)
    if (local) { el.model.value = local; writePref(MODEL_KEY, local) }
  }
  update()
})

/* ---------- readiness ---------- */
function missingFor(model, turbo) {
  if (health.status !== 'connected') return []
  const m = [...health.missing[model]]
  if (model === 'dev' && turbo) m.push(...health.missing.turbo)
  return m
}

/** Why Generate can't run right now, or '' when it can. */
function blocker() {
  const model = el.model.value
  const turbo = model === 'dev' && el.turbo.checked
  if (health.status === 'checking') return 'Checking ComfyUI…'
  if (health.status === 'offline') return 'ComfyUI is offline. Start it, or set COMFY_URL in .env.local and restart npm run dev.'
  const missing = missingFor(model, turbo)
  if (missing.length) return `Missing for ${LABEL[model]}: ${missing.map((m) => `${m.folder}/${m.file}`).join(', ')}`
  const S = F2P.getState()
  if (!F2P.build().trim()) return 'Write a prompt first.'
  const cap = REF_CAPS[model]
  if (S.refs.length > cap) return `${LABEL[model]} takes up to ${cap} references; ${S.refs.length} are attached.`
  const noThumb = S.refs.findIndex((r) => !F2P.getThumb(r.id))
  if (noThumb >= 0) return `Attach a picture for image ${noThumb + 1}, or remove it. Pictures aren't kept after a reload.`
  return F2P.seedError()
}

function update() {
  // The Turbo LoRA is trained for FLUX.2 [dev]; klein shows the option greyed out.
  const isDev = el.model.value === 'dev'
  el.turbo.checked = isDev && readPref(TURBO_KEY) !== '0' // klein shows it unticked; dev's choice is remembered
  el.turbo.disabled = !isDev || !!job
  el.turboWrap.classList.toggle('off', !isDev)
  el.turboHint.textContent = isDev ? (el.turbo.checked ? '8 steps, faster' : '20 steps, full quality') : 'only for FLUX.2 [dev]'
  el.turboWrap.title = isDev ? 'Flux_2-Turbo-LoRA: 8 sampling steps instead of 20' : 'The Turbo LoRA only works with FLUX.2 [dev]. Switch "Generate with" to dev to use it.'
  const why = blocker()
  el.go.disabled = !!job || !!why
  el.cancel.hidden = !job
  if (!job) {
    if (lastError) setMsg(lastError, 'err')
    else setMsg(why && health.status !== 'checking' ? why : '', why ? 'warn' : '')
  }
  const d = F2P.dims()
  const n = F2P.getState().refs.length
  el.go.title = `${d.w}×${d.h}${n ? ` with ${n} reference${n > 1 ? 's' : ''}` : ''}`
}

function setMsg(text, kind = '') {
  el.msg.textContent = text
  el.msg.className = `gen-msg ${kind}`
}

/* ---------- health + status bar ---------- */
// Like boarder's status bar: "Connected · RTX 5090 · ComfyUI 0.44 · klein 9B ✓ · dev ✓ · Turbo LoRA ✓".
// Re-checks every 5 s while ComfyUI is down, every 60 s once it's up, and on window focus.
const GROUPS = [
  ['klein', 'klein 9B'],
  ['dev', 'dev'],
  ['turbo', 'Turbo LoRA'],
  ['florence', 'Florence-2'],
]
let healthTimer
let checking = false
async function refreshHealth() {
  if (checking) return
  checking = true
  clearTimeout(healthTimer)
  renderStatusBar()
  try {
    health = await checkHealth(runner.client)
  } finally {
    checking = false
  }
  update()
  renderStatusBar()
  F2P.setCaptionBlock(captionBlocker())
  healthTimer = setTimeout(refreshHealth, health.status === 'connected' ? 60_000 : 5_000)
}
window.addEventListener('focus', () => { if (!job) refreshHealth() })
el.sbRecheck.hidden = false
el.sbRecheck.addEventListener('click', refreshHealth)

const SEP = '<span class="sb-sep" aria-hidden="true">·</span>'
let lastStatus = ''
function renderStatusBar() {
  el.sbRecheck.disabled = checking
  el.sbRecheck.classList.toggle('spin', checking)
  let html
  if (health.status === 'checking') {
    html = '<span class="sb-dot" data-state="checking"></span><span>Checking ComfyUI…</span>'
  } else if (health.status === 'offline') {
    html =
      '<span class="sb-dot" data-state="offline"></span><span class="sb-strong">ComfyUI not reachable</span>' +
      SEP +
      '<span>Start ComfyUI, or set <code>COMFY_URL</code> in <code>.env.local</code> and restart <code>npm run dev</code>. Building prompts still works.</span>'
  } else {
    html = '<span class="sb-dot" data-state="connected"></span><span class="sb-strong">Connected</span>'
    if (health.gpu) html += SEP + `<span>${escAttr(health.gpu)}</span>`
    if (health.version) html += SEP + `<span>ComfyUI ${escAttr(health.version)}</span>`
    for (const [g, label] of GROUPS) {
      const miss = health.missing[g]
      html += SEP
      html += miss.length
        ? `<span class="sb-miss" tabindex="0" title="${miss.map((m) => escAttr(m.node ? `${m.file} custom nodes → ComfyUI/custom_nodes/` : `${m.file} → ComfyUI/models/${m.folder}/`)).join('&#10;')}">${label} <b aria-label="missing">✕</b> ${miss.length} missing</span>`
        : `<span>${label} <b class="sb-ok" aria-label="present">✓</b></span>`
    }
  }
  if (html !== lastStatus) {
    el.sbText.innerHTML = html
    lastStatus = html
  }
}

/* ---------- captions (Florence-2) ---------- */
/** Why reference captioning can't run right now, or ''. */
function captionBlocker() {
  if (health.status === 'checking') return 'Checking ComfyUI…'
  if (health.status === 'offline') return 'ComfyUI is offline. Start it to caption pictures.'
  const [m] = health.missing.florence ?? []
  if (m?.node) return 'Captioning needs the ComfyUI-Florence2 custom nodes in ComfyUI/custom_nodes/.'
  if (m) return `Captioning needs ${CAPTION_MODEL} in ComfyUI/models/LLM/.`
  return ''
}

F2P.setCaptioner(async (dataUrl) => {
  const [text] = await runner.runText(captionWorkflow(await uploadRef(dataUrl)))
  return text
})
F2P.setCaptionBlock(captionBlocker())

/* ---------- generate ---------- */
function randomSeed() {
  return crypto.getRandomValues(new Uint32Array(1))[0]
}

async function sha(blob) {
  const buf = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return [...new Uint8Array(buf)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function uploadRef(dataUrl, signal) {
  const blob = await (await fetch(dataUrl)).blob()
  const ext = (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace(/\W/g, '')
  return runner.client.uploadImage(blob, `ref_${await sha(blob)}.${ext}`, { subfolder: 'flux2-prompter', signal })
}

function showProgress(p) {
  el.progress.hidden = false
  if (p.state === 'queued') {
    el.bar.style.width = '0%'
    el.pct.textContent = 'Queued in ComfyUI…'
  } else if (p.max) {
    const pc = Math.round((100 * p.value) / p.max)
    el.bar.style.width = `${pc}%`
    el.pct.textContent = `Step ${p.value} of ${p.max} · ${pc}%`
  } else {
    el.pct.textContent = 'Loading model…'
  }
}

async function generate() {
  if (job || blocker()) return
  const S = F2P.getState()
  const model = el.model.value
  const turbo = model === 'dev' && el.turbo.checked
  const prompt = F2P.build()
  const d = F2P.dims()
  const size = { width: d.w, height: d.h }
  const fixed = String(S.seed ?? '').trim()
  const seed = fixed ? Number(fixed) : randomSeed() // blocker() has already rejected a bad seed
  const refs = S.refs.map((r) => F2P.getThumb(r.id))

  job = { controller: new AbortController() }
  const { signal } = job.controller
  lastError = ''
  update()
  setMsg('')
  el.progress.hidden = false
  el.bar.style.width = '0%'
  el.pct.textContent = `${refs.length ? 'Uploading references…' : 'Starting…'} · seed ${seed}`
  try {
    const wf = patchT2I({ positive: prompt, negative: '', seed, prefix: 'flux2-prompter/gen', model, turbo, ...size })
    for (const dataUrl of refs) addReference(wf, await uploadRef(dataUrl, signal), size)
    el.pct.textContent = 'Freeing VRAM…'
    await runner.enterPhase(model)
    const [png] = await runner.run(wf, { signal, onProgress: showProgress })
    const rec = await store.add({
      id: crypto.randomUUID(),
      png,
      prompt,
      format: S.format,
      seed,
      model,
      turbo,
      width: d.w,
      height: d.h,
      aspect: S.aspect,
      refCount: refs.length,
      createdAt: Date.now(),
    })
    images.unshift(rec)
    renderGallery()
    openViewer(0)
  } catch (e) {
    if (!signal.aborted) lastError = e instanceof Error ? e.message : String(e)
  } finally {
    job = null
    el.progress.hidden = true
    update()
  }
}

el.go.addEventListener('click', generate)
el.cancel.addEventListener('click', () => {
  job?.controller.abort()
  el.pct.textContent = 'Cancelling…'
})

/* ---------- gallery ---------- */
function url(rec) {
  let u = urls.get(rec.id)
  if (!u) { u = URL.createObjectURL(rec.png); urls.set(rec.id, u) }
  return u
}

function metaText(rec) {
  const when = new Date(rec.createdAt).toLocaleString()
  return `${LABEL[rec.model] ?? rec.model}${rec.turbo ? ' Turbo' : ''} · ${rec.width}×${rec.height} · seed ${rec.seed}${rec.refCount ? ` · ${rec.refCount} ref${rec.refCount > 1 ? 's' : ''}` : ''} · ${when}`
}

function renderGallery() {
  el.count.textContent = images.length ? String(images.length) : ''
  el.gallery.innerHTML = ''
  if (!images.length) {
    el.gallery.innerHTML = '<p class="hint">Generated images appear here. They\'re kept in this browser.</p>'
    return
  }
  images.forEach((rec, i) => {
    const tile = document.createElement('div')
    tile.className = 'tile'
    tile.innerHTML =
      `<button type="button" class="tile-open" aria-label="View image ${i + 1}" title="${escAttr(metaText(rec))}"><img alt="" loading="lazy"></button>` +
      '<div class="tile-acts">' +
      `<button type="button" class="tile-btn" data-a="seed" aria-label="Use seed ${rec.seed}" title="Use seed ${rec.seed}">#</button>` +
      '<button type="button" class="tile-btn" data-a="full" aria-label="View full screen" title="Full screen">⛶</button>' +
      '<button type="button" class="tile-btn" data-a="del" aria-label="Delete image" title="Delete">✕</button>' +
      '</div>'
    tile.querySelector('img').src = url(rec)
    tile.querySelector('.tile-open').addEventListener('click', () => openViewer(i))
    tile.querySelector('[data-a=seed]').addEventListener('click', (e) => { e.stopPropagation(); useSeed(rec) })
    tile.querySelector('[data-a=full]').addEventListener('click', () => openViewer(i, true))
    armDelete(tile.querySelector('[data-a=del]'), () => deleteImage(rec.id), '✕', '?')
    el.gallery.appendChild(tile)
  })
}

function escAttr(t) {
  return String(t).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

/** Two-click delete (no confirm(): it blocks the page). */
function armDelete(btn, action, idle, armedText) {
  let t = null
  btn.addEventListener('click', (e) => {
    e.stopPropagation()
    if (!t) {
      btn.classList.add('armed')
      btn.textContent = armedText
      btn.title = 'Click again to delete'
      t = setTimeout(() => { btn.classList.remove('armed'); btn.textContent = idle; btn.title = 'Delete'; t = null }, 3000)
      return
    }
    clearTimeout(t)
    t = null
    btn.classList.remove('armed')
    btn.textContent = idle
    action()
  })
}

async function deleteImage(id) {
  const i = images.findIndex((r) => r.id === id)
  if (i < 0) return
  await store.remove(id)
  images.splice(i, 1)
  const u = urls.get(id)
  if (u) { URL.revokeObjectURL(u); urls.delete(id) }
  renderGallery()
  if (el.viewer.open) {
    if (!images.length) closeViewer()
    else showInViewer(Math.min(i, images.length - 1))
  }
}

/* ---------- viewer ---------- */
function showInViewer(i) {
  viewIndex = i
  const rec = images[i]
  el.vImg.src = url(rec)
  el.vImg.alt = `Generated image ${i + 1} of ${images.length}`
  el.vMeta.textContent = `${i + 1} / ${images.length} · ${metaText(rec)}`
  el.vPrompt.textContent = rec.prompt
  $('v-seed').textContent = `Use seed ${rec.seed}`
  $('v-seed').title = 'Set this as the fixed seed for the next runs'
  $('v-prev').disabled = i <= 0
  $('v-next').disabled = i >= images.length - 1
}

function openViewer(i, fullscreen = false) {
  showInViewer(i)
  if (!el.viewer.open) el.viewer.showModal()
  if (fullscreen) toggleFullscreen(true)
}

function closeViewer() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
  if (el.viewer.open) el.viewer.close()
}

function toggleFullscreen(on = !document.fullscreenElement) {
  // <dialog> itself can't go fullscreen in Chrome, so its inner shell does.
  if (on && !document.fullscreenElement) $('v-shell').requestFullscreen?.().catch((e) => console.warn('[gen] fullscreen:', e.message))
  else if (!on && document.fullscreenElement) document.exitFullscreen().catch(() => {})
}

$('v-prev').addEventListener('click', () => viewIndex > 0 && showInViewer(viewIndex - 1))
$('v-next').addEventListener('click', () => viewIndex < images.length - 1 && showInViewer(viewIndex + 1))
$('v-full').addEventListener('click', () => toggleFullscreen())
$('v-close').addEventListener('click', closeViewer)
$('v-prompt-toggle').addEventListener('click', () => {
  const p = el.vPrompt
  p.hidden = !p.hidden
  $('v-prompt-toggle').setAttribute('aria-pressed', String(!p.hidden))
})
/** Make this image's seed the fixed seed for the next runs. */
function useSeed(rec) {
  F2P.setSeed(rec.seed)
  if (!job) setMsg(`Seed set to ${rec.seed}. Click Random to go back to a new seed each run.`)
}
$('v-seed').addEventListener('click', () => {
  const rec = images[viewIndex]
  if (!rec) return
  useSeed(rec)
  $('v-seed').textContent = `Seed ${rec.seed} set ✓`
})
$('v-download').addEventListener('click', () => {
  const rec = images[viewIndex]
  if (!rec) return
  const a = document.createElement('a')
  a.href = url(rec)
  a.download = `flux2-${rec.model}-${rec.seed}.png`
  a.click()
})
armDelete($('v-delete'), () => images[viewIndex] && deleteImage(images[viewIndex].id), 'Delete', 'Click again to delete')
el.viewer.addEventListener('click', (e) => { if (e.target === el.viewer || e.target.classList.contains('v-stage')) closeViewer() })
el.viewer.addEventListener('close', () => { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}) })
document.addEventListener('fullscreenchange', () => {
  $('v-full').textContent = document.fullscreenElement ? 'Exit full screen' : 'Full screen'
})
el.viewer.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') $('v-prev').click()
  else if (e.key === 'ArrowRight') $('v-next').click()
  else if (e.key === 'f' || e.key === 'F') toggleFullscreen()
})

/* ---------- start ---------- */
store.persist()
store.list().then((all) => { images = all; renderGallery() }).catch((e) => setMsg(`Couldn't load the gallery: ${e.message}`, 'err'))
update()
refreshHealth()
