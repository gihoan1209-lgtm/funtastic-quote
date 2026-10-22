const asNumber = (value) => {
  if (typeof value === 'string') {
    if (value.trim() === '') return null
    value = Number(value)
  }
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? (value === 0 ? 0 : value)
    : null
}

const customerOption = (value) => String(value ?? '').trim().toUpperCase() === 'EA' ? '' : String(value ?? '')

/**
 * Calculate each line in whole won, so the amounts displayed on each line add
 * up to the displayed total. Empty or invalid inputs remain zero in drafts.
 */
export function calculateQuoteItem(item = {}) {
  const { qty: rawQty, price: rawPrice, vatIncluded } = item || {}
  const qty = asNumber(rawQty) ?? 0
  const price = asNumber(rawPrice) ?? 0

  const amount = Math.round(price * qty)
  if (vatIncluded) {
    const vat = Math.round(amount / 11)
    return { supply: amount - vat, vat, total: amount }
  }

  const vat = Math.round(amount * 0.1)
  return { supply: amount, vat, total: amount + vat }
}

/** Sum already-rounded whole-won line amounts. */
export function calculateQuoteTotals(items = []) {
  const amounts = Array.isArray(items) ? items.map(calculateQuoteItem) : []
  return amounts.reduce((totals, item) => ({
    supply: totals.supply + item.supply,
    vat: totals.vat + item.vat,
    total: totals.total + item.total,
  }), { supply: 0, vat: 0, total: 0 })
}

/**
 * Copy only customer-facing fields. Costs, wholesale prices, margin data and
 * other internal properties must never be included in a quote snapshot.
 */
export function quoteItemsFromSale(sale = {}) {
  const record = sale || {}
  const sourceItems = Array.isArray(record.items) ? record.items : []
  const items = sourceItems
    .filter((item) => typeof item?.name === 'string' && item.name.trim())
    .map((item, index) => ({
      id: index + 1,
      name: item.name,
      spec: customerOption(item.spec),
      qty: item.qty,
      price: item.price,
      vatIncluded: Boolean(item.vatIncluded),
      note: item.note || '',
    }))

  const shippingFee = asNumber(record.shippingFee)
  if (record.includeShipping && shippingFee !== null && shippingFee > 0) {
    items.push({
      id: items.length + 1,
      name: '배송비',
      spec: '건',
      qty: 1,
      price: record.shippingFee,
      vatIncluded: Boolean(record.shippingVatIncluded),
      note: '',
    })
  }
  return items
}
