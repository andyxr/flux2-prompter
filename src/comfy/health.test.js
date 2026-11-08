import { describe, expect, it } from 'vitest'
import { ComfyClient } from './client.js'
import { checkHealth } from './health.js'
import { CAPTION_MODEL } from './workflows.js'

function client(florence) {
  return new ComfyClient('/comfy', async (input) => {
    const url = String(input)
    if (url === '/comfy/system_stats') return Response.json({ system: {}, devices: [] })
    if (url === '/comfy/object_info/Florence2ModelLoader')
      return florence ? Response.json({ Florence2ModelLoader: { input: { required: { model: [florence] } } } }) : Response.json({})
    return Response.json([])
  })
}

describe('checkHealth: Florence-2', () => {
  it('is ready when the node lists the caption model', async () => {
    expect((await checkHealth(client([CAPTION_MODEL, 'GGUF']))).missing.florence).toEqual([])
  })
  it('reports a missing model', async () => {
    expect((await checkHealth(client(['GGUF']))).missing.florence).toEqual([{ file: CAPTION_MODEL, folder: 'LLM' }])
  })
  it('reports missing nodes', async () => {
    expect((await checkHealth(client(null))).missing.florence[0]).toMatchObject({ file: 'ComfyUI-Florence2', node: true })
  })
})
