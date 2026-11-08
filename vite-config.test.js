import { describe, expect, it } from 'vitest'
import { comfyProxy, HOST } from './vite.config.js'

describe('comfy proxy', () => {
  it('rewrites /comfy, proxies the socket and presents the ComfyUI origin', () => {
    const p = comfyProxy('http://192.168.1.5:8188')['/comfy']
    expect(p.target).toBe('http://192.168.1.5:8188')
    expect(p.ws).toBe(true)
    expect(p.rewrite('/comfy/prompt')).toBe('/prompt')
    expect(p.headers.origin).toBe('http://192.168.1.5:8188')
  })
  it('binds loopback only', () => expect(HOST).toBe('127.0.0.1'))
})
