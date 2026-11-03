const DATABASE_NAME = 'funtastic-sales-attachments'
const STORE_NAME = 'attachments'

const openDatabase = () => {
  if (!globalThis.indexedDB) return Promise.reject(new Error('이 브라우저에서는 첨부파일 저장을 지원하지 않습니다.'))

  return new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open(DATABASE_NAME, 1)
    request.onupgradeneeded = () => {
      const database = request.result
      const store = database.createObjectStore(STORE_NAME, { keyPath: 'id' })
      store.createIndex('saleId', 'saleId', { unique: false })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('첨부파일 저장소를 열지 못했습니다.'))
  })
}

const runWrite = async (operation) => {
  const database = await openDatabase()
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite')
      transaction.oncomplete = resolve
      transaction.onerror = () => reject(transaction.error || new Error('첨부파일을 저장하지 못했습니다.'))
      transaction.onabort = () => reject(transaction.error || new Error('첨부파일 저장이 취소되었습니다.'))
      operation(transaction.objectStore(STORE_NAME))
    })
  } finally {
    database.close()
  }
}

export async function saveSaleAttachment(saleId, metadata, blob) {
  await runWrite((store) => {
    store.put({ ...metadata, saleId: String(saleId), blob })
  })
}

export async function getSaleAttachment(attachmentId) {
  const database = await openDatabase()
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly')
      const request = transaction.objectStore(STORE_NAME).get(String(attachmentId))
      request.onsuccess = () => resolve(request.result || null)
      request.onerror = () => reject(request.error || new Error('첨부파일을 불러오지 못했습니다.'))
      transaction.onerror = () => reject(transaction.error || new Error('첨부파일을 불러오지 못했습니다.'))
    })
  } finally {
    database.close()
  }
}

export async function deleteSaleAttachment(attachmentId) {
  await runWrite((store) => {
    store.delete(String(attachmentId))
  })
}

export async function deleteSaleAttachmentsForSales(saleIds = []) {
  const ids = [...new Set((Array.isArray(saleIds) ? saleIds : []).map((saleId) => String(saleId)).filter(Boolean))]
  if (!ids.length) return

  await runWrite((store) => {
    const index = store.index('saleId')
    ids.forEach((saleId) => {
      const request = index.openCursor(saleId)
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) return
        cursor.delete()
        cursor.continue()
      }
    })
  })
}
