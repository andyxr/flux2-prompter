import { ComfyClient, gpuLabel } from './client.js'

// Start-up check, slimmed from boarder (src/core/comfy/health.ts): is ComfyUI
// up, and does it have the model files the klein and dev workflows load?

export const REQUIRED_MODELS = {
  klein: [
    { file: 'flux-2-klein-base-9b-fp8.safetensors', folder: 'diffusion_models' },
    { file: 'qwen_3_8b_fp8mixed.safetensors', folder: 'text_encoders' },
    { file: 'full_encoder_small_decoder.safetensors', folder: 'vae' },
  ],
  dev: [
    { file: 'flux2_dev_fp8mixed.safetensors', folder: 'diffusion_models' },
    { file: 'mistral_3_small_flux2_fp8.safetensors', folder: 'text_encoders' },
    { file: 'full_encoder_small_decoder.safetensors', folder: 'vae' },
  ],
  turbo: [{ file: 'Flux_2-Turbo-LoRA_comfyui.safetensors', folder: 'loras' }],
}

// Models in subfolders are listed as "sub\\file" on Windows, "sub/file" elsewhere.
const basename = (p) => p.split(/[\\/]/).pop() ?? p

/**
 * { status: 'offline', error } |
 * { status: 'connected', version?, gpu?, missing: { klein: [], dev: [], turbo: [] } }
 */
export async function checkHealth(client = new ComfyClient(), signal) {
  let stats
  try {
    stats = await client.systemStats(signal)
  } catch (e) {
    return { status: 'offline', error: e instanceof Error ? e.message : String(e) }
  }
  const folders = [...new Set(Object.values(REQUIRED_MODELS).flat().map((m) => m.folder))]
  const lists = {}
  await Promise.all(
    folders.map(async (f) => {
      try {
        lists[f] = new Set((await client.models(f, signal)).map(basename))
      } catch {
        lists[f] = new Set()
      }
    }),
  )
  const missing = {}
  for (const [group, models] of Object.entries(REQUIRED_MODELS))
    missing[group] = models.filter((m) => !lists[m.folder].has(m.file))
  const dev = stats.devices[0]
  return {
    status: 'connected',
    version: stats.system?.comfyui_version,
    gpu: dev ? gpuLabel(dev.name) : undefined,
    missing,
  }
}
