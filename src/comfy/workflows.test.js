import { describe, expect, it } from 'vitest'
import { addReference, captionWorkflow, CAPTION_MODEL, findNodes, isLink, patchT2I, TURBO_STEPS, DEV_STEPS } from './workflows.js'
import { REQUIRED_MODELS } from './health.js'

const common = { positive: 'a red fox', negative: '', seed: 42, prefix: 'flux2-prompter/gen' }
const size = { width: 1152, height: 864 }

function dangling(wf) {
  return Object.entries(wf).flatMap(([id, n]) =>
    Object.values(n.inputs)
      .filter((v) => isLink(v) && !wf[v[0]])
      .map((v) => `${id} → ${v[0]}`),
  )
}
const byType = (wf, type) => findNodes(wf, { type }).map((id) => wf[id])
const files = (wf) =>
  Object.values(wf)
    .flatMap((n) => Object.values(n.inputs))
    .filter((v) => typeof v === 'string' && v.endsWith('.safetensors'))

describe('patchT2I (klein)', () => {
  const wf = patchT2I({ ...common, ...size })
  it('sets prompt, seed, size and prefix', () => {
    expect(byType(wf, 'CLIPTextEncode').map((n) => n.inputs.text)).toContain('a red fox')
    expect(byType(wf, 'RandomNoise')[0].inputs.noise_seed).toBe(42)
    expect(byType(wf, 'SaveImage')[0].inputs.filename_prefix).toBe('flux2-prompter/gen')
    expect(byType(wf, 'PrimitiveInt').map((n) => n.inputs.value)).toEqual(expect.arrayContaining([1152, 864]))
  })
  it('has no dangling links', () => expect(dangling(wf)).toEqual([]))
  it('loads the files the health check expects', () => {
    for (const m of REQUIRED_MODELS.klein) expect(files(wf)).toContain(m.file)
  })
  it('does not mutate the template', () => {
    const again = patchT2I({ ...common, positive: 'other', ...size })
    expect(byType(again, 'CLIPTextEncode').map((n) => n.inputs.text)).not.toContain('a red fox')
  })
})

describe('patchT2I (dev)', () => {
  it('without turbo uses the UNet and 20 steps', () => {
    const wf = patchT2I({ ...common, ...size, model: 'dev' })
    expect(dangling(wf)).toEqual([])
    expect(byType(wf, 'Flux2Scheduler')[0].inputs).toMatchObject({ ...size, steps: DEV_STEPS })
    expect(byType(wf, 'LoraLoaderModelOnly')).toHaveLength(0)
    for (const m of REQUIRED_MODELS.dev) expect(files(wf)).toContain(m.file)
  })
  it('with turbo routes through the LoRA at 8 steps', () => {
    const wf = patchT2I({ ...common, ...size, model: 'dev', turbo: true })
    expect(dangling(wf)).toEqual([])
    expect(byType(wf, 'Flux2Scheduler')[0].inputs.steps).toBe(TURBO_STEPS)
    const guider = byType(wf, 'BasicGuider')[0]
    expect(wf[guider.inputs.model[0]].class_type).toBe('LoraLoaderModelOnly')
    expect(files(wf)).toContain(REQUIRED_MODELS.turbo[0].file)
  })
})

describe('addReference', () => {
  it('chains numbered references onto klein positive and negative', () => {
    const wf = patchT2I({ ...common, ...size })
    addReference(wf, 'flux2-prompter/a.png', size)
    addReference(wf, 'flux2-prompter/b.png', size)
    expect(dangling(wf)).toEqual([])
    expect(wf.ref1_load.inputs.image).toBe('flux2-prompter/a.png')
    expect(wf.ref2_load.inputs.image).toBe('flux2-prompter/b.png')
    const g = byType(wf, 'CFGGuider')[0]
    expect(g.inputs.positive).toEqual(['ref2_positive', 0])
    expect(g.inputs.negative).toEqual(['ref2_negative', 0])
    expect(wf.ref2_positive.inputs.conditioning).toEqual(['ref1_positive', 0])
  })
  it('works on dev', () => {
    const wf = addReference(patchT2I({ ...common, ...size, model: 'dev', turbo: true }), 'x.png', size)
    expect(dangling(wf)).toEqual([])
    expect(byType(wf, 'BasicGuider')[0].inputs.conditioning).toEqual(['ref1_conditioning', 0])
  })
})

describe('captionWorkflow', () => {
  const wf = captionWorkflow('flux2-prompter/ref_abc.png')
  it('loads the image and Florence-2 model', () => {
    expect(byType(wf, 'LoadImage')[0].inputs.image).toBe('flux2-prompter/ref_abc.png')
    expect(byType(wf, 'Florence2ModelLoader')[0].inputs.model).toBe(CAPTION_MODEL)
    expect(byType(wf, 'Florence2Run')[0].inputs.task).toBe('more_detailed_caption')
  })
  it('previews the caption output (slot 2)', () => {
    const [id] = findNodes(wf, { type: 'Florence2Run' })
    expect(byType(wf, 'PreviewAny')[0].inputs.source).toEqual([id, 2])
  })
  it('has no dangling links', () => expect(dangling(wf)).toEqual([]))
})
