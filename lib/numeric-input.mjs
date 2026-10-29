export const ungroupNumber = (value) => String(value ?? '').replaceAll(',', '')

export const formatGroupedNumber = (value) => {
  const raw = ungroupNumber(value)
  if (!raw || !/^\d+(?:\.\d*)?$/.test(raw)) return raw
  const [integer, decimal] = raw.split('.')
  const formattedInteger = Number(integer).toLocaleString('ko-KR')
  return decimal === undefined ? formattedInteger : `${formattedInteger}.${decimal}`
}

export const isNonNegativeInput = (value) => {
  const raw = ungroupNumber(value)
  return raw === '' || (/^\d+(?:\.\d*)?$/.test(raw) && Number.isFinite(Number(raw)) && Number(raw) >= 0)
}

/**
 * Convert a single Excel cell to the numeric format used by the inputs.
 * Tabs and line breaks are deliberately handled by parseNumericClipboardRow
 * so a multi-cell selection cannot accidentally be joined into one amount.
 */
export const normalizePastedNumber = (value) => {
  const text = String(value ?? '').replace(/\u00a0/g, ' ').trim()
  if (/[\t\r\n]/.test(text)) return null

  const normalized = text
    .replace(/[₩￦]/g, '')
    .replaceAll('원', '')
    .replace(/[\s,，\u200b]/g, '')

  return isNonNegativeInput(normalized) ? normalized : null
}

/**
 * Read one horizontal Excel row. A returned array can safely be mapped to
 * adjacent numeric inputs; a multi-row grid is rejected rather than risking
 * amounts being written to unintended records.
 */
export const parseNumericClipboardRow = (value) => {
  const text = String(value ?? '').replace(/\r\n?/g, '\n').replace(/^\n+|\n+$/g, '')
  if (text.includes('\n')) return null

  const values = text.split('\t').map(normalizePastedNumber)
  return values.every((item) => item !== null) ? values : null
}
