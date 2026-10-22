import { unzipSync } from 'fflate'

const RELATIONSHIP_NAMESPACE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const MAX_FILE_BYTES = 15 * 1024 * 1024

const decode = (bytes) => new TextDecoder('utf-8').decode(bytes)

const parseXml = (bytes, filename) => {
  if (!bytes) throw new Error(`${filename} 파일을 찾지 못했습니다.`)
  const document = new DOMParser().parseFromString(decode(bytes), 'application/xml')
  if (document.querySelector('parsererror')) throw new Error(`${filename} 파일을 읽을 수 없습니다.`)
  return document
}

const elementsNamed = (root, name) => Array.from(root.getElementsByTagName('*'))
  .filter((element) => element.localName === name)

const firstNamed = (root, name) => elementsNamed(root, name)[0] || null

const worksheetPath = (target) => {
  const cleanTarget = String(target || '').replace(/\\/g, '/').replace(/^\/+/, '')
  if (!cleanTarget) return ''
  return cleanTarget.startsWith('xl/') ? cleanTarget : `xl/${cleanTarget}`
}

const columnIndex = (cellReference) => {
  const letters = String(cellReference || '').match(/[A-Z]+/i)?.[0]?.toUpperCase() || ''
  return [...letters].reduce((result, letter) => result * 26 + letter.charCodeAt(0) - 64, 0) - 1
}

const textFromRichString = (node) => elementsNamed(node, 't').map((part) => part.textContent || '').join('')

const sharedStringsFrom = (files) => {
  if (!files['xl/sharedStrings.xml']) return []
  const document = parseXml(files['xl/sharedStrings.xml'], '공유 문자열')
  return elementsNamed(document, 'si').map(textFromRichString)
}

const rowsFromWorksheet = (bytes, sharedStrings) => {
  const document = parseXml(bytes, '워크시트')
  const rows = []

  for (const rowNode of elementsNamed(document, 'row')) {
    const rowIndex = Math.max(0, Number(rowNode.getAttribute('r')) - 1 || rows.length)
    const row = []
    for (const cell of elementsNamed(rowNode, 'c')) {
      const index = columnIndex(cell.getAttribute('r'))
      if (index < 0) continue
      const type = cell.getAttribute('t') || ''
      const rawValue = firstNamed(cell, 'v')?.textContent || ''
      let value = rawValue
      if (type === 'inlineStr') value = textFromRichString(firstNamed(cell, 'is') || cell)
      else if (type === 's') value = sharedStrings[Number(rawValue)] ?? ''
      else if (type === 'b') value = rawValue === '1' ? 'TRUE' : 'FALSE'
      row[index] = value
    }
    rows[rowIndex] = row
  }

  return rows
}

/**
 * Read the cell values needed by the cost importer in a user's browser. The
 * workbook never leaves that browser; this intentionally supports .xlsx only.
 */
export async function xlsxSheetsFromFile(file) {
  if (!file?.name?.toLocaleLowerCase('ko-KR').endsWith('.xlsx')) {
    throw new Error('원가 파일은 .xlsx 형식으로 선택해 주세요.')
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error('원가 파일은 15MB 이하만 가져올 수 있습니다.')
  }

  const files = unzipSync(new Uint8Array(await file.arrayBuffer()))
  const workbook = parseXml(files['xl/workbook.xml'], '엑셀 통합문서')
  const relations = parseXml(files['xl/_rels/workbook.xml.rels'], '엑셀 관계 정보')
  const relationshipTargets = new Map(elementsNamed(relations, 'Relationship').map((relation) => [
    relation.getAttribute('Id'),
    relation.getAttribute('Target'),
  ]))
  const sharedStrings = sharedStringsFrom(files)
  const sheets = []

  for (const sheet of elementsNamed(workbook, 'sheet')) {
    const relationId = sheet.getAttributeNS(RELATIONSHIP_NAMESPACE, 'id') || sheet.getAttribute('r:id')
    const path = worksheetPath(relationshipTargets.get(relationId))
    if (!path || !files[path]) continue
    sheets.push({
      name: sheet.getAttribute('name') || '이름 없는 시트',
      rows: rowsFromWorksheet(files[path], sharedStrings),
    })
  }

  if (!sheets.length) throw new Error('읽을 수 있는 워크시트를 찾지 못했습니다.')
  return sheets
}
