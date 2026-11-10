import { strToU8, zipSync } from 'fflate'

export const SABANGNET_HEADERS = ['주문번호', '수취인명', '주소', '전화번호', '배송메세지', '상품명', '옵션', '수량', '상품코드(상품명)']

const numericColumns = new Set([7])

const cleanText = (value) => String(value ?? '').trim()
const cleanOption = (value) => cleanText(value).toUpperCase() === 'EA' ? '' : cleanText(value)
const positiveNumber = (value) => {
  const raw = cleanText(value).replaceAll(',', '')
  const number = Number(raw)
  return Number.isFinite(number) && number > 0 ? number : null
}

const itemsForSabangnet = (sale = {}) => (Array.isArray(sale?.items) ? sale.items : [])
  .filter((item) => [item?.productCode, item?.name, item?.spec, item?.qty].some((value) => cleanText(value)))

const sabangnetDateStamp = (generatedAt = new Date()) => {
  const directDate = cleanText(generatedAt).match(/^(\d{4})[-./]?(\d{2})[-./]?(\d{2})/)
  if (directDate) return `${directDate[1]}${directDate[2]}${directDate[3]}`

  const date = generatedAt instanceof Date ? generatedAt : new Date(generatedAt)
  if (Number.isNaN(date.getTime())) return 'ORDER'
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`
}

/** SabangNet uses the date the workbook is generated, not the quote date. */
export const sabangnetOrderNumberForSale = (_sale = {}, generatedAt = new Date()) => `${sabangnetDateStamp(generatedAt)}-bob1`

export function sabangnetValidationIssues(sale = {}) {
  const issues = []
  if (!cleanText(sale?.recipientName) && !cleanText(sale?.clientName)) issues.push('수취인명')
  if (!cleanText(sale?.address)) issues.push('주소')
  if (!cleanText(sale?.recipientPhone) && !cleanText(sale?.contactPhone)) issues.push('전화번호')

  const items = itemsForSabangnet(sale)
  if (!items.length) {
    issues.push('품목')
    return issues
  }
  if (items.some((item) => !cleanText(item?.name))) issues.push('품명')
  if (items.some((item) => positiveNumber(item?.qty) == null)) issues.push('수량')
  return [...new Set(issues)]
}

export function sabangnetRowsFromSale(sale = {}, generatedAt = new Date()) {
  const orderNumber = sabangnetOrderNumberForSale(sale, generatedAt)
  const recipientName = cleanText(sale?.recipientName) || cleanText(sale?.clientName)
  const address = cleanText(sale?.address)
  const phone = cleanText(sale?.recipientPhone) || cleanText(sale?.contactPhone)
  const deliveryMessage = cleanText(sale?.deliveryMessage)

  return itemsForSabangnet(sale).map((item) => {
    const productName = cleanText(item?.name)
    return {
      '주문번호': orderNumber,
      '수취인명': recipientName,
      '주소': address,
      '전화번호': phone,
      '배송메세지': deliveryMessage,
      '상품명': productName,
      '옵션': cleanOption(item?.spec),
      '수량': positiveNumber(item?.qty) ?? '',
      // The SabangNet template labels I as product code/name, but this upload
      // flow requires the F-column product name to be copied into I as well.
      '상품코드(상품명)': productName,
    }
  })
}

const xmlEscape = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&apos;')

const columnName = (index) => {
  let value = index + 1
  let name = ''
  while (value > 0) {
    const remainder = (value - 1) % 26
    name = String.fromCharCode(65 + remainder) + name
    value = Math.floor((value - 1) / 26)
  }
  return name
}

const cellXml = (value, rowIndex, columnIndex, isHeader) => {
  const reference = `${columnName(columnIndex)}${rowIndex + 1}`
  if (!isHeader && numericColumns.has(columnIndex) && typeof value === 'number') {
    return `<c r="${reference}" s="2"><v>${value}</v></c>`
  }
  return `<c r="${reference}"${isHeader ? ' s="1"' : ''} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`
}

const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2"><font><sz val="10"/><name val="Arial"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="10"/><name val="Arial"/></font></fonts>
  <fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF246B45"/><bgColor indexed="64"/></patternFill></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`

/** Create the flat nine-column XLSX format used by SabangNet order registration. */
export function createSabangnetWorkbook(rows = []) {
  const dataRows = Array.isArray(rows) ? rows : []
  const allRows = [SABANGNET_HEADERS, ...dataRows.map((row) => SABANGNET_HEADERS.map((header) => row?.[header] ?? ''))]
  const rowXml = allRows.map((row, rowIndex) => (
    `<row r="${rowIndex + 1}">${row.map((value, columnIndex) => cellXml(value, rowIndex, columnIndex, rowIndex === 0)).join('')}</row>`
  )).join('')
  const worksheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView workbookViewId="0"><selection activeCell="A1" sqref="A1"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  <cols><col min="1" max="1" width="22" customWidth="1"/><col min="2" max="2" width="16" customWidth="1"/><col min="3" max="3" width="42" customWidth="1"/><col min="4" max="4" width="18" customWidth="1"/><col min="5" max="5" width="28" customWidth="1"/><col min="6" max="6" width="30" customWidth="1"/><col min="7" max="7" width="18" customWidth="1"/><col min="8" max="8" width="10" customWidth="1"/><col min="9" max="9" width="28" customWidth="1"/></cols>
  <sheetData>${rowXml}</sheetData>
</worksheet>`

  const files = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': stylesXml,
    'xl/worksheets/sheet1.xml': worksheetXml,
  }
  return zipSync(Object.fromEntries(Object.entries(files).map(([path, xml]) => [path, strToU8(xml)])), { level: 6 })
}
