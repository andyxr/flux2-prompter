// Generated images, kept in IndexedDB (Blobs are structured-cloned, never base64).
// Record: { id, png: Blob, prompt, format, seed, model, turbo, width, height, aspect, refCount, createdAt }

const DB = 'flux2-prompter'
const STORE = 'images'

let dbp
function db() {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' })
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbp
}

async function tx(mode, fn) {
  const d = await db()
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode)
    const result = fn(t.objectStore(STORE))
    t.oncomplete = () => resolve(result.result ?? result)
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error)
  })
}

export async function list() {
  const all = await tx('readonly', (s) => s.getAll())
  return all.sort((a, b) => b.createdAt - a.createdAt)
}

export async function add(record) {
  await tx('readwrite', (s) => s.put(record))
  return record
}

export async function remove(id) {
  await tx('readwrite', (s) => s.delete(id))
}

/** Asks the browser not to evict the gallery under storage pressure. */
export function persist() {
  navigator.storage?.persist?.().catch(() => {})
}
