import { describe, expect, it, vi } from 'vitest'
import { ComfyClient, ComfyError } from './client.js'
import { ComfyRunner } from './run.js'

// A fake ComfyUI: /prompt queues, /history reports the job after `polls` checks.
function fakeComfy(history, opts = {}) {
  let checks = 0
  const calls = []
  const fetchFn = async (input, init) => {
    const url = String(input)
    calls.push(`${init?.method ?? 'GET'} ${url}`)
    if (url === '/comfy/prompt') {
      return opts.reject
        ? Response.json(opts.reject, { status: 400 })
        : Response.json({ prompt_id: 'p1', number: 1, node_errors: {} })
    }
    if (url === '/comfy/history/p1')
      return Response.json(++checks > (opts.polls ?? 0) ? { p1: history } : {})
    if (url.startsWith('/comfy/view?')) return new Response(new Blob([url]))
    return Response.json({})
  }
  return { runner: new ComfyRunner(new ComfyClient('/comfy', fetchFn)), calls }
}

const done = {
  status: { status_str: 'success', completed: true, messages: [] },
  outputs: { 9: { images: [{ filename: 'a_00001_.png', subfolder: 'flux2-prompter', type: 'output' }] } },
}

describe('ComfyRunner', () => {
  it('queues, waits for history and fetches the image', async () => {
    vi.useFakeTimers()
    const { runner, calls } = fakeComfy(done, { polls: 1 })
    const onProgress = vi.fn()
    const run = runner.run({}, { onProgress })
    await vi.advanceTimersByTimeAsync(5_000)
    const [png] = await run
    vi.useRealTimers()
    expect(await png.text()).toBe('/comfy/view?filename=a_00001_.png&subfolder=flux2-prompter&type=output')
    expect(onProgress).toHaveBeenCalledWith({ state: 'queued' })
    expect(calls.filter((c) => c.includes('/history/'))).toHaveLength(2)
  })

  it('reports ComfyUI execution errors', async () => {
    const failed = {
      status: {
        status_str: 'error',
        messages: [['execution_error', { node_type: 'VAEDecode', exception_message: 'Out of memory' }]],
      },
      outputs: {},
    }
    const { runner } = fakeComfy(failed)
    await expect(runner.run({})).rejects.toThrow(new ComfyError('VAEDecode: Out of memory'))
  })

  it('explains a rejected workflow', async () => {
    const reject = {
      error: { message: 'Prompt outputs failed validation' },
      node_errors: { '75:70': { class_type: 'UNETLoader', errors: [{ details: 'unet_name: x not in list' }] } },
    }
    const { runner } = fakeComfy(done, { reject })
    await expect(runner.run({})).rejects.toThrow(
      'ComfyUI rejected the job: Prompt outputs failed validation; UNETLoader: unet_name: x not in list',
    )
  })

  it('cancels: interrupts and dequeues the job', async () => {
    const { runner, calls } = fakeComfy(done, { polls: 100 })
    const ctrl = new AbortController()
    const run = runner.run({}, { signal: ctrl.signal })
    await vi.waitFor(() => expect(calls).toContain('GET /comfy/history/p1'))
    ctrl.abort()
    await expect(run).rejects.toThrow()
    await vi.waitFor(() => {
      expect(calls).toContain('POST /comfy/interrupt')
      expect(calls).toContain('POST /comfy/queue')
    })
  })

  it('frees VRAM before the first job and on a model switch only', async () => {
    const { runner, calls } = fakeComfy(done)
    await runner.enterPhase('klein')
    await runner.enterPhase('klein')
    await runner.enterPhase('dev')
    expect(calls.filter((c) => c === 'POST /comfy/free')).toHaveLength(2)
  })
})
