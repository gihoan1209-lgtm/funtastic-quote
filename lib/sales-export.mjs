import { strToU8, zipSync } from 'fflate'

export const SALES_EXPORT_HEADERS = ['상품코드', '제품명', '옵션', '원가', '수량', '개당 판매가', '입금자']

const numericColumns = new Set([3, 4, 5])

const cleanOption = (value) => String(value ?? '').trim().toUpperCase() === 'EA' ? '' : String(value ?? '')

const numericValue = (value) => {
  const raw = String(value ?? '').replaceAll(',', '').trim()
  if (!raw || !Number.isFinite(Number(raw))) return ''
  return Number(raw)
}

const hasValue = (value) => String(value ?? '').trim() !== ''

const hasExportableItem = (item = {}) => [
  item.productCode,
  item.name,
  cleanOption(item.spec),
  item.cost,
  item.qty,
  item.price,
].some(hasValue)

/**
 * One spreadsheet row per meaningful sales item. The payer column is the
 * saved customer name because sales records do not have a separate payer field.
 */
export function salesRowsForExport(sales = []) {
  return (Array.isArray(sales) ? sales : []).flatMap((sale) => (
    (Array.isArray(sale?.items) ? sale.items : [])
      .filter(hasExportableItem)
      .map((item) => ({
        '상품코드': String(item.productCode ?? ''),
        '제품명': String(item.name ?? ''),
        '옵션': cleanOption(item.spec),
        '원가': numericValue(item.cost),
        '수량': numericValue(item.qty),
        '개당 판매가': numericValue(item.price),
        '입금자': String(sale?.clientName ?? ''),
      }))
  ))
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
    const numberStyle = Number.isInteger(value) ? 2 : 3
    return `<c r="${reference}" s="${numberStyle}"><v>${value}</v></c>`
  }
  return `<c r="${reference}"${isHeader ? ' s="1"' : ''} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`
}

const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0"/><numFmt numFmtId="165" formatCode="#,##0.##"/></numFmts>
  <fonts count="2"><font><sz val="10"/><name val="Arial"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="10"/><name val="Arial"/></font></fonts>
  <fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF246B45"/><bgColor indexed="64"/></patternFill></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`

/** Create a compact, standards-compliant XLSX binary without sending sales data anywhere. */
export function createSalesListWorkbook(rows = []) {
  const dataRows = Array.isArray(rows) ? rows : []
  const allRows = [SALES_EXPORT_HEADERS, ...dataRows.map((row) => SALES_EXPORT_HEADERS.map((header) => row?.[header] ?? ''))]
  const rowXml = allRows.map((row, rowIndex) => (
    `<row r="${rowIndex + 1}">${row.map((value, columnIndex) => cellXml(value, rowIndex, columnIndex, rowIndex === 0)).join('')}</row>`
  )).join('')
  const lastRow = Math.max(1, allRows.length)
  const worksheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView workbookViewId="0"><selection activeCell="A1" sqref="A1"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  <cols><col min="1" max="1" width="18" customWidth="1"/><col min="2" max="2" width="30" customWidth="1"/><col min="3" max="3" width="20" customWidth="1"/><col min="4" max="6" width="15" customWidth="1"/><col min="7" max="7" width="20" customWidth="1"/></cols>
  <sheetData>${rowXml}</sheetData>
  <autoFilter ref="A1:G${lastRow}"/>
</worksheet>`

  const files = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="영업목록" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': stylesXml,
    'xl/worksheets/sheet1.xml': worksheetXml,
  }
  return zipSync(Object.fromEntries(Object.entries(files).map(([path, xml]) => [path, strToU8(xml)])), { level: 6 })
}
