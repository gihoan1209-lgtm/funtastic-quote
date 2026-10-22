import assert from 'node:assert/strict'
import test from 'node:test'

import { calculateSaleTotals } from '../lib/sales-calculations.mjs'
import { calculateQuoteItem, calculateQuoteTotals, quoteItemsFromSale } from '../lib/quote-calculations.mjs'

const close = (actual, expected) => {
  assert.notEqual(actual, null)
  assert.ok(Math.abs(actual - expected) < 1e-9, `Expected ${actual} to be close to ${expected}`)
}

test('VAT-inclusive quote extracts included VAT without changing the total', () => {
  const item = calculateQuoteItem({ price: '1100', qty: '2', vatIncluded: true })
  close(item.supply, 2000)
  close(item.vat, 200)
  close(item.total, 2200)

  const fractional = calculateQuoteItem({ price: 100, qty: 1, vatIncluded: true })
  assert.deepEqual(fractional, { supply: 91, vat: 9, total: 100 })
})

test('VAT-exclusive and legacy items add ten percent VAT', () => {
  for (const vatIncluded of [false, undefined]) {
    const item = calculateQuoteItem({ price: '1000', qty: '2', vatIncluded })
    close(item.supply, 2000)
    close(item.vat, 200)
    close(item.total, 2200)
  }
})

test('quote and sales totals agree for mixed VAT and included shipping', () => {
  const sale = {
    items: [
      { id: 17, name: '상품 A', spec: 'EA', qty: '3', price: '101', vatIncluded: true, cost: '30', wholesalePrice: '200' },
      { id: 24, name: '상품 B', qty: '2', price: '250', vatIncluded: false, cost: '100', wholesalePrice: '500' },
    ],
    includeShipping: true,
    shippingFee: '111',
    shippingVatIncluded: true,
    shippingCost: '50',
  }
  const salesTotals = calculateSaleTotals(sale)
  const quoteTotals = calculateQuoteTotals(quoteItemsFromSale(sale))
  close(quoteTotals.total, salesTotals.totalGross)
  close(quoteTotals.vat, salesTotals.totalVat)
  close(quoteTotals.supply + quoteTotals.vat, quoteTotals.total)
})

test('shipping is a separate quote item only when checked and greater than zero', () => {
  const item = { name: '상품', qty: 1, price: 1000, vatIncluded: false, cost: 100 }
  for (const vatIncluded of [true, false]) {
    const sale = {
      items: [item],
      includeShipping: true,
      shippingFee: '1100',
      shippingVatIncluded: vatIncluded,
      shippingCost: 0,
    }
    const quoteItems = quoteItemsFromSale(sale)
    assert.equal(quoteItems.length, 2)
    assert.equal(quoteItems[1].name, '배송비')
    assert.equal(quoteItems[1].vatIncluded, vatIncluded)
    const quoteTotals = calculateQuoteTotals(quoteItems)
    const salesTotals = calculateSaleTotals(sale)
    close(quoteTotals.total, salesTotals.totalGross)
    close(quoteTotals.vat, salesTotals.totalVat)
  }

  for (const sale of [
    { includeShipping: false, shippingFee: '1100' },
    { includeShipping: true, shippingFee: '0' },
    { includeShipping: true, shippingFee: '' },
    { includeShipping: true, shippingFee: '-1' },
  ]) {
    assert.equal(quoteItemsFromSale({ ...sale, items: [item] }).length, 1)
  }
})

test('quote transfer leaves the option blank instead of carrying a legacy EA unit', () => {
  const quoteItems = quoteItemsFromSale({
    items: [
      { name: '옵션 미입력', spec: 'ea', qty: 1, price: 1000 },
      { name: '옵션 있음', spec: '대형', qty: 1, price: 2000 },
    ],
  })
  assert.equal(quoteItems[0].spec, '')
  assert.equal(quoteItems[1].spec, '대형')
})

test('blank or invalid quote inputs calculate as zero, matching legacy editor behavior', () => {
  for (const missing of ['', '  ', null, undefined, 'abc', Number.NaN]) {
    assert.deepEqual(calculateQuoteItem({ price: missing, qty: 2 }), { supply: 0, vat: 0, total: 0 })
    assert.deepEqual(calculateQuoteItem({ price: 10, qty: missing }), { supply: 0, vat: 0, total: 0 })
  }
  assert.deepEqual(calculateQuoteItem({ price: '0', qty: '3' }), { supply: 0, vat: 0, total: 0 })
  assert.deepEqual(calculateQuoteItem({ price: '3', qty: '0', vatIncluded: true }), { supply: 0, vat: 0, total: 0 })
  assert.deepEqual(calculateQuoteTotals([]), { supply: 0, vat: 0, total: 0 })
  assert.deepEqual(calculateQuoteTotals([{ price: 1, qty: 1 }, { price: '', qty: 1 }]), { supply: 1, vat: 0, total: 1 })
  assert.deepEqual(calculateQuoteItem({ price: -1, qty: 2 }), { supply: 0, vat: 0, total: 0 })
  assert.deepEqual(calculateQuoteItem({ price: 1, qty: '-2' }), { supply: 0, vat: 0, total: 0 })
})

test('totals add each rounded line instead of rounding the combined amount', () => {
  const twoFives = [
    { price: 5, qty: 1, vatIncluded: true },
    { price: 5, qty: 1, vatIncluded: true },
  ]
  assert.deepEqual(twoFives.map(calculateQuoteItem), [
    { supply: 5, vat: 0, total: 5 },
    { supply: 5, vat: 0, total: 5 },
  ])
  assert.deepEqual(calculateQuoteTotals(twoFives), { supply: 10, vat: 0, total: 10 })

  const mixed = [
    { price: 2, qty: 1, vatIncluded: true },
    { price: 4, qty: 1, vatIncluded: false },
  ]
  assert.deepEqual(mixed.map(calculateQuoteItem), [
    { supply: 2, vat: 0, total: 2 },
    { supply: 4, vat: 0, total: 4 },
  ])
  assert.deepEqual(calculateQuoteTotals(mixed), { supply: 6, vat: 0, total: 6 })
})

test('each line rounds its price times quantity before computing VAT', () => {
  assert.deepEqual(calculateQuoteItem({ price: 2.5, qty: 3, vatIncluded: true }), { supply: 7, vat: 1, total: 8 })
  assert.deepEqual(calculateQuoteItem({ price: 2.5, qty: 3, vatIncluded: false }), { supply: 8, vat: 1, total: 9 })
})

test('copying to a quote cannot leak cost, wholesale price, profit, or other internal fields', () => {
  const quoteItems = quoteItemsFromSale({
    items: [
      { id: 8, name: '공개 상품', spec: 'BOX', qty: 2, price: 1000, vatIncluded: true, note: '옵션', productCode: '100450-0001', catalogItemId: 'catalog-42', catalogCostSource: 'works 신규 원가', cost: 500, wholesalePrice: 1200, profit: 400, internalMemo: '비공개' },
      { id: 9, name: '  ', price: 2000, cost: 1000 },
    ],
    includeShipping: true,
    shippingFee: 100,
    shippingCost: 999,
    shipments: [{ id: 1, status: 'completed', date: '2026-10-22' }],
    payments: [{ id: 1, status: 'completed', date: '2026-10-22', amount: 1000 }],
    privateToken: '비공개',
  })
  assert.deepEqual(quoteItems, [
    { id: 1, name: '공개 상품', spec: 'BOX', qty: 2, price: 1000, vatIncluded: true, note: '옵션' },
    { id: 2, name: '배송비', spec: '건', qty: 1, price: 100, vatIncluded: false, note: '' },
  ])
  for (const item of quoteItems) {
    assert.deepEqual(Object.keys(item), ['id', 'name', 'spec', 'qty', 'price', 'vatIncluded', 'note'])
  }
  assert.doesNotThrow(() => quoteItemsFromSale({}))
})
