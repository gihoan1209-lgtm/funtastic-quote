import assert from 'node:assert/strict'
import test from 'node:test'

import {
  excelDateToIso,
  paymentRowsFromHistory,
  saleImportSignature,
  salesFromHistoryWorksheetRows,
  shipmentRowsFromHistory,
} from '../lib/sales-history-import.mjs'

const headers = [
  '날짜', '배송', '입금', '업체명', '품번코드', '상품명', '옵션명', '원가', '도매가', '공급가', '할인율',
  '매출부가세', '개당 순이익', '순이익율', '구매수량', '총구매액', '총원가', '총매출부가세', '(-)배송비', '(+)배송비', '총 순이익', '총순이익율', '비고',
]

const sourceRow = (overrides = {}) => {
  const row = Array(headers.length).fill('')
  Object.entries({
    0: 46024, 1: '완료', 2: '0102 완료', 3: '퍼맥스', 4: '111180-0001', 5: '바뜨 옷장 레일행거', 6: '30B 화이트',
    7: 6362, 8: 12480, 9: 11000, 14: 300,
    ...overrides,
  }).forEach(([index, value]) => { row[Number(index)] = value })
  return row
}

test('Excel serial dates and common text dates become quote dates', () => {
  assert.equal(excelDateToIso(46024), '2026-01-02')
  assert.equal(excelDateToIso('2026-10-22 00:00:00'), '2026-10-22')
  assert.equal(excelDateToIso('not a date'), '')
})

test('tracking rows retain completed, partial, and in-progress source states', () => {
  assert.deepEqual(shipmentRowsFromHistory(['0914 완료'], 2026), [{ id: 1, status: 'completed', date: '2026-09-14', memo: '' }])
  assert.deepEqual(shipmentRowsFromHistory(['진행중/5개선출고'], 2026), [{ id: 1, status: 'before', date: '', memo: '진행중/5개선출고' }])
  assert.deepEqual(paymentRowsFromHistory(['0105(50%)\n0129(50%) 완료'], 2026), [
    { id: 1, status: 'completed', date: '2026-01-05', amount: '' },
    { id: 2, status: 'completed', date: '2026-01-29', amount: '' },
  ])
  assert.deepEqual(paymentRowsFromHistory(['0709 2,375,000 선금\n0811 완료'], 2026), [
    { id: 1, status: 'completed', date: '2026-07-09', amount: '2375000' },
    { id: 2, status: 'completed', date: '2026-08-11', amount: '' },
  ])
})

test('history import groups one client and quote date into one multi-item sale', () => {
  const parsed = salesFromHistoryWorksheetRows([
    headers,
    sourceRow(),
    sourceRow({ 2: '0102 완료', 6: '30B 블랙', 14: 500 }),
    sourceRow({ 0: 46027, 1: '진행중', 2: '진행중', 3: '다른 거래처', 4: 'A-1', 5: '진행 품목', 7: 100, 9: 200, 14: 10, 18: 12000, 19: 12000 }),
  ])

  assert.equal(parsed.headerRow, 1)
  assert.equal(parsed.itemRowCount, 3)
  assert.equal(parsed.sales.length, 2)
  assert.deepEqual(parsed.sales[0].items.map((item) => item.spec), ['30B 화이트', '30B 블랙'])
  assert.equal(parsed.sales[0].status, 'completed')
  assert.equal(parsed.sales[1].quoteDate, '2026-01-05')
  assert.equal(parsed.sales[1].status, 'inProgress')
  assert.equal(parsed.sales[1].includeShipping, true)
  assert.equal(parsed.sales[1].shippingCost, '12000')
})

test('sale import signatures identify the same complete sales record', () => {
  const sale = salesFromHistoryWorksheetRows([headers, sourceRow()]).sales[0]
  assert.equal(saleImportSignature(sale), saleImportSignature({ ...sale, id: 'different-id', updatedAt: 'later' }))
})
