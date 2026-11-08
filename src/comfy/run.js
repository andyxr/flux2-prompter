import { ComfyClient, ComfyError } from './client.js'

// Runs a workflow to completion, ported from boarder (src/core/comfy/run.ts):
// queue it, follow live progress on /ws, read the result from /history. The
// socket only speeds things up; a slow poll of /history still finishes the job.
//
// Progress: { state: 'queued' } | { state: 'running', value?, max? }

const POLL_MS = 2_000
/** A /history check that takes longer is dropped and tried again. */
const HISTORY_TIMEOUT_MS = 15_000
/** Failed /history checks in a row before giving up. */
const HISTORY_RETRIES = 5

export class ComfyRunner {
  constructor(client = new ComfyClient()) {
    this.client = client
    this.clientId = crypto.randomUUID()
    this.ws = undefined
    this.phase = undefined
    this.listeners = new Map()
  }

  socket() {
    if (this.ws || typeof WebSocket === 'undefined') return
    try {
      const ws = new WebSocket(this.client.socketUrl(this.clientId))
      ws.onmessage = (e) => {
        if (typeof e.data !== 'string') return // binary previews
        const msg = JSON.parse(e.data)
        const id = msg.data?.prompt_id
        if (id) this.listeners.get(id)?.(msg)
      }
      ws.onclose = () => {
        if (this.ws === ws) this.ws = undefined
      }
      this.ws = ws
    } catch {
      // No socket: polling alone still works.
    }
  }

  /**
   * Frees VRAM whenever the model changes ('klein' | 'dev'), so the two are
   * never loaded together. Before the first job it always frees, since a model
   * may still be loaded from another app.
   */
  async enterPhase(phase) {
    if (this.phase !== phase) await this.client.free()
    this.phase = phase
  }

  /** Queues `workflow` and resolves with its output images (Blobs), in output order. */
  async run(workflow, opts = {}) {
    this.socket()
    const promptId = await this.client.queue(workflow, this.clientId, opts.signal)
    const { entry, failure } = await this.finish(promptId, opts)
    const files = outputs(entry, failure)
    return Promise.all(files.map((f) => this.client.view(f, opts.signal)))
  }

  /** Queues `workflow` and resolves with its text outputs (e.g. PreviewAny), in output order. */
  async runText(workflow, opts = {}) {
    this.socket()
    const promptId = await this.client.queue(workflow, this.clientId, opts.signal)
    const { entry, failure } = await this.finish(promptId, opts)
    return textOutputs(entry, failure)
  }

  async finish(promptId, opts) {
    const { signal, onProgress } = opts
    onProgress?.({ state: 'queued' })

    let wake = () => {}
    let failure
    this.listeners.set(promptId, (m) => {
      const d = m.data ?? {}
      if (m.type === 'execution_start') onProgress?.({ state: 'running' })
      else if (m.type === 'progress')
        onProgress?.({ state: 'running', value: Number(d.value), max: Number(d.max) })
      else if (m.type === 'execution_error') failure = errorText(d)
      if (['execution_success', 'execution_error', 'execution_interrupted'].includes(m.type)) wake()
      if (m.type === 'executing' && d.node === null) wake()
    })
    const onAbort = () => {
      void this.client.cancel(promptId)
      wake()
    }
    signal?.addEventListener('abort', onAbort)

    try {
      let failures = 0
      for (;;) {
        signal?.throwIfAborted()
        // ComfyUI sometimes stalls a /history connection; each check has its own timeout.
        const check = new AbortController()
        const timer = setTimeout(() => check.abort(), HISTORY_TIMEOUT_MS)
        let entry
        try {
          entry = await this.client.history(
            promptId,
            signal ? AbortSignal.any([signal, check.signal]) : check.signal,
          )
          failures = 0
        } catch (e) {
          signal?.throwIfAborted()
          if (e instanceof ComfyError || ++failures > HISTORY_RETRIES) throw e
        } finally {
          clearTimeout(timer)
        }
        if (entry) return { entry, failure }
        await new Promise((resolve) => {
          const t = setTimeout(resolve, POLL_MS)
          wake = () => {
            clearTimeout(t)
            resolve()
          }
        })
      }
    } finally {
      this.listeners.delete(promptId)
      signal?.removeEventListener('abort', onAbort)
    }
  }
}

function throwIfFailed(entry, failure) {
  if (entry.status?.status_str === 'error') {
    const msg = entry.status.messages?.find(([t]) => t === 'execution_error')?.[1]
    throw new ComfyError(failure ?? errorText(msg))
  }
}

function textOutputs(entry, failure) {
  throwIfFailed(entry, failure)
  const texts = Object.values(entry.outputs).flatMap((o) => o?.text ?? []).map(String)
  if (texts.length === 0) throw new ComfyError('The job finished without a text output')
  return texts
}

function outputs(entry, failure) {
  throwIfFailed(entry, failure)
  const files = Object.values(entry.outputs).flatMap((o) => o?.images ?? [])
  if (files.length === 0) throw new ComfyError('The job finished without an output')
  return files
}

function errorText(d) {
  if (!d) return 'The job failed in ComfyUI'
  const node = d.node_type ? `${String(d.node_type)}: ` : ''
  return `${node}${String(d.exception_message ?? 'failed').trim()}`
}
