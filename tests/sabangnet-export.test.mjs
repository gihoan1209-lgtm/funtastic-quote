import assert from 'node:assert/strict'
import test from 'node:test'

import { strFromU8, unzipSync } from 'fflate'
import {
  SABANGNET_HEADERS,
  createSabangnetWorkbook,
  sabangnetOrderNumberForSale,
  sabangnetRowsFromSale,
  sabangnetValidationIssues,
} from '../lib/sabangnet-export.mjs'

const sale = {
  id: 'sale-abcdefgh',
  quoteDate: '2026-11-03',
  clientName: '한국특수단열',
  address: '경기도 광주시 직동로8',
  contactPhone: '010-0123-4567',
  items: [
    { productCode: '112260-0001', name: '미누스 보냉가방', spec: '베이지', qty: '12' },
    { productCode: '', name: '보조 상품', spec: 'EA', qty: '3' },
  ],
}

test('SabangNet rows use the supplied nine-column registration order', () => {
  const rows = sabangnetRowsFromSale(sale)

  assert.deepEqual(SABANGNET_HEADERS, ['주문번호', '수취인명', '주소', '전화번호', '배송메세지', '상품명', '옵션', '수량', '상품코드(상품명)'])
  assert.equal(sabangnetOrderNumberForSale(sale), '20261103-cdefgh')
  assert.deepEqual(rows, [
    {
      주문번호: '20261103-cdefgh', 수취인명: '한국특수단열', 주소: '경기도 광주시 직동로8', 전화번호: '010-0123-4567', 배송메세지: '',
      상품명: '미누스 보냉가방', 옵션: '베이지', 수량: 12, '상품코드(상품명)': '112260-0001',
    },
    {
      주문번호: '20261103-cdefgh', 수취인명: '한국특수단열', 주소: '경기도 광주시 직동로8', 전화번호: '010-0123-4567', 배송메세지: '',
      상품명: '보조 상품', 옵션: '', 수량: 3, '상품코드(상품명)': '보조 상품',
    },
  ])
})

test('SabangNet validation identifies missing shipping data before generation', () => {
  assert.deepEqual(sabangnetValidationIssues({ ...sale, address: '', contactPhone: '' }), ['주소', '전화번호'])
  assert.deepEqual(sabangnetValidationIssues({ ...sale, items: [{ name: '', qty: '' }] }), ['품목'])
})

test('SabangNet falls back to client details when optional recipient values contain only whitespace', () => {
  const rows = sabangnetRowsFromSale({ ...sale, recipientName: '   ', recipientPhone: '   ' })

  assert.equal(rows[0].수취인명, '한국특수단열')
  assert.equal(rows[0].전화번호, '010-0123-4567')
  assert.deepEqual(sabangnetValidationIssues({ ...sale, recipientName: '   ', recipientPhone: '   ' }), [])
})

test('SabangNet workbook keeps phone text and quantity numeric in the template-shaped Sheet1', () => {
  const workbook = createSabangnetWorkbook(sabangnetRowsFromSale(sale))
  const files = unzipSync(workbook)
  const sheet = strFromU8(files['xl/worksheets/sheet1.xml'])

  assert.match(strFromU8(files['xl/workbook.xml']), /sheet name="Sheet1"/)
  assert.match(sheet, /r="D2"[^>]*><is><t xml:space="preserve">010-0123-4567<\/t><\/is><\/c>/)
  assert.match(sheet, /r="H2" s="2"><v>12<\/v>/)
  assert.doesNotMatch(sheet, /autoFilter/)
})
