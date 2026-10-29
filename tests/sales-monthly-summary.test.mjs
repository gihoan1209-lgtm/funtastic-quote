import assert from 'node:assert/strict'
import test from 'node:test'

import {
  calculateMonthlyQuoteSales,
  quoteDateForList,
  quoteMonthForList,
  quoteYearsForSales,
} from '../lib/sales-monthly-summary.mjs'

const sale = (quoteDate, price, qty = 1) => ({
  quoteDate,
  items: [{ price, qty, cost: 0, wholesalePrice: price, vatIncluded: true }],
  shippingCost: 0,
})

test('quote date helpers favor quoteDate and retain legacy sale date fallback', () => {
  assert.equal(quoteDateForList({ quoteDate: '2026-02-11', saleDate: '2026-02-01' }), '2026-02-11')
  assert.equal(quoteDateForList({ saleDate: '2025-12-31' }), '2025-12-31')
  assert.equal(quoteMonthForList({ quoteDate: '2026-02-11' }), '2026-02')
  assert.equal(quoteMonthForList({ quoteDate: 'not-a-date' }), '')
})

test('monthly quote sales are grouped by quote date and sum quote totals', () => {
  const sales = [
    sale('2026-01-03', 1000),
    sale('2026-01-28', 2000),
    sale('2026-02-05', 500, 2),
    sale('2025-01-03', 9000),
    sale('2026-03-03', '', 1),
  ]

  const monthly = calculateMonthlyQuoteSales(sales, '2026')
  assert.equal(monthly.length, 12)
  assert.deepEqual(monthly[0], { month: '01', label: '1월', saleCount: 2, totalGross: 3000 })
  assert.deepEqual(monthly[1], { month: '02', label: '2월', saleCount: 1, totalGross: 1000 })
  assert.deepEqual(monthly[2], { month: '03', label: '3월', saleCount: 1, totalGross: 0 })
  assert.equal(monthly[11].totalGross, 0)
})

test('available quote years include records and the supplied current year', () => {
  const years = quoteYearsForSales([
    sale('2025-12-31', 1),
    sale('2027-01-01', 1),
    sale('bad-date', 1),
  ], '2026')

  assert.deepEqual(years, ['2027', '2026', '2025'])
})
