import assert from 'node:assert/strict'
import test from 'node:test'

import { strFromU8, unzipSync } from 'fflate'
import { SALES_EXPORT_HEADERS, createSalesListWorkbook, salesRowsForExport } from '../lib/sales-export.mjs'

test('sales export flattens visible sales into the requested seven columns', () => {
  const rows = salesRowsForExport([
    {
      clientName: '글로벌 아그로',
      items: [
        { productCode: '001122-0001', name: '미누스 보냉가방', spec: '블랙', cost: '1,250', qty: '12', price: '2,500' },
        { productCode: '', name: '', spec: '', cost: '', qty: '', price: '' },
      ],
    },
    {
      clientName: '테스트 거래처',
      items: [{ productCode: '0002', name: '샘플', spec: 'EA', cost: 500, qty: 1, price: 900 }],
    },
  ])

  assert.deepEqual(SALES_EXPORT_HEADERS, ['상품코드', '제품명', '옵션', '원가', '수량', '개당 판매가', '입금자'])
  assert.deepEqual(rows, [
    { 상품코드: '001122-0001', 제품명: '미누스 보냉가방', 옵션: '블랙', 원가: 1250, 수량: 12, '개당 판매가': 2500, 입금자: '글로벌 아그로' },
    { 상품코드: '0002', 제품명: '샘플', 옵션: '', 원가: 500, 수량: 1, '개당 판매가': 900, 입금자: '테스트 거래처' },
  ])
})

test('sales export workbook contains a styled XLSX sheet with numeric amount cells', () => {
  const workbook = createSalesListWorkbook([
    { 상품코드: '001', 제품명: 'A&B <샘플>', 옵션: '빨강', 원가: 1250, 수량: 12, '개당 판매가': 2500, 입금자: '거래처' },
  ])
  const files = unzipSync(workbook)

  assert.ok(files['[Content_Types].xml'])
  assert.ok(files['xl/workbook.xml'])
  assert.ok(files['xl/styles.xml'])
  const sheet = strFromU8(files['xl/worksheets/sheet1.xml'])
  assert.match(sheet, /sheet name="영업목록"|<worksheet/)
  assert.match(sheet, /A&amp;B &lt;샘플&gt;/)
  assert.match(sheet, /r="D2" s="2"><v>1250<\/v>/)
  assert.match(sheet, /r="F2" s="2"><v>2500<\/v>/)
})
