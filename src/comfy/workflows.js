import kleinT2i from '../workflows/flux2_klein_t2i.api.json'
import devT2i from '../workflows/flux2_dev_t2i.api.json'

// Patches copies of the vendored API-format FLUX.2 workflows, ported from
// boarder (src/core/comfy/workflows.ts). Nodes are found by class_type, and by
// title where a type appears twice; never by id, so a re-vendored template
// with new ids still works.

export const TEMPLATES = { klein: kleinT2i, dev: devT2i }

const POSITIVE = { type: 'CLIPTextEncode', title: /positive/i }
const NEGATIVE = { type: 'CLIPTextEncode', title: /negative/i }
const NOISE = { type: 'RandomNoise' }
const SAVE = { type: 'SaveImage' }
const UNET = { type: 'UNETLoader' }
const VAE = { type: 'VAELoader' }
const GUIDER = { type: 'CFGGuider' }
const BASIC_GUIDER = { type: 'BasicGuider' }
const LATENT = { type: 'EmptyFlux2LatentImage' }
const SCHEDULER = { type: 'Flux2Scheduler' }
const LORA = { type: 'LoraLoaderModelOnly' }
const WIDTH = { type: 'PrimitiveInt', title: /^width$/i }
const HEIGHT = { type: 'PrimitiveInt', title: /^height$/i }

/** Steps for FLUX.2 [dev] (the template's non-Turbo value). */
export const DEV_STEPS = 20
/** Steps with the template's Turbo LoRA. */
export const TURBO_STEPS = 8

/** Reference caps for local generation (the app's MODELS caps). */
export const REF_CAPS = { klein: 4, dev: 6 }

const matches = (n, spec) =>
  n.class_type === spec.type && (!spec.title || spec.title.test(n._meta?.title ?? ''))

export function findNodes(wf, spec) {
  return Object.keys(wf).filter((id) => matches(wf[id], spec))
}

function one(wf, spec) {
  const ids = findNodes(wf, spec)
  if (ids.length !== 1) {
    const what = spec.title ? `${spec.type} “${spec.title.source}”` : spec.type
    throw new Error(`Workflow template has ${ids.length} ${what} nodes, expected 1`)
  }
  return wf[ids[0]]
}

export const isLink = (v) => Array.isArray(v) && v.length === 2 && typeof v[0] === 'string'

/**
 * The text-to-image workflow at width × height, on klein unless `model` is 'dev'.
 * opts: { positive, negative, seed, prefix, width, height, model?, turbo? }
 */
export function patchT2I(opts) {
  if (opts.model === 'dev') return patchDevT2I(opts)
  const wf = structuredClone(TEMPLATES.klein)
  one(wf, POSITIVE).inputs.text = opts.positive
  one(wf, NEGATIVE).inputs.text = opts.negative ?? ''
  one(wf, NOISE).inputs.noise_seed = opts.seed
  one(wf, SAVE).inputs.filename_prefix = opts.prefix
  one(wf, WIDTH).inputs.value = opts.width
  one(wf, HEIGHT).inputs.value = opts.height
  return wf
}

/**
 * FLUX.2 [dev] text-to-image. Dev is guidance-distilled, so it has no negative
 * prompt. The template's Turbo switch is resolved here and the unused branch pruned.
 */
function patchDevT2I(opts) {
  const wf = structuredClone(TEMPLATES.dev)
  one(wf, POSITIVE).inputs.text = opts.positive
  one(wf, NOISE).inputs.noise_seed = opts.seed
  one(wf, SAVE).inputs.filename_prefix = opts.prefix
  const size = { width: opts.width, height: opts.height }
  Object.assign(one(wf, LATENT).inputs, size)
  Object.assign(one(wf, SCHEDULER).inputs, size, { steps: opts.turbo ? TURBO_STEPS : DEV_STEPS })
  const model = findNodes(wf, opts.turbo ? LORA : UNET)[0]
  one(wf, BASIC_GUIDER).inputs.model = [model, 0]
  prune(wf, findNodes(wf, SAVE))
  return wf
}

/**
 * Adds a reference image: encoded and attached to the guider's conditioning
 * (positive and negative for klein's CFGGuider, the one input of dev's
 * BasicGuider) with ReferenceLatent. References are numbered in call order, so
 * the first call is "image 1".
 */
export function addReference(wf, image, size) {
  const basic = findNodes(wf, BASIC_GUIDER).length > 0
  const guider = one(wf, basic ? BASIC_GUIDER : GUIDER)
  const sides = basic ? ['conditioning'] : ['positive', 'negative']
  const vae = findNodes(wf, VAE)[0]
  if (!vae) throw new Error('Workflow has no VAELoader')
  let n = 1
  while (wf[`ref${n}_load`]) n++
  const id = (s) => `ref${n}_${s}`
  wf[id('load')] = { class_type: 'LoadImage', inputs: { image }, _meta: { title: 'Reference' } }
  wf[id('scale')] = {
    class_type: 'ImageScaleToTotalPixels',
    inputs: {
      image: [id('load'), 0],
      upscale_method: 'lanczos',
      megapixels: (size.width * size.height) / 2 ** 20,
      resolution_steps: 16,
    },
  }
  wf[id('encode')] = { class_type: 'VAEEncode', inputs: { pixels: [id('scale'), 0], vae: [vae, 0] } }
  for (const side of sides) {
    wf[id(side)] = {
      class_type: 'ReferenceLatent',
      inputs: { conditioning: guider.inputs[side], latent: [id('encode'), 0] },
    }
    guider.inputs[side] = [id(side), 0]
  }
  return wf
}

/** Drops every node the outputs don't depend on. */
function prune(wf, outputs) {
  const keep = new Set()
  const visit = (id) => {
    if (keep.has(id) || !wf[id]) return
    keep.add(id)
    for (const v of Object.values(wf[id].inputs)) if (isLink(v)) visit(v[0])
  }
  outputs.forEach(visit)
  for (const id of Object.keys(wf)) if (!keep.has(id)) delete wf[id]
}

/** The Florence-2 model the caption workflow loads (from ComfyUI/models/LLM). */
export const CAPTION_MODEL = 'Florence-2-large'

/**
 * Captions one uploaded image with Florence-2 (kijai's ComfyUI-Florence2 nodes).
 * PreviewAny makes the caption a text output that /history returns.
 */
export function captionWorkflow(image, task = 'more_detailed_caption') {
  return {
    cap_load: { class_type: 'LoadImage', inputs: { image }, _meta: { title: 'Caption image' } },
    cap_model: { class_type: 'Florence2ModelLoader', inputs: { model: CAPTION_MODEL, precision: 'fp16' } },
    cap_run: {
      class_type: 'Florence2Run',
      inputs: {
        image: ['cap_load', 0],
        florence2_model: ['cap_model', 0],
        text_input: '',
        task,
        fill_mask: false,
        keep_model_loaded: false,
        max_new_tokens: 1024,
        num_beams: 3,
        do_sample: false,
        seed: 1,
      },
    },
    cap_out: { class_type: 'PreviewAny', inputs: { source: ['cap_run', 2] } },
  }
}
