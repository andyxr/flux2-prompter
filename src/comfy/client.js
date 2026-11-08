// ComfyUI HTTP client, ported from boarder (src/core/comfy/client.ts).
// The browser only talks to the same-origin /comfy proxy (vite.config.js);
// tests may pass an absolute base and a fake fetch.

export const COMFY_BASE = '/comfy'

/** ComfyUI rejected or failed a job; `message` is meant for people. */
export class ComfyError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ComfyError'
  }
}

export class ComfyClient {
  constructor(base = COMFY_BASE, fetchFn = (...a) => fetch(...a)) {
    this.base = base
    this.fetchFn = fetchFn
  }

  async request(path, init) {
    const res = await this.fetchFn(`${this.base}${path}`, init)
    if (!res.ok) throw new ComfyError(`ComfyUI ${path}: HTTP ${res.status}${await detail(res)}`)
    return res
  }

  async getJson(path, signal) {
    return (await this.request(path, { signal })).json()
  }

  post(path, body, signal) {
    return this.request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
  }

  async systemStats(signal) {
    const s = await this.getJson('/system_stats', signal)
    if (!s || !Array.isArray(s.devices)) throw new ComfyError('Unexpected /system_stats reply')
    return s
  }

  async models(folder, signal) {
    const list = await this.getJson(`/models/${folder}`, signal)
    if (!Array.isArray(list)) throw new ComfyError(`Unexpected /models/${folder} reply`)
    return list.map(String)
  }

  /** Uploads to ComfyUI's input folder; returns the name a LoadImage node takes. */
  async uploadImage(blob, filename, opts = {}) {
    const form = new FormData()
    form.append('image', blob, filename)
    form.append('overwrite', 'true')
    if (opts.subfolder) form.append('subfolder', opts.subfolder)
    const res = await this.request('/upload/image', { method: 'POST', body: form, signal: opts.signal })
    const up = await res.json()
    if (!up || typeof up.name !== 'string') throw new ComfyError('Unexpected /upload/image reply')
    return up.subfolder ? `${up.subfolder}/${up.name}` : up.name
  }

  /** Queues a workflow and returns its prompt id. */
  async queue(workflow, clientId, signal) {
    const res = await this.fetchFn(`${this.base}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow, client_id: clientId }),
      signal,
    })
    const body = await res.json().catch(() => null)
    if (!res.ok) throw new ComfyError(`ComfyUI rejected the job: ${promptError(body)}`)
    if (!body || typeof body.prompt_id !== 'string') throw new ComfyError('Unexpected /prompt reply')
    return body.prompt_id
  }

  /** The finished job, or undefined while it is still queued or running. */
  async history(promptId, signal) {
    const all = await this.getJson(`/history/${encodeURIComponent(promptId)}`, signal)
    const entry = all?.[promptId]
    if (entry === undefined) return undefined
    return { status: entry.status, outputs: entry.outputs ?? {} }
  }

  async view(file, signal) {
    const q = new URLSearchParams({ filename: file.filename, subfolder: file.subfolder, type: file.type })
    return (await this.request(`/view?${q}`, { signal })).blob()
  }

  /** Stops a job: interrupts it if it is running and drops it from the queue. */
  async cancel(promptId) {
    await Promise.all([
      this.post('/interrupt', { prompt_id: promptId }).catch(() => {}),
      this.post('/queue', { delete: [promptId] }).catch(() => {}),
    ])
  }

  /** Unloads models and frees VRAM. */
  async free() {
    await this.post('/free', { unload_models: true, free_memory: true })
  }

  /** The /ws URL for live progress. */
  socketUrl(clientId) {
    const base = /^https?:/.test(this.base) ? this.base : `${globalThis.location.origin}${this.base}`
    return `${base.replace(/^http/, 'ws')}/ws?clientId=${encodeURIComponent(clientId)}`
  }
}

async function detail(res) {
  const text = await res.text().catch(() => '')
  return text ? ` ${text.slice(0, 300)}` : ''
}

// /prompt's 400 body: { error: { message, details }, node_errors: { id: { errors: [...] } } }
export function promptError(body) {
  const nodes = Object.entries(body?.node_errors ?? {}).flatMap(([id, n]) =>
    (n?.errors ?? []).map((e) => `${n.class_type ?? id}: ${e.details || e.message}`),
  )
  return [body?.error?.message, ...nodes].filter(Boolean).join('; ') || 'unknown error'
}

// "cuda:0 NVIDIA GeForce RTX 5090 : cudaMallocAsync" → "RTX 5090"
export function gpuLabel(deviceName) {
  const name = deviceName.replace(/^\w+:\d+\s+/, '').replace(/\s*:.*$/, '')
  return name.replace(/^NVIDIA\s+(GeForce\s+)?/, '').trim() || deviceName
}
