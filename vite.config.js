import { resolve } from 'node:path'
import { defineConfig, loadEnv } from 'vite'

// Loopback only: the proxy forwards to ComfyUI, so binding wider would let
// anyone on the network queue jobs on this GPU.
export const HOST = '127.0.0.1'
export const PORT = 5174
export const DEFAULT_COMFY_URL = 'http://127.0.0.1:8188'

// ComfyUI rejects a POST or WebSocket whose Origin doesn't match its own host
// (HTTP 403). The browser sends this app's origin, so the proxy presents the
// request as coming from ComfyUI's own origin. Same as boarder's comfyProxy.
export function comfyProxy(comfyUrl) {
  const origin = new URL(comfyUrl).origin
  return {
    '/comfy': {
      target: comfyUrl,
      changeOrigin: true,
      ws: true,
      rewrite: (p) => p.replace(/^\/comfy/, ''),
      headers: { origin },
      configure: (proxy) => {
        proxy.on('proxyReqWs', (req) => req.setHeader('origin', origin))
      },
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const comfyUrl = env.COMFY_URL || DEFAULT_COMFY_URL
  const proxy = comfyProxy(comfyUrl)
  return {
    build: { rollupOptions: { input: resolve(import.meta.dirname, 'flux2-prompt-builder.html') } },
    server: { host: HOST, port: PORT, strictPort: true, proxy, open: '/flux2-prompt-builder.html' },
    preview: { host: HOST, port: 4174, strictPort: true, proxy, open: '/flux2-prompt-builder.html' },
  }
})
