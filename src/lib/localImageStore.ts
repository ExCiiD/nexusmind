/**
 * Device-local image storage (IndexedDB) for the custom app background.
 * Deliberately outside every sync / backup path: the picture never leaves
 * this computer (or this browser, on the web app). Images are downscaled
 * before saving so a 20 MB photo doesn't sit in the profile forever.
 */
const DB = 'ascend-local-images'
const STORE = 'images'
const MAX_SIDE = 2560

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open()
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = run(db.transaction(STORE, mode).objectStore(STORE))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  } finally {
    db.close()
  }
}

export const getLocalImage = (key: string) => tx<Blob | undefined>('readonly', (s) => s.get(key)).then((b) => b ?? null)
export const deleteLocalImage = (key: string) => tx('readwrite', (s) => s.delete(key)).then(() => undefined)

/** Downscales (longest side ≤ 2560 px) and re-encodes to WebP, then stores. */
export async function saveLocalImage(key: string, file: File): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error('not_an_image')
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode_failed'))), 'image/webp', 0.85),
  )
  await tx('readwrite', (s) => s.put(blob, key))
  return blob
}
