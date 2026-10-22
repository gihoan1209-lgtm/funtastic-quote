import { calculateQuoteItem } from './quote-calculations.mjs'

// Unit figures retain spreadsheet precision; whole-won line totals share the
// quote calculation so their displayed rows and totals always agree.
const asNumber = (value) => {
  if (typeof value === 'string') {
    if (value.trim() === '') return null
    value = Number(value)
  }
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? (value === 0 ? 0 : value)
    : null
}

const sumKnown = (values) => (
  values.some((value) => value === null)
    ? null
    : values.reduce((sum, value) => sum + value, 0)
)

const ratio = (numerator, denominator) => (
  numerator === null || denominator === null || denominator === 0
    ? null
    : numerator / denominator
)

/**
 * Calculate one sales item from the existing persisted item shape.
 *
 * `price` is the entered supply price, `cost` the purchase cost per unit,
 * `wholesalePrice` the reference wholesale price, and `qty` the quantity.
 * Rates are fractions (0.2 means 20%). A null result represents missing or
 * undefined input, not a monetary amount of zero.
 */
export function calculateSaleItem(item = {}) {
  const { price: rawPrice, cost: rawCost, wholesalePrice: rawWholesalePrice, qty: rawQty, vatIncluded } = item || {}
  const price = asNumber(rawPrice)
  const cost = asNumber(rawCost)
  const wholesalePrice = asNumber(rawWholesalePrice)
  const qty = asNumber(rawQty)

  const discountRate = price === null || wholesalePrice === null || wholesalePrice === 0
    ? null
    : 1 - price / wholesalePrice
  const unitVat = price === null ? null : (vatIncluded ? price / 11 : price * 0.1)
  const unitGross = price === null ? null : (vatIncluded ? price : price + unitVat)
  const unitProfit = unitGross === null || unitVat === null || cost === null
    ? null
    : unitGross - unitVat - cost
  const unitProfitRate = ratio(unitProfit, unitGross)

  const quoteLine = price === null || qty === null ? null : calculateQuoteItem({ price, qty, vatIncluded })
  const totalGross = quoteLine?.total ?? null
  const totalVat = quoteLine?.vat ?? null
  const totalCost = cost === null || qty === null ? null : Math.round(cost * qty)
  const totalProfit = totalGross === null || totalVat === null || totalCost === null
    ? null
    : totalGross - totalVat - totalCost
  const totalProfitRate = ratio(totalProfit, totalGross)

  return {
    discountRate,
    unitGross,
    unitVat,
    unitProfit,
    unitProfitRate,
    totalGross,
    totalVat,
    totalCost,
    totalProfit,
    totalProfitRate,
  }
}

/**
 * Calculate the sales record with customer shipping revenue and shipping cost.
 * Only a checked `includeShipping` contributes revenue. `shippingFee` is
 * either VAT-inclusive or VAT-exclusive according to `shippingVatIncluded`.
 * `shippingCost` is the separately entered shipping expense; an absent/blank
 * expense remains unknown and prevents a misleading total profit.
 */
export function calculateSaleTotals(sale = {}) {
  const record = sale || {}
  const items = Array.isArray(record.items) ? record.items.map(calculateSaleItem) : []
  const shippingFee = record.includeShipping ? asNumber(record.shippingFee) : 0
  const shippingLine = shippingFee === null
    ? null
    : calculateQuoteItem({ price: shippingFee, qty: 1, vatIncluded: record.shippingVatIncluded })
  const shippingVat = shippingLine?.vat ?? null
  const shippingGross = shippingLine?.total ?? null
  const rawShippingCost = asNumber(record.shippingCost)
  const shippingCost = rawShippingCost === null ? null : Math.round(rawShippingCost)

  const subtotalGross = sumKnown(items.map((item) => item.totalGross))
  const subtotalVat = sumKnown(items.map((item) => item.totalVat))
  const totalCost = sumKnown(items.map((item) => item.totalCost))
  const totalGross = sumKnown([subtotalGross, shippingGross])
  const totalVat = sumKnown([subtotalVat, shippingVat])
  const totalProfit = [totalGross, totalVat, totalCost, shippingCost].some((value) => value === null)
    ? null
    : totalGross - totalVat - totalCost - shippingCost
  const totalProfitRate = ratio(totalProfit, totalGross)

  return {
    items,
    subtotalGross,
    subtotalVat,
    shippingGross,
    shippingVat,
    shippingCost,
    totalGross,
    totalVat,
    totalCost,
    totalProfit,
    totalProfitRate,
  }
}
