import { calculateSaleTotals } from './sales-calculations.mjs'

const MONTH_COUNT = 12

export const quoteDateForList = (sale = {}) => String(
  sale?.quoteDate || sale?.saleDate || String(sale?.createdAt ?? '').slice(0, 10) || '',
)

export const quoteMonthForList = (sale = {}) => {
  const match = quoteDateForList(sale).match(/^(\d{4})-(0[1-9]|1[0-2])/)
  return match ? match[0] : ''
}

export const quoteYearsForSales = (sales = [], fallbackYear = '') => {
  const years = new Set()
  const normalizedFallbackYear = String(fallbackYear).slice(0, 4)
  if (/^\d{4}$/.test(normalizedFallbackYear)) years.add(normalizedFallbackYear)

  for (const sale of sales || []) {
    const quoteMonth = quoteMonthForList(sale)
    if (quoteMonth) years.add(quoteMonth.slice(0, 4))
  }

  return [...years].sort((left, right) => right.localeCompare(left))
}

export const calculateMonthlyQuoteSales = (sales = [], year = '') => {
  const normalizedYear = String(year).slice(0, 4)
  const months = Array.from({ length: MONTH_COUNT }, (_, index) => ({
    month: String(index + 1).padStart(2, '0'),
    label: `${index + 1}월`,
    saleCount: 0,
    totalGross: 0,
  }))

  if (!/^\d{4}$/.test(normalizedYear)) return months

  for (const sale of sales || []) {
    const quoteMonth = quoteMonthForList(sale)
    if (!quoteMonth || quoteMonth.slice(0, 4) !== normalizedYear) continue

    const monthIndex = Number(quoteMonth.slice(-2)) - 1
    const month = months[monthIndex]
    if (!month) continue

    month.saleCount += 1
    const totalGross = calculateSaleTotals(sale).totalGross
    if (typeof totalGross === 'number' && Number.isFinite(totalGross)) month.totalGross += totalGross
  }

  return months
}
