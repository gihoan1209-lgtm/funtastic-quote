import assert from 'node:assert/strict'
import test from 'node:test'

import { calculateSaleItem, calculateSaleTotals } from '../lib/sales-calculations.mjs'

const close = (actual, expected) => {
  assert.notEqual(actual, null)
  assert.ok(Math.abs(actual - expected) < 1e-9, `Expected ${actual} to be close to ${expected}`)
}

test('VAT-inclusive unit figures follow the spreadsheet without unit rounding', () => {
  const result = calculateSaleItem({ price: '1100', cost: '600', wholesalePrice: '2200', qty: '3', vatIncluded: true })

  close(result.discountRate, 0.5)
  close(result.unitGross, 1100)
  close(result.unitVat, 100)
  close(result.unitProfit, 400)
  close(result.unitProfitRate, 400 / 1100)
  close(result.totalGross, 3300)
  close(result.totalVat, 300)
  close(result.totalCost, 1800)
  close(result.totalProfit, 1200)
  close(result.totalProfitRate, 400 / 1100)
  close(calculateSaleItem({ price: 100, cost: 1, qty: 1, vatIncluded: true }).unitVat, 100 / 11)
})

test('rounded row amounts and costs produce line profit independently of unit profit', () => {
  const item = calculateSaleItem({ price: 4, cost: 1.2, wholesalePrice: 8, qty: 2, vatIncluded: true })
  close(item.discountRate, 0.5)
  close(item.unitVat, 4 / 11)
  close(item.unitProfit, 4 - 1.2 - 4 / 11)
  close(item.unitProfitRate, (4 - 1.2 - 4 / 11) / 4)
  assert.equal(item.totalGross, 8)
  assert.equal(item.totalVat, 1)
  assert.equal(item.totalCost, 2)
  assert.equal(item.totalProfit, 5)
  assert.notEqual(item.totalProfit, item.unitProfit * 2)
})

test('sale VAT and total are the sum of rounded VAT-inclusive and mixed VAT rows', () => {
  const first = calculateSaleTotals({
    items: [
      { price: 5, cost: 0, qty: 1, vatIncluded: true },
      { price: 5, cost: 0, qty: 1, vatIncluded: true },
    ],
    shippingCost: 0,
  })
  assert.equal(first.totalGross, 10)
  assert.equal(first.totalVat, 0)
  assert.equal(first.totalProfit, 10)
  const second = calculateSaleTotals({
    items: [
      { price: 2, cost: 0, qty: 1, vatIncluded: true },
      { price: 4, cost: 0, qty: 1, vatIncluded: false },
    ],
    shippingCost: 0,
  })
  assert.equal(second.totalGross, 6)
  assert.equal(second.totalVat, 0)
  assert.equal(second.totalProfit, 6)
})

test('shipping charge and shipping expense are rounded to whole won once', () => {
  const result = calculateSaleTotals({
    items: [{ price: 110, cost: 50.2, qty: 1, vatIncluded: true }],
    includeShipping: true,
    shippingFee: 4.5,
    shippingVatIncluded: false,
    shippingCost: 1.5,
  })
  assert.equal(result.totalCost, 50)
  assert.equal(result.shippingGross, 6)
  assert.equal(result.shippingVat, 1)
  assert.equal(result.shippingCost, 2)
  assert.equal(result.totalGross, 116)
  assert.equal(result.totalVat, 11)
  assert.equal(result.totalProfit, 53)
})

test('VAT-exclusive item adds VAT to gross but not to profit', () => {
  const result = calculateSaleItem({ price: 1000, cost: 600, wholesalePrice: 1250, qty: 2, vatIncluded: false })

  close(result.discountRate, 0.2)
  close(result.unitGross, 1100)
  close(result.unitVat, 100)
  close(result.unitProfit, 400)
  close(result.unitProfitRate, 400 / 1100)
  close(result.totalGross, 2200)
  close(result.totalVat, 200)
  close(result.totalProfit, 800)
})

test('mixed VAT items and VAT-inclusive charged shipping are added exactly once', () => {
  const result = calculateSaleTotals({
    items: [
      { price: 1100, cost: 600, wholesalePrice: 2200, qty: 2, vatIncluded: true },
      { price: 1000, cost: 500, wholesalePrice: 1250, qty: 3, vatIncluded: false },
    ],
    includeShipping: true,
    shippingFee: 1100,
    shippingVatIncluded: true,
    shippingCost: 300,
  })

  close(result.subtotalGross, 5500)
  close(result.subtotalVat, 500)
  close(result.shippingGross, 1100)
  close(result.shippingVat, 100)
  close(result.totalGross, 6600)
  close(result.totalVat, 600)
  close(result.totalCost, 2700)
  close(result.totalProfit, 3000)
  close(result.totalProfitRate, 3000 / 6600)
})

test('VAT-exclusive shipping is grossed up, and unchecked shipping is not charged', () => {
  const base = {
    items: [{ price: 1000, cost: 500, qty: 2, vatIncluded: false }],
    shippingFee: '1000',
    shippingVatIncluded: false,
    shippingCost: '400',
  }
  const charged = calculateSaleTotals({ ...base, includeShipping: true })
  close(charged.shippingGross, 1100)
  close(charged.shippingVat, 100)
  close(charged.totalGross, 3300)
  close(charged.totalVat, 300)
  close(charged.totalProfit, 1600)

  const uncharged = calculateSaleTotals({ ...base, includeShipping: false })
  close(uncharged.shippingGross, 0)
  close(uncharged.shippingVat, 0)
  close(uncharged.totalGross, 2200)
  close(uncharged.totalProfit, 600)
})

test('zero is valid but zero denominators cannot produce rates', () => {
  const item = calculateSaleItem({ price: '0', cost: '0', wholesalePrice: '0', qty: '0', vatIncluded: true })
  assert.equal(item.discountRate, null)
  assert.equal(item.unitGross, 0)
  assert.equal(item.unitVat, 0)
  assert.equal(item.unitProfit, 0)
  assert.equal(item.unitProfitRate, null)
  assert.equal(item.totalGross, 0)
  assert.equal(item.totalProfit, 0)
  assert.equal(item.totalProfitRate, null)

  const totals = calculateSaleTotals({ items: [{ price: 0, cost: 0, qty: 0 }], shippingCost: 0 })
  assert.equal(totals.totalProfit, 0)
  assert.equal(totals.totalProfitRate, null)
  close(calculateSaleItem({ price: 0, cost: 0, wholesalePrice: 100, qty: 1 }).discountRate, 1)
})

test('missing values are not interpreted as zero profit or discount', () => {
  for (const missing of ['', '  ', null, undefined, 'abc']) {
    const item = calculateSaleItem({ price: 1000, cost: missing, wholesalePrice: missing, qty: 1 })
    assert.equal(item.discountRate, null)
    assert.equal(item.unitProfit, null)
    assert.equal(item.totalProfit, null)
    assert.equal(calculateSaleTotals({ items: [{ price: 1000, cost: missing, qty: 1 }], shippingCost: 0 }).totalProfit, null)
  }
  assert.equal(calculateSaleItem({ price: '', cost: 0, wholesalePrice: 100, qty: 1 }).unitGross, null)
  assert.equal(calculateSaleItem({ price: 100, cost: 0, wholesalePrice: 100, qty: '' }).totalGross, null)
  assert.equal(calculateSaleTotals({ items: [{ price: 100, cost: 0, qty: 0 }], shippingCost: '' }).totalProfit, null)
  assert.equal(calculateSaleTotals({ items: [{ price: 100, cost: '', qty: 0 }], shippingCost: 0 }).totalProfit, null)
  assert.equal(calculateSaleTotals({ items: [], includeShipping: true, shippingFee: '', shippingCost: 0 }).totalGross, null)
})

test('negative price, quantity, cost, wholesale or shipping inputs are unknown', () => {
  const valid = { price: 100, cost: 50, wholesalePrice: 120, qty: 2 }
  assert.equal(calculateSaleItem({ ...valid, price: -1 }).unitGross, null)
  assert.equal(calculateSaleItem({ ...valid, price: -1 }).totalProfit, null)
  assert.equal(calculateSaleItem({ ...valid, qty: '-1' }).totalGross, null)
  assert.equal(calculateSaleItem({ ...valid, qty: '-1' }).totalProfit, null)
  assert.equal(calculateSaleItem({ ...valid, cost: -1 }).unitProfit, null)
  assert.equal(calculateSaleItem({ ...valid, cost: -1 }).totalProfit, null)
  assert.equal(calculateSaleItem({ ...valid, wholesalePrice: -1 }).discountRate, null)
  assert.notEqual(calculateSaleItem({ ...valid, wholesalePrice: -1 }).totalProfit, null)

  const sale = { items: [valid], includeShipping: true, shippingFee: 100, shippingCost: 20 }
  assert.equal(calculateSaleTotals({ ...sale, shippingCost: -1 }).totalProfit, null)
  assert.equal(calculateSaleTotals({ ...sale, shippingFee: '-1' }).shippingGross, null)
  assert.equal(calculateSaleTotals({ ...sale, shippingFee: '-1' }).totalProfit, null)
  assert.equal(calculateSaleTotals({ ...sale, items: [{ ...valid, cost: -1 }] }).totalProfit, null)
})

test('one missing cost makes aggregate profit unknown even if other items are complete', () => {
  const result = calculateSaleTotals({
    items: [
      { price: 1100, cost: 500, qty: 1, vatIncluded: true },
      { price: 2200, qty: 1, vatIncluded: true },
    ],
    shippingCost: 0,
  })
  close(result.totalGross, 3300)
  close(result.totalVat, 300)
  assert.equal(result.totalCost, null)
  assert.equal(result.totalProfit, null)
  assert.equal(result.totalProfitRate, null)
})

test('old saved records without new cost fields remain readable but do not invent profit', () => {
  const result = calculateSaleTotals({
    items: [{ id: 1, name: '기존 품목', price: '1000', qty: '2', vatIncluded: false }],
    includeShipping: false,
    shippingFee: '',
  })
  close(result.totalGross, 2200)
  close(result.totalVat, 200)
  assert.equal(result.items[0].discountRate, null)
  assert.equal(result.totalCost, null)
  assert.equal(result.shippingCost, null)
  assert.equal(result.totalProfit, null)
  assert.doesNotThrow(() => calculateSaleTotals({}))
})

test('shipment and payment records are operational metadata, not margin inputs', () => {
  const sale = {
    items: [{ price: 1100, cost: 600, wholesalePrice: 1400, qty: 2, vatIncluded: true }],
    includeShipping: true,
    shippingFee: 300,
    shippingVatIncluded: true,
    shippingCost: 120,
  }
  const trackedSale = {
    ...sale,
    shipments: [
      { id: 1, status: 'completed', date: '2026-10-22' },
      { id: 2, status: 'before', date: '' },
    ],
    payments: [
      { id: 1, status: 'completed', date: '2026-10-22', amount: 1500 },
      { id: 2, status: 'before', date: '', amount: '' },
    ],
  }

  assert.deepEqual(calculateSaleTotals(trackedSale), calculateSaleTotals(sale))
})
