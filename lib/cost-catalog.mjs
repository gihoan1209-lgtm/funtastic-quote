const asText = (value) => (value == null ? '' : String(value).trim())

const headerText = (value) => asText(value)
  .toLocaleLowerCase('ko-KR')
  .replace(/[\s()\[\]{}_.\-/]+/g, '')

/**
 * A blank or invalid cost stays null. Zero is a valid, intentional cost.
 */
export function asCost(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null

  const text = asText(value)
    .replace(/[,₩원\s]/g, '')
  if (!text || !/^\d+(?:\.\d+)?$/.test(text)) return null

  const number = Number(text)
  return Number.isFinite(number) && number >= 0 ? number : null
}

const valueForInput = (value) => {
  // Preserve a partially typed decimal in the editable source table. It is
  // intentionally unresolved until the user finishes the number.
  if (typeof value === 'string' && /^\d+(?:\.\d*)?$/.test(value.trim())) return value.trim()
  const cost = asCost(value)
  return cost === null ? '' : String(cost)
}

/**
 * O열 works 신규 원가 is authoritative. N열 works 기존 원가는 O열이 비어 있을
 * 때만 fallback으로 사용한다.
 */
export function resolveCatalogCost(newCost, existingCost) {
  const resolvedNewCost = asCost(newCost)
  if (resolvedNewCost !== null) return { cost: resolvedNewCost, costSource: 'works 신규 원가' }

  const resolvedExistingCost = asCost(existingCost)
  if (resolvedExistingCost !== null) return { cost: resolvedExistingCost, costSource: 'works 기존 원가' }

  return { cost: null, costSource: '' }
}

export function normalizeCatalogItem(item = {}, fallbackId = '') {
  const productCode = asText(item.productCode ?? item.code)
  const name = asText(item.name)
  const spec = asText(item.spec)
  const category = asText(item.category)
  const newCost = valueForInput(item.newCost)
  const existingCost = valueForInput(item.existingCost)
  const { cost, costSource } = resolveCatalogCost(newCost, existingCost)

  return {
    id: asText(item.id) || fallbackId || `${productCode || '품목'}-${Date.now()}`,
    productCode,
    name,
    spec,
    category,
    newCost,
    existingCost,
    cost,
    costSource,
    sourceRow: Number.isInteger(item.sourceRow) ? item.sourceRow : null,
  }
}

const isCodeHeader = (value) => headerText(value).includes('품목코드')
const isNameHeader = (value) => headerText(value).includes('품목명')
const isSpecHeader = (value) => {
  const normalized = headerText(value)
  return normalized === '규격정보' || normalized === '규격'
}
const isCategoryHeader = (value) => headerText(value).includes('품목구분')

const findWorkCostColumn = (headers, kind) => {
  const wanted = kind === 'new' ? '신규원가' : '기존원가'
  const exactIndex = headers.findIndex((header) => {
    const normalized = headerText(header)
    return normalized.includes('works') && normalized.includes(wanted)
  })
  if (exactIndex >= 0) return exactIndex

  // Some exports drop the word "works". When duplicated columns exist, the
  // right-most one is the operational cost column in the supplied template.
  return headers.reduce((lastIndex, header, index) => (
    headerText(header).includes(wanted) ? index : lastIndex
  ), -1)
}

export function findCostCatalogHeader(rows = []) {
  if (!Array.isArray(rows)) return null

  for (let index = 0; index < rows.length; index += 1) {
    const headers = Array.isArray(rows[index]) ? rows[index] : []
    const productCode = headers.findIndex(isCodeHeader)
    const name = headers.findIndex(isNameHeader)
    const newCost = findWorkCostColumn(headers, 'new')
    const existingCost = findWorkCostColumn(headers, 'existing')
    if (productCode >= 0 && name >= 0 && (newCost >= 0 || existingCost >= 0)) {
      return {
        rowIndex: index,
        columns: {
          productCode,
          name,
          spec: headers.findIndex(isSpecHeader),
          newCost,
          existingCost,
          category: headers.findIndex(isCategoryHeader),
        },
      }
    }
  }

  return null
}

/**
 * Convert a worksheet value matrix into the compact, browser-storable cost
 * catalog. Only the fields used in sales lookup are retained, never the whole
 * supplier workbook.
 */
export function catalogItemsFromWorksheetRows(rows = []) {
  const header = findCostCatalogHeader(rows)
  if (!header) {
    throw new Error('품목코드·품목명·works 신규 원가 또는 works 기존 원가 열을 찾지 못했습니다.')
  }

  const { rowIndex, columns } = header
  const get = (row, column) => (column >= 0 ? row[column] : '')
  const items = []

  rows.slice(rowIndex + 1).forEach((rawRow, offset) => {
    const row = Array.isArray(rawRow) ? rawRow : []
    const productCode = asText(get(row, columns.productCode))
    const name = asText(get(row, columns.name))
    if (!productCode && !name) return

    const sourceRow = rowIndex + offset + 2
    items.push(normalizeCatalogItem({
      id: `import-${sourceRow}-${productCode || 'no-code'}`,
      productCode,
      name,
      spec: get(row, columns.spec),
      newCost: get(row, columns.newCost),
      existingCost: get(row, columns.existingCost),
      category: get(row, columns.category),
      sourceRow,
    }))
  })

  return { items, headerRow: rowIndex + 1, columns }
}

const searchableText = (item) => [item.productCode, item.name, item.spec, item.category]
  .join(' ')
  .toLocaleLowerCase('ko-KR')

/** Search by product code, name, spec, or category. */
export function searchCostCatalog(items = [], query = '', limit = 10) {
  const normalizedQuery = asText(query).toLocaleLowerCase('ko-KR')
  if (!normalizedQuery) return []

  const matches = (Array.isArray(items) ? items : [])
    .filter((item) => searchableText(item).includes(normalizedQuery))
    .sort((left, right) => {
      const leftCode = asText(left.productCode).toLocaleLowerCase('ko-KR')
      const rightCode = asText(right.productCode).toLocaleLowerCase('ko-KR')
      const leftName = asText(left.name).toLocaleLowerCase('ko-KR')
      const rightName = asText(right.name).toLocaleLowerCase('ko-KR')
      const leftScore = Number(leftCode === normalizedQuery) * 3 + Number(leftName === normalizedQuery) * 2 + Number(leftName.startsWith(normalizedQuery))
      const rightScore = Number(rightCode === normalizedQuery) * 3 + Number(rightName === normalizedQuery) * 2 + Number(rightName.startsWith(normalizedQuery))
      return rightScore - leftScore || leftName.localeCompare(rightName, 'ko-KR')
    })

  return Number.isFinite(limit) && limit >= 0 ? matches.slice(0, limit) : matches
}

/**
 * Selection copies a snapshot into the sales record. Later changes to the
 * source catalog must never rewrite a confirmed sale's historical margin.
 */
export function applyCatalogItemToSaleItem(item = {}, catalogItem = {}) {
  const catalog = normalizeCatalogItem(catalogItem)
  return {
    ...item,
    productCode: catalog.productCode,
    name: catalog.name || item.name || '',
    spec: catalog.spec,
    cost: catalog.cost === null ? '' : String(catalog.cost),
    catalogItemId: catalog.id,
    catalogCostSource: catalog.costSource,
  }
}
