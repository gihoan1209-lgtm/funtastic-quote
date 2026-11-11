import { calculateSaleTotals } from './sales-calculations.mjs'

const MONTH_COUNT = 12
const REVENUE_SALE_STATUSES = new Set(['inProgress', 'completed'])

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

export const salesForQuotePeriod = (sales = [], year = '', month = '') => {
  const normalizedYear = String(year).slice(0, 4)
  if (!/^\d{4}$/.test(normalizedYear)) return []

  const rawMonth = String(month).trim()
  const normalizedMonth = rawMonth
    ? /^(?:0?[1-9]|1[0-2])$/.test(rawMonth)
      ? String(Number(rawMonth)).padStart(2, '0')
      : null
    : ''

  if (normalizedMonth === null) return []

  const periodPrefix = normalizedMonth
    ? `${normalizedYear}-${normalizedMonth}`
    : `${normalizedYear}-`

  return (sales || []).filter((sale) => quoteDateForList(sale).startsWith(periodPrefix))
}

export const calculateMonthlyQuoteSales = (sales = [], year = '') => {
  const normalizedYear = String(year).slice(0, 4)
  const months = Array.from({ length: MONTH_COUNT }, (_, index) => ({
    month: String(index + 1).padStart(2, '0'),
    label: `${index + 1}월`,
    totalGross: 0,
    totalCost: 0,
    totalProfit: 0,
  }))

  if (!/^\d{4}$/.test(normalizedYear)) return months

  for (const sale of sales || []) {
    // 견적 검토 단계와 진행 불가 건은 매출로 잡지 않는다. 실제 진행 중이거나
    // 완료된 영업건만 월별·연간 매출에 반영한다.
    if (!REVENUE_SALE_STATUSES.has(sale?.status)) continue

    const quoteMonth = quoteMonthForList(sale)
    if (!quoteMonth || quoteMonth.slice(0, 4) !== normalizedYear) continue

    const monthIndex = Number(quoteMonth.slice(-2)) - 1
    const month = months[monthIndex]
    if (!month) continue

    const { totalGross, totalCost, totalProfit } = calculateSaleTotals(sale)
    if (typeof totalGross === 'number' && Number.isFinite(totalGross)) month.totalGross += totalGross

    // 원가 또는 순이익을 아직 계산할 수 없는 영업건이 하나라도 있으면, 그 달의
    // 합계도 임의의 숫자로 표시하지 않는다.
    if (month.totalCost === null || typeof totalCost !== 'number' || !Number.isFinite(totalCost)) month.totalCost = null
    else month.totalCost += totalCost

    if (month.totalProfit === null || typeof totalProfit !== 'number' || !Number.isFinite(totalProfit)) month.totalProfit = null
    else month.totalProfit += totalProfit
  }

  return months.map((month) => ({
    ...month,
    totalProfitRate: month.totalProfit === null || month.totalGross === 0
      ? null
      : month.totalProfit / month.totalGross,
  }))
}
