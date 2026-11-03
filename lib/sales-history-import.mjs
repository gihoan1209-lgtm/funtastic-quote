const HEADER_ALIASES = {
  quoteDate: ['날짜', '견적일'],
  shipment: ['배송', '출고'],
  payment: ['입금'],
  clientName: ['업체명', '거래처명'],
  productCode: ['품번코드', '상품코드', '품목코드'],
  productName: ['상품명', '제품명', '품명'],
  option: ['옵션명', '옵션', '규격'],
  cost: ['원가'],
  wholesalePrice: ['도매가'],
  price: ['공급가', '견적단가', '개당판매가'],
  qty: ['구매수량', '수량'],
  shippingCost: ['(-)배송비', '실배송비', '부담배송비'],
  shippingFee: ['(+)배송비', '받는배송비'],
  note: ['비고'],
}

const MS_PER_DAY = 24 * 60 * 60 * 1000
const EXCEL_EPOCH = Date.UTC(1899, 11, 30)

const normalizeText = (value) => String(value ?? '').replace(/\s+/g, ' ').trim()
const normalizeMultilineText = (value) => String(value ?? '')
  .replace(/\r\n?/g, '\n')
  .split('\n')
  .map(normalizeText)
  .filter(Boolean)
  .join('\n')
const normalizeHeader = (value) => normalizeText(value).replaceAll(' ', '')
const unique = (values) => [...new Set(values.filter(Boolean))]

const toNumberText = (value) => {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return String(value)
  const cleaned = String(value ?? '')
    .replace(/[₩￦원\s,，]/g, '')
    .trim()
  return /^\d+(?:\.\d+)?$/.test(cleaned) ? cleaned : ''
}

const validDate = (year, month, day) => {
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

const isoFromParts = (year, month, day) => (
  validDate(year, month, day)
    ? `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    : ''
)

export const excelDateToIso = (value) => {
  if (typeof value === 'number' || /^\d+(?:\.\d+)?$/.test(String(value ?? '').trim())) {
    const serial = Number(value)
    if (Number.isFinite(serial) && serial > 0) {
      const date = new Date(EXCEL_EPOCH + Math.floor(serial) * MS_PER_DAY)
      return isoFromParts(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
    }
  }

  const text = normalizeText(value)
  const match = text.match(/(\d{4})[./-](\d{1,2})[./-](\d{1,2})/)
  return match ? isoFromParts(Number(match[1]), Number(match[2]), Number(match[3])) : ''
}

const dateTokensFrom = (value, year) => {
  const text = normalizeText(value)
  const tokens = []
  const pattern = /(^|[^\d])((0[1-9]|1[0-2])([0-3]\d))(?:0)?(?=$|[^\d])/g
  let match = pattern.exec(text)
  while (match) {
    const month = Number(match[3])
    const day = Number(match[4])
    const date = isoFromParts(year, month, day)
    if (date) tokens.push(date)
    match = pattern.exec(text)
  }
  return unique(tokens)
}

const completedFrom = (value) => /완료|입금|선금|결제/.test(normalizeText(value))
const beforeFrom = (value) => /진행|미입금|미출고|대기|전/.test(normalizeText(value))

const trackingStatusFrom = (value) => {
  if (beforeFrom(value)) return 'before'
  return completedFrom(value) ? 'completed' : 'before'
}

const paymentAmountFrom = (value) => {
  const withoutDate = normalizeText(value).replace(/(^|[^\d])((0[1-9]|1[0-2])([0-3]\d))(?:0)?(?=$|[^\d])/g, ' ')
  const candidates = withoutDate.match(/\d[\d,，]*/g) || []
  const amount = candidates.find((candidate) => candidate.includes(',') || candidate.replace(/[，,]/g, '').length >= 5)
  return amount ? toNumberText(amount) : ''
}

const isSimpleCompletedText = (value) => /^(?:\d{4}\s*)?완료$/.test(normalizeText(value))

export const shipmentRowsFromHistory = (values = [], year) => {
  const rows = []
  for (const value of unique(values.map(normalizeText))) {
    const dates = dateTokensFrom(value, year)
    const status = trackingStatusFrom(value)
    const entries = dates.length ? dates : ['']
    for (const date of entries) {
      rows.push({
        id: rows.length + 1,
        status,
        date,
        memo: isSimpleCompletedText(value) ? '' : value,
      })
    }
  }
  return rows.length ? rows : [{ id: 1, status: 'before', date: '', memo: '' }]
}

export const paymentRowsFromHistory = (values = [], year) => {
  const rows = []
  for (const value of unique(values.map(normalizeMultilineText))) {
    const sourceLines = String(value).split(/\r?\n/).map(normalizeText).filter(Boolean)
    const lines = sourceLines.length ? sourceLines : [value]
    const sourceIsCompleted = completedFrom(value)
    for (const line of lines) {
      const dates = dateTokensFrom(line, year)
      const status = beforeFrom(line) ? 'before' : (completedFrom(line) || sourceIsCompleted || dates.length ? 'completed' : 'before')
      const entries = dates.length ? dates : ['']
      const amount = paymentAmountFrom(line)
      for (const date of entries) {
        rows.push({ id: rows.length + 1, status, date, amount })
      }
    }
  }
  return rows.length ? rows : [{ id: 1, status: 'before', date: '', amount: '' }]
}

const headerIndexesFrom = (row = []) => {
  const indexes = {}
  const headers = row.map(normalizeHeader)
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const index = headers.findIndex((header) => aliases.map(normalizeHeader).includes(header))
    if (index >= 0) indexes[field] = index
  }
  return indexes
}

const historyStatus = (shipments, payments) => {
  const trackingRows = [...shipments, ...payments]
  return trackingRows.length && trackingRows.every((row) => row.status === 'completed')
    ? 'completed'
    : trackingRows.some((row) => row.status === 'before') ? 'inProgress' : 'pending'
}

const itemFromHistoryRow = (row, headers) => ({
  productCode: normalizeText(row[headers.productCode]),
  name: normalizeText(row[headers.productName]),
  spec: normalizeText(row[headers.option]),
  qty: toNumberText(row[headers.qty]),
  cost: toNumberText(row[headers.cost]),
  wholesalePrice: toNumberText(row[headers.wholesalePrice]),
  price: toNumberText(row[headers.price]),
  vatIncluded: true,
})

const firstNumericValue = (lines, headerIndex) => {
  if (headerIndex == null) return ''
  for (const line of lines) {
    const value = toNumberText(line[headerIndex])
    if (value) return value
  }
  return ''
}

export const saleImportSignature = (sale = {}) => JSON.stringify([
  excelDateToIso(sale.quoteDate || sale.saleDate),
  normalizeText(sale.clientName),
  ...(sale.items || []).map((item) => [
    normalizeText(item.productCode), normalizeText(item.name), normalizeText(item.spec),
    toNumberText(item.qty), toNumberText(item.price),
  ]),
])

/**
 * Convert the current sales-history sheet layout into editable sales records.
 * The caller owns IDs and local persistence; this parser never uploads a file.
 */
export const salesFromHistoryWorksheetRows = (rows = []) => {
  const headerRow = rows.findIndex((row) => {
    const headers = headerIndexesFrom(row)
    return headers.quoteDate != null && headers.clientName != null && headers.productName != null
      && headers.qty != null && headers.price != null
  })
  if (headerRow < 0) throw new Error('날짜·업체명·상품명·구매수량·공급가 열을 찾지 못했습니다.')

  const headers = headerIndexesFrom(rows[headerRow])
  const groups = new Map()
  for (const row of rows.slice(headerRow + 1)) {
    const quoteDate = excelDateToIso(row?.[headers.quoteDate])
    const clientName = normalizeText(row?.[headers.clientName])
    const item = itemFromHistoryRow(row || [], headers)
    if (!quoteDate || !clientName || !item.name) continue
    const key = `${quoteDate}\u0000${clientName}`
    const current = groups.get(key) || { quoteDate, clientName, lines: [] }
    current.lines.push(row)
    groups.set(key, current)
  }

  const sales = [...groups.values()].map((group) => {
    const year = Number(group.quoteDate.slice(0, 4))
    const shipments = shipmentRowsFromHistory(group.lines.map((line) => line[headers.shipment]), year)
    const payments = paymentRowsFromHistory(group.lines.map((line) => line[headers.payment]), year)
    const shippingFee = firstNumericValue(group.lines, headers.shippingFee)
    const shippingCost = firstNumericValue(group.lines, headers.shippingCost) || '0'
    const notes = unique(group.lines.map((line) => normalizeText(line[headers.note])))
    const detailedPayments = unique(group.lines.map((line) => normalizeText(line[headers.payment])))
      .filter((value) => value && !isSimpleCompletedText(value))
    const internalMemo = [...notes, ...detailedPayments.map((value) => `입금 원본: ${value}`)].join('\n')
    const items = group.lines.map((line, index) => ({ id: index + 1, ...itemFromHistoryRow(line, headers) }))

    return {
      saleDate: group.quoteDate,
      quoteDate: group.quoteDate,
      clientName: group.clientName,
      representativeName: '',
      contactName: '',
      contactPhone: '',
      businessRegistrationNumber: '',
      taxInvoiceEmail: '',
      recipientTitle: '대표이사 귀하',
      status: historyStatus(shipments, payments),
      requestedDueDate: '',
      includeShipping: Number(shippingFee) > 0,
      shippingFee,
      shippingCost,
      shippingVatIncluded: true,
      internalMemo,
      quoteId: '',
      items,
      shipments,
      payments,
    }
  })

  return { sales, headerRow: headerRow + 1, itemRowCount: sales.reduce((count, sale) => count + sale.items.length, 0) }
}
