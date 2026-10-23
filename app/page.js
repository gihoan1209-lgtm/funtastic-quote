'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { calculateSaleItem, calculateSaleTotals } from '../lib/sales-calculations.mjs'
import { calculateQuoteItem, calculateQuoteTotals, quoteItemsFromSale } from '../lib/quote-calculations.mjs'
import {
  applyCatalogItemToSaleItem,
  catalogItemsFromWorksheetRows,
  normalizeCatalogItem,
  searchCostCatalog,
} from '../lib/cost-catalog.mjs'
import { createSalesListWorkbook, salesRowsForExport } from '../lib/sales-export.mjs'

const QUOTE_STORAGE_KEY = 'funtastic-quote-history'
const SALES_STORAGE_KEY = 'funtastic-sales-history'
const SALES_ACTIVE_VIEW_STORAGE_KEY = 'funtastic-sales-active-view'
const COST_CATALOG_STORAGE_KEY = 'funtastic-cost-catalog'
const COST_CATALOG_PAGE_SIZE = 100
const APP_HISTORY_STATE_KEY = '__funtasticQuoteNavigation'
const APP_HISTORY_VERSION = 1
const APP_TABS = ['sales', 'quote', 'costs']

const createAppNavigation = ({ tab = 'sales', salesView = 'list', selectedSaleId = '' } = {}) => {
  const resolvedTab = APP_TABS.includes(tab) ? tab : 'sales'
  const canOpenSale = resolvedTab === 'sales' && salesView === 'edit' && typeof selectedSaleId === 'string' && selectedSaleId
  return {
    version: APP_HISTORY_VERSION,
    tab: resolvedTab,
    salesView: canOpenSale ? 'edit' : 'list',
    selectedSaleId: canOpenSale ? selectedSaleId : '',
  }
}

const isAppNavigation = (navigation) => (
  navigation?.version === APP_HISTORY_VERSION && APP_TABS.includes(navigation?.tab)
)

const sameAppNavigation = (left, right) => (
  left?.version === right?.version
  && left?.tab === right?.tab
  && left?.salesView === right?.salesView
  && left?.selectedSaleId === right?.selectedSaleId
)

const today = () => new Date().toISOString().slice(0, 10)
const comma = (value) => Math.round(Number(value) || 0).toLocaleString('ko-KR')
const money = (value) => value == null ? '—' : `₩ ${comma(value)}`
const percent = (value) => value == null ? '—' : `${(value * 100).toFixed(1)}%`
const ungroupNumber = (value) => String(value ?? '').replaceAll(',', '')
const formatGroupedNumber = (value) => {
  const raw = ungroupNumber(value)
  if (!raw || !/^\d+(?:\.\d*)?$/.test(raw)) return raw
  const [integer, decimal] = raw.split('.')
  const formattedInteger = Number(integer).toLocaleString('ko-KR')
  return decimal === undefined ? formattedInteger : `${formattedInteger}.${decimal}`
}
const nonNegativeInput = (value) => {
  const raw = ungroupNumber(value)
  return raw === '' || (/^\d+(?:\.\d*)?$/.test(raw) && Number.isFinite(Number(raw)) && Number(raw) >= 0)
}
const cleanOption = (value) => String(value ?? '').trim().toUpperCase() === 'EA' ? '' : String(value ?? '')
const makeId = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const openNativeDatePicker = (event) => {
  try {
    event.currentTarget.showPicker?.()
  } catch {
    // Some browsers do not support showPicker; their native date control still works.
  }
}
const formatQuoteDate = (date = new Date()) => {
  const value = typeof date === 'string' ? new Date(`${date}T00:00:00`) : date
  return `${value.getMonth() + 1}월 ${value.getDate()}일`
}
const formatShortDate = (date) => {
  if (!date) return '-'
  const [, month = '', day = ''] = date.split('-')
  return `${Number(month)}.${Number(day)}`
}

const createItem = (id = 1, values = {}) => ({
  id,
  name: '',
  spec: '',
  qty: '',
  price: '',
  vatIncluded: false,
  note: '',
  ...values,
  spec: cleanOption(values.spec),
})

const createSaleItem = (id = 1, values = {}) => createItem(id, {
  productCode: '',
  spec: '',
  cost: '',
  wholesalePrice: '',
  vatIncluded: true,
  ...values,
})

const createShipment = (id = 1, values = {}) => ({
  id,
  status: 'before',
  date: '',
  memo: '',
  ...values,
})

const createPayment = (id = 1, values = {}) => ({
  id,
  status: 'before',
  date: '',
  amount: '',
  ...values,
})

const normalizedTrackingRows = (rows, createRow) => (
  Array.isArray(rows) && rows.length
    ? rows.map((row, index) => createRow(row?.id ?? index + 1, row))
    : [createRow(1)]
)

const normalizeSaleRecord = (sale = {}) => {
  const record = sale || {}
  const createdDate = String(record.createdAt ?? '').slice(0, 10)
  return {
    ...record,
    saleDate: String(record.saleDate || createdDate || record.quoteDate || today()),
    clientName: String(record.clientName ?? ''),
    contactPhone: String(record.contactPhone ?? ''),
    businessRegistrationNumber: String(record.businessRegistrationNumber ?? ''),
    taxInvoiceEmail: String(record.taxInvoiceEmail ?? ''),
    quoteDate: String(record.quoteDate ?? today()),
    requestedDueDate: String(record.requestedDueDate ?? ''),
    status: record.status === 'confirmed' || record.status === 'issued' ? 'confirmed' : 'draft',
    items: Array.isArray(record.items) && record.items.length
      ? record.items.map((item, index) => createSaleItem(item?.id ?? index + 1, item))
    : [createSaleItem(1)],
    shipments: normalizedTrackingRows(record.shipments, createShipment),
    payments: normalizedTrackingRows(record.payments, createPayment),
  }
}

const createDefaultNotes = (date = today()) => [
  `본 견적서는 ${formatQuoteDate(date)}에 진행된 발주에 대한 견적서입니다.`,
  '본 견적서의 납기일정은 약 2-3주 정도 소요 됩니다.',
  '테이포프(주) 입금계좌: 035-102609-01-026 기업은행',
  '배송은 택배를 통해 발송되며, 택배사는 대한통운입니다.',
  '본 견적서는 발행일로부터 30일동안 유효합니다.',
  '대량건은 단순변심으로 환불이 어려우며, 불량품에 한하여 7일 이내 교환 및 환불 가능합니다.',
]

const DEFAULT_SUPPLIER = {
  reg: '285-86-00885',
  name: '테이포프(주)',
  rep: '한상철',
  addr: '경기도 광주시 직동로8',
  biz: '도매 및 소매업',
  type: '전자상거래업',
  tel: '영업팀 (070-7525-7790)',
}

const SALE_STATUS = {
  draft: { label: '작성중', className: 'status-draft' },
  confirmed: { label: '견적 확정', className: 'status-confirmed' },
}

const SALES_DATE_FIELDS = [
  { value: 'saleDate', label: '등록일' },
  { value: 'quoteDate', label: '견적일' },
  { value: 'requestedDueDate', label: '납기 희망일' },
]

const SALES_SAVE_STATUS = {
  dirty: { label: '저장 필요', className: 'sales-save-status-dirty' },
  saved: { label: '저장되었습니다', className: 'sales-save-status-saved' },
  error: { label: '저장 실패', className: 'sales-save-status-error' },
}

const resizeTextArea = (element) => {
  if (!element) return
  element.style.height = 'auto'
  element.style.height = `${element.scrollHeight + 4}px`
}

const quoteLabel = (quote) => {
  const firstItem = quote.items?.find((item) => item.name?.trim())?.name?.trim()
  return `${quote.recipient?.trim() || '거래처 미입력'} / ${quote.date || '날짜 없음'} / ${firstItem || '품목 미입력'}`
}

const nextItemId = (items) => Math.max(...items.map((item) => Number(item.id) || 0), 0) + 1

const quoteItemsMatch = (left, right) => {
  const normalize = (list) => (list || []).map((item) => [
    item.name || '', cleanOption(item.spec), String(item.qty ?? ''), String(item.price ?? ''),
    Boolean(item.vatIncluded), item.note || '',
  ])
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right))
}

const createSale = () => {
  const createdAt = new Date().toISOString()
  return {
    id: makeId('sale'),
    createdAt,
    updatedAt: createdAt,
    saleDate: today(),
    quoteDate: today(),
    clientName: '',
    contactName: '',
    contactPhone: '',
    businessRegistrationNumber: '',
    taxInvoiceEmail: '',
    recipientTitle: '대표이사 귀하',
    status: 'draft',
    requestedDueDate: '',
    includeShipping: false,
    shippingFee: '',
    shippingCost: 0,
    shippingVatIncluded: true,
    internalMemo: '',
    quoteId: '',
    items: [createSaleItem(1)],
    shipments: [createShipment(1)],
    payments: [createPayment(1)],
  }
}

function toKorean(value) {
  const number = Math.round(Number(value) || 0)
  if (number === 0) return '금영원정'
  const units = ['', '만', '억', '조']
  const digits = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구']
  const positions = ['', '십', '백', '천']
  let result = ''
  let remaining = number
  let unitIndex = 0
  while (remaining > 0) {
    const chunk = remaining % 10000
    if (chunk > 0) {
      let chunkResult = ''
      let digitValue = chunk
      for (let index = 0; index < 4; index += 1) {
        const digit = digitValue % 10
        if (digit > 0) chunkResult = (digit === 1 && index > 0 ? '' : digits[digit]) + positions[index] + chunkResult
        digitValue = Math.floor(digitValue / 10)
      }
      result = chunkResult + units[unitIndex] + result
    }
    remaining = Math.floor(remaining / 10000)
    unitIndex += 1
  }
  return `금${result}원정`
}

export default function QuotePage() {
  const [activeTab, setActiveTab] = useState('sales')
  const [sales, setSales] = useState([])
  const [salesView, setSalesView] = useState('list')
  const [selectedSaleId, setSelectedSaleId] = useState('')
  const [salesSearch, setSalesSearch] = useState('')
  const [salesStatusFilter, setSalesStatusFilter] = useState('all')
  const [salesAdvancedSearchOpen, setSalesAdvancedSearchOpen] = useState(false)
  const [salesDateField, setSalesDateField] = useState('saleDate')
  const [salesDateFrom, setSalesDateFrom] = useState('')
  const [salesDateTo, setSalesDateTo] = useState('')
  const [selectedSaleIds, setSelectedSaleIds] = useState([])
  const [salesSaveState, setSalesSaveState] = useState('idle')
  const [salesEditMode, setSalesEditMode] = useState(false)
  const [salesHydrated, setSalesHydrated] = useState(false)
  const [costCatalog, setCostCatalog] = useState([])
  const [costCatalogMeta, setCostCatalogMeta] = useState(null)
  const [costCatalogSearch, setCostCatalogSearch] = useState('')
  const [costCatalogVisibleCount, setCostCatalogVisibleCount] = useState(COST_CATALOG_PAGE_SIZE)
  const [costCatalogDirty, setCostCatalogDirty] = useState(false)
  const [costCatalogMessage, setCostCatalogMessage] = useState('')
  const [catalogSearchOpenItemId, setCatalogSearchOpenItemId] = useState('')
  const costFileInputRef = useRef(null)
  const salesRef = useRef([])
  const appViewRef = useRef(null)
  const selectAllSalesRef = useRef(null)

  const [date, setDate] = useState(today())
  const [recipient, setRecipient] = useState('')
  const [recipientTitle, setRecipientTitle] = useState('대표이사 귀하')
  const [intro, setIntro] = useState('아래와 같이 납품 및 청구합니다.')
  const [items, setItems] = useState([createItem(1)])
  const [notes, setNotes] = useState(createDefaultNotes)
  const [supplier, setSupplier] = useState(DEFAULT_SUPPLIER)
  const [savedQuotes, setSavedQuotes] = useState([])
  const [selectedQuoteId, setSelectedQuoteId] = useState('')
  const [linkedSaleId, setLinkedSaleId] = useState('')

  salesRef.current = sales
  appViewRef.current = { activeTab, salesView, selectedSaleId, salesSaveState }

  const selectedSale = sales.find((sale) => sale.id === selectedSaleId)
  const linkedSale = sales.find((sale) => sale.id === linkedSaleId)
  const totals = useMemo(() => calculateQuoteTotals(items), [items])
  const selectedSaleTotals = selectedSale ? calculateSaleTotals(selectedSale) : null
  const selectedSaleShippingNet = selectedSaleTotals?.shippingGross != null && selectedSaleTotals?.shippingCost != null
    ? selectedSaleTotals.shippingGross - selectedSaleTotals.shippingCost
    : null

  const filteredCostCatalog = useMemo(() => {
    if (!costCatalogSearch.trim()) return costCatalog
    return searchCostCatalog(costCatalog, costCatalogSearch, Number.POSITIVE_INFINITY)
  }, [costCatalog, costCatalogSearch])
  const visibleCostCatalog = useMemo(
    () => filteredCostCatalog.slice(0, costCatalogVisibleCount),
    [filteredCostCatalog, costCatalogVisibleCount],
  )

  const filteredSales = useMemo(() => {
    const query = salesSearch.trim().toLocaleLowerCase('ko-KR')
    return sales.filter((sale) => {
      const matchesStatus = salesStatusFilter === 'all' || sale.status === salesStatusFilter
      const itemSearchTerms = (sale.items || []).flatMap((item) => [item?.name, item?.productCode, item?.spec])
      const matchesSearch = !query || [sale.clientName, sale.contactName, sale.contactPhone, sale.businessRegistrationNumber, sale.taxInvoiceEmail, ...itemSearchTerms]
        .join(' ')
        .toLocaleLowerCase('ko-KR')
        .includes(query)
      const dateValue = String(sale?.[salesDateField] ?? '')
      const matchesStartDate = !salesDateFrom || (dateValue && dateValue >= salesDateFrom)
      const matchesEndDate = !salesDateTo || (dateValue && dateValue <= salesDateTo)
      return matchesStatus && matchesSearch && matchesStartDate && matchesEndDate
    })
  }, [sales, salesDateField, salesDateFrom, salesDateTo, salesSearch, salesStatusFilter])

  const selectedSales = useMemo(
    () => sales.filter((sale) => selectedSaleIds.includes(sale.id)),
    [sales, selectedSaleIds],
  )
  const allFilteredSalesSelected = filteredSales.length > 0 && filteredSales.every((sale) => selectedSaleIds.includes(sale.id))
  const someFilteredSalesSelected = filteredSales.some((sale) => selectedSaleIds.includes(sale.id))
  const hasSalesFilters = Boolean(salesSearch.trim() || salesStatusFilter !== 'all' || salesDateFrom || salesDateTo)

  useEffect(() => {
    if (selectAllSalesRef.current) {
      selectAllSalesRef.current.indeterminate = someFilteredSalesSelected && !allFilteredSalesSelected
    }
  }, [allFilteredSalesSelected, someFilteredSalesSelected])

  useEffect(() => {
    const saleIdSet = new Set(sales.map((sale) => sale.id))
    setSelectedSaleIds((current) => {
      const next = current.filter((saleId) => saleIdSet.has(saleId))
      return next.length === current.length ? current : next
    })
  }, [sales])

  const toggleSaleSelection = (saleId) => {
    setSelectedSaleIds((current) => (
      current.includes(saleId) ? current.filter((currentId) => currentId !== saleId) : [...current, saleId]
    ))
  }

  const toggleAllFilteredSales = () => {
    const visibleIds = filteredSales.map((sale) => sale.id)
    setSelectedSaleIds((current) => {
      if (visibleIds.every((saleId) => current.includes(saleId))) return current.filter((saleId) => !visibleIds.includes(saleId))
      return [...new Set([...current, ...visibleIds])]
    })
  }

  const resetSalesFilters = () => {
    setSalesSearch('')
    setSalesStatusFilter('all')
    setSalesDateField('saleDate')
    setSalesDateFrom('')
    setSalesDateTo('')
  }

  const writeAppHistory = useCallback((navigation, mode = 'push') => {
    if (typeof window === 'undefined') return
    const nextNavigation = createAppNavigation(navigation)
    try {
      const currentState = window.history.state || {}
      const currentNavigation = currentState[APP_HISTORY_STATE_KEY]
      if (mode === 'push' && sameAppNavigation(currentNavigation, nextNavigation)) return
      const nextState = { ...currentState, [APP_HISTORY_STATE_KEY]: nextNavigation }
      if (mode === 'replace') {
        window.history.replaceState(nextState, '', window.location.href)
      } else {
        window.history.pushState(nextState, '', window.location.href)
      }
    } catch {
      // Browser history is optional. The in-app navigation controls still work without it.
    }
  }, [])

  const applyAppNavigation = useCallback((navigation, saleRecords = salesRef.current) => {
    const requested = isAppNavigation(navigation) ? createAppNavigation(navigation) : createAppNavigation()
    const canOpenSale = requested.tab === 'sales' && requested.salesView === 'edit'
      && saleRecords.some((sale) => sale.id === requested.selectedSaleId)
    const resolved = canOpenSale ? requested : createAppNavigation({ tab: requested.tab })

    setActiveTab(resolved.tab)
    if (resolved.tab === 'sales') {
      setSalesView(resolved.salesView)
      setSelectedSaleId(resolved.selectedSaleId)
    }
    setSalesEditMode(false)
    setCatalogSearchOpenItemId('')
    return resolved
  }, [])

  const showSalesList = (historyMode = 'replace') => {
    setCatalogSearchOpenItemId('')
    setSalesEditMode(false)
    setSelectedSaleId('')
    setSalesView('list')
    setActiveTab('sales')
    writeAppHistory({ tab: 'sales' }, historyMode)
  }

  const selectAppTab = (tab) => {
    const keepOpenSale = tab === 'sales' && salesView === 'edit' && selectedSaleId
      && sales.some((sale) => sale.id === selectedSaleId)
    const navigation = createAppNavigation({
      tab,
      salesView: keepOpenSale ? 'edit' : 'list',
      selectedSaleId: keepOpenSale ? selectedSaleId : '',
    })
    setActiveTab(navigation.tab)
    if (navigation.tab === 'sales' && navigation.salesView === 'list') {
      setSalesView('list')
      setSelectedSaleId('')
    }
    writeAppHistory(navigation)
  }

  useLayoutEffect(() => {
    const resizeAll = () => document.querySelectorAll('textarea[data-autosize="true"]').forEach(resizeTextArea)
    resizeAll()
    window.addEventListener('beforeprint', resizeAll)
    return () => window.removeEventListener('beforeprint', resizeAll)
  }, [activeTab, items, notes, selectedSale])

  useEffect(() => {
    try {
      const quotes = JSON.parse(window.localStorage.getItem(QUOTE_STORAGE_KEY) || '[]')
      setSavedQuotes(Array.isArray(quotes) ? quotes : [])
    } catch {
      setSavedQuotes([])
    }
    let loadedSales = []
    try {
      const storedSales = JSON.parse(window.localStorage.getItem(SALES_STORAGE_KEY) || '[]')
      loadedSales = Array.isArray(storedSales) ? storedSales.map(normalizeSaleRecord) : []
      setSales(loadedSales)
    } catch {
      setSales([])
    }
    salesRef.current = loadedSales

    let savedNavigation = null
    try {
      const savedView = JSON.parse(window.sessionStorage.getItem(SALES_ACTIVE_VIEW_STORAGE_KEY) || 'null')
      const selectedId = typeof savedView?.selectedSaleId === 'string' ? savedView.selectedSaleId : ''
      if (savedView?.version === 1 && savedView?.tab === 'sales' && selectedId
        && loadedSales.some((sale) => sale.id === selectedId)) {
        savedNavigation = createAppNavigation({ tab: 'sales', salesView: 'edit', selectedSaleId: selectedId })
      } else {
        window.sessionStorage.removeItem(SALES_ACTIVE_VIEW_STORAGE_KEY)
      }
    } catch {
      // Session storage is optional; the sales list still works without it.
    }
    try {
      const storedCatalog = JSON.parse(window.localStorage.getItem(COST_CATALOG_STORAGE_KEY) || 'null')
      const storedItems = Array.isArray(storedCatalog) ? storedCatalog : storedCatalog?.items
      setCostCatalog(Array.isArray(storedItems)
        ? storedItems.map((item, index) => normalizeCatalogItem(item, `stored-${index + 1}`))
        : [])
      setCostCatalogMeta(Array.isArray(storedCatalog) ? null : (storedCatalog?.meta || null))
    } catch {
      setCostCatalog([])
      setCostCatalogMeta(null)
    }

    const currentNavigation = window.history.state?.[APP_HISTORY_STATE_KEY]
    if (isAppNavigation(currentNavigation)) {
      const resolved = applyAppNavigation(currentNavigation, loadedSales)
      if (!sameAppNavigation(currentNavigation, resolved)) writeAppHistory(resolved, 'replace')
    } else {
      const listNavigation = createAppNavigation({ tab: 'sales' })
      writeAppHistory(listNavigation, 'replace')
      if (savedNavigation) {
        applyAppNavigation(savedNavigation, loadedSales)
        writeAppHistory(savedNavigation)
      } else {
        applyAppNavigation(listNavigation, loadedSales)
      }
    }

    const handlePopState = (event) => {
      const currentView = appViewRef.current
      const targetNavigation = isAppNavigation(event.state?.[APP_HISTORY_STATE_KEY])
        ? createAppNavigation(event.state[APP_HISTORY_STATE_KEY])
        : createAppNavigation()
      const currentNavigation = createAppNavigation({
        tab: currentView?.activeTab,
        salesView: currentView?.salesView,
        selectedSaleId: currentView?.selectedSaleId,
      })
      const isLeavingDirtySale = currentView?.activeTab === 'sales'
        && currentView.salesView === 'edit'
        && currentView.salesSaveState === 'dirty'
        && !sameAppNavigation(currentNavigation, targetNavigation)

      if (isLeavingDirtySale) {
        const shouldSave = window.confirm('저장하지 않은 변경사항이 있습니다.\n\n확인: 저장 후 이전 화면으로 이동\n취소: 현재 화면에 머무르기')
        if (!shouldSave) {
          writeAppHistory(currentNavigation)
          return
        }
        const saved = persistSales(salesRef.current)
        setSalesSaveState(saved ? 'saved' : 'error')
        if (!saved) {
          writeAppHistory(currentNavigation)
          return
        }
      }

      applyAppNavigation(event.state?.[APP_HISTORY_STATE_KEY], salesRef.current)
    }
    window.addEventListener('popstate', handlePopState)
    setSalesHydrated(true)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [applyAppNavigation, writeAppHistory])

  useEffect(() => {
    if (!salesHydrated) return
    try {
      const hasActiveDetail = activeTab === 'sales' && salesView === 'edit' && selectedSaleId
        && sales.some((sale) => sale.id === selectedSaleId)
      if (hasActiveDetail) {
        window.sessionStorage.setItem(SALES_ACTIVE_VIEW_STORAGE_KEY, JSON.stringify({
          version: 1,
          tab: 'sales',
          selectedSaleId,
        }))
      } else {
        window.sessionStorage.removeItem(SALES_ACTIVE_VIEW_STORAGE_KEY)
      }
    } catch {
      // Session storage is optional; the sales list still works without it.
    }
  }, [activeTab, sales, salesHydrated, salesView, selectedSaleId])

  useEffect(() => {
    if (salesSaveState !== 'dirty') return undefined
    const warnBeforeUnload = (event) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnBeforeUnload)
    return () => window.removeEventListener('beforeunload', warnBeforeUnload)
  }, [salesSaveState])

  const persistQuotes = (nextQuotes) => {
    setSavedQuotes(nextQuotes)
    try {
      window.localStorage.setItem(QUOTE_STORAGE_KEY, JSON.stringify(nextQuotes))
    } catch {
      window.alert('브라우저 저장소에 견적서를 저장하지 못했습니다. 새로고침 전에 저장 공간과 브라우저 설정을 확인해주세요.')
    }
  }

  const persistSales = (nextSales) => {
    setSales(nextSales)
    try {
      window.localStorage.setItem(SALES_STORAGE_KEY, JSON.stringify(nextSales))
      return true
    } catch {
      window.alert('브라우저 저장소에 영업건을 저장하지 못했습니다. 새로고침 전에 저장 공간과 브라우저 설정을 확인해주세요.')
      return false
    }
  }

  const persistCostCatalog = (nextCatalog, nextMeta = costCatalogMeta) => {
    const normalizedCatalog = nextCatalog.map((item, index) => normalizeCatalogItem(item, `catalog-${index + 1}`))
    setCostCatalog(normalizedCatalog)
    setCostCatalogMeta(nextMeta)
    try {
      window.localStorage.setItem(COST_CATALOG_STORAGE_KEY, JSON.stringify({ items: normalizedCatalog, meta: nextMeta }))
      return true
    } catch {
      window.alert('브라우저 저장소에 원가 데이터를 저장하지 못했습니다. 파일 크기와 브라우저 저장 공간을 확인해주세요.')
      return false
    }
  }

  const updateSelectedSale = (updater) => {
    if (!selectedSaleId) return
    setSalesSaveState('dirty')
    setSales((currentSales) => currentSales.map((sale) => (
      sale.id === selectedSaleId ? { ...updater(sale), updatedAt: new Date().toISOString() } : sale
    )))
  }

  const updateSaleField = (field, value) => {
    if (['shippingFee', 'shippingCost'].includes(field) && !nonNegativeInput(value)) return
    updateSelectedSale((sale) => ({ ...sale, [field]: value }))
  }
  const updateSaleItem = (itemId, field, value) => {
    if (['qty', 'price', 'cost', 'wholesalePrice'].includes(field) && !nonNegativeInput(value)) return
    updateSelectedSale((sale) => ({
      ...sale,
      items: sale.items.map((item) => {
        if (item.id !== itemId) return item
        const nextItem = { ...item, [field]: value }
        // A product selection is a margin snapshot. If its identifying fields
        // are subsequently edited by hand, do not imply it is still linked to
        // the source-catalog row.
        if (['name', 'productCode', 'spec'].includes(field) && item.catalogItemId) {
          nextItem.catalogItemId = ''
          nextItem.catalogCostSource = '품목 정보 수정됨 · 원가 확인'
        }
        if (field === 'cost') {
          nextItem.catalogItemId = ''
          nextItem.catalogCostSource = '직접 입력'
        }
        return nextItem
      }),
    }))
  }
  const addSaleItem = () => updateSelectedSale((sale) => ({
    ...sale,
    items: [...sale.items, createSaleItem(nextItemId(sale.items), { qty: 1 })],
  }))
  const addSaleItemFromPrevious = () => updateSelectedSale((sale) => {
    const previousItem = sale.items[sale.items.length - 1]
    if (!previousItem) return sale
    const previousValues = { ...previousItem }
    delete previousValues.id
    return {
      ...sale,
      items: [...sale.items, createSaleItem(nextItemId(sale.items), previousValues)],
    }
  })
  const removeSaleItem = (itemId) => updateSelectedSale((sale) => ({
    ...sale,
    items: sale.items.length === 1 ? sale.items : sale.items.filter((item) => item.id !== itemId),
  }))

  const selectCatalogItem = (itemId, catalogItem) => {
    updateSelectedSale((sale) => ({
      ...sale,
      items: sale.items.map((item) => item.id === itemId ? applyCatalogItemToSaleItem(item, catalogItem) : item),
    }))
    setCatalogSearchOpenItemId('')
  }

  const updateShipment = (shipmentId, field, value) => updateSelectedSale((sale) => ({
    ...sale,
    shipments: normalizedTrackingRows(sale.shipments, createShipment).map((shipment) => (
      shipment.id === shipmentId ? { ...shipment, [field]: value } : shipment
    )),
  }))
  const addShipment = () => updateSelectedSale((sale) => {
    const shipments = normalizedTrackingRows(sale.shipments, createShipment)
    return { ...sale, shipments: [...shipments, createShipment(nextItemId(shipments))] }
  })
  const removeShipment = (shipmentId) => updateSelectedSale((sale) => {
    const shipments = normalizedTrackingRows(sale.shipments, createShipment)
    return { ...sale, shipments: shipments.length === 1 ? shipments : shipments.filter((shipment) => shipment.id !== shipmentId) }
  })

  const updatePayment = (paymentId, field, value) => {
    if (field === 'amount' && !nonNegativeInput(value)) return
    updateSelectedSale((sale) => ({
      ...sale,
      payments: normalizedTrackingRows(sale.payments, createPayment).map((payment) => (
        payment.id === paymentId ? { ...payment, [field]: value } : payment
      )),
    }))
  }
  const addPayment = () => updateSelectedSale((sale) => {
    const payments = normalizedTrackingRows(sale.payments, createPayment)
    return { ...sale, payments: [...payments, createPayment(nextItemId(payments))] }
  })
  const removePayment = (paymentId) => updateSelectedSale((sale) => {
    const payments = normalizedTrackingRows(sale.payments, createPayment)
    return { ...sale, payments: payments.length === 1 ? payments : payments.filter((payment) => payment.id !== paymentId) }
  })

  const openCostFilePicker = () => costFileInputRef.current?.click()

  const importCostCatalog = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    try {
      const { xlsxSheetsFromFile } = await import('../lib/xlsx-client.mjs')
      const workbookSheets = await xlsxSheetsFromFile(file)
      let parsedCatalog = null
      let matchedSheetName = ''
      let lastError = null

      for (const sheet of workbookSheets) {
        try {
          const candidate = catalogItemsFromWorksheetRows(sheet.rows)
          if (candidate.items.length) {
            parsedCatalog = candidate
            matchedSheetName = sheet.name
            break
          }
        } catch (error) {
          lastError = error
        }
      }

      if (!parsedCatalog) throw lastError || new Error('가져올 수 있는 품목 행이 없습니다.')
      if (costCatalog.length && !window.confirm(`현재 원가표 ${costCatalog.length.toLocaleString('ko-KR')}건을 ${parsedCatalog.items.length.toLocaleString('ko-KR')}건으로 교체할까요?\n\n이미 영업건에 선택해 입력된 원가와 마진은 바뀌지 않습니다.`)) return

      const importedAt = new Date().toISOString()
      const metadata = {
        fileName: file.name,
        sheetName: matchedSheetName,
        importedAt,
        itemCount: parsedCatalog.items.length,
        headerRow: parsedCatalog.headerRow,
      }
      const saved = persistCostCatalog(parsedCatalog.items, metadata)
      setCostCatalogDirty(false)
      setCostCatalogSearch('')
      setCostCatalogVisibleCount(COST_CATALOG_PAGE_SIZE)
      setCostCatalogMessage(saved
        ? `${parsedCatalog.items.length.toLocaleString('ko-KR')}개 품목을 가져왔습니다. O열 신규 원가가 없으면 N열 기존 원가를 적용합니다.`
        : '화면에는 가져왔지만 브라우저 저장에 실패했습니다. 저장 공간을 확인한 뒤 다시 가져와 주세요.')
    } catch (error) {
      const detail = error instanceof Error ? error.message : '알 수 없는 오류'
      window.alert(`원가 파일을 가져오지 못했습니다.\n${detail}`)
    }
  }

  const updateCostCatalogItem = (itemId, field, value) => {
    if (['specialPriceYuan', 'newCostYuan', 'newCost', 'existingCost'].includes(field) && !nonNegativeInput(value)) return
    setCostCatalog((current) => current.map((item) => (
      item.id === itemId ? normalizeCatalogItem({ ...item, [field]: value }, item.id) : item
    )))
    setCostCatalogDirty(true)
    setCostCatalogMessage('')
  }

  const addCostCatalogItem = () => {
    const item = normalizeCatalogItem({
      id: makeId('cost'), productCode: '', name: '', spec: '', specialPriceYuan: '', newCostYuan: '', newCost: '', existingCost: '',
    })
    setCostCatalog((current) => [...current, item])
    setCostCatalogSearch('')
    setCostCatalogVisibleCount(COST_CATALOG_PAGE_SIZE)
    setCostCatalogDirty(true)
    setCostCatalogMessage('')
  }

  const deleteCostCatalogItem = (itemId) => {
    const item = costCatalog.find((candidate) => candidate.id === itemId)
    if (!item || !window.confirm(`${item.name || item.productCode || '이 원가 품목'}을(를) 원가표에서 삭제할까요?\n\n이미 영업건에 입력된 원가와 마진은 유지됩니다.`)) return
    setCostCatalog((current) => current.filter((candidate) => candidate.id !== itemId))
    setCostCatalogDirty(true)
    setCostCatalogMessage('')
  }

  const saveCostCatalog = () => {
    const saved = persistCostCatalog(costCatalog, costCatalogMeta)
    if (saved) {
      setCostCatalogDirty(false)
      setCostCatalogMessage(`${costCatalog.length.toLocaleString('ko-KR')}개 품목을 이 브라우저에 저장했습니다.`)
    }
  }

  const openNewSale = () => {
    const sale = createSale()
    persistSales([sale, ...sales])
    setSalesSaveState('idle')
    setSalesEditMode(true)
    setCatalogSearchOpenItemId('')
    setSelectedSaleId(sale.id)
    setSalesView('edit')
    setActiveTab('sales')
    writeAppHistory({ tab: 'sales', salesView: 'edit', selectedSaleId: sale.id })
  }

  const openSale = (saleId) => {
    setSalesSaveState('idle')
    setSalesEditMode(false)
    setCatalogSearchOpenItemId('')
    setSelectedSaleId(saleId)
    setSalesView('edit')
    setActiveTab('sales')
    writeAppHistory({ tab: 'sales', salesView: 'edit', selectedSaleId: saleId })
  }

  const saveSale = () => {
    const saved = persistSales(sales)
    setSalesSaveState(saved ? 'saved' : 'error')
  }

  const finishSaleEditing = () => {
    const saved = salesSaveState === 'dirty' ? persistSales(sales) : true
    setSalesSaveState(saved ? 'saved' : 'error')
    if (!saved) return
    setCatalogSearchOpenItemId('')
    setSalesEditMode(false)
  }

  const leaveSalesEditor = () => {
    if (salesSaveState === 'dirty') {
      const shouldSave = window.confirm('저장하지 않은 변경사항이 있습니다.\n\n확인: 저장 후 목록으로 이동\n취소: 현재 화면에 머무르기')
      if (!shouldSave) return
      const saved = persistSales(sales)
      setSalesSaveState(saved ? 'saved' : 'error')
      if (!saved) return
    }
    showSalesList()
  }

  const downloadSalesList = (scope = 'selected') => {
    const salesToExport = scope === 'all' ? sales : selectedSales
    const rows = salesRowsForExport(salesToExport)
    if (!rows.length) {
      window.alert('다운로드할 품목이 없습니다.')
      return
    }

    try {
      const workbook = createSalesListWorkbook(rows)
      const blob = new Blob([workbook], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${scope === 'all' ? '전체영업목록' : '선택영업목록'}_${today().replaceAll('-', '')}.xlsx`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => window.URL.revokeObjectURL(url), 0)
    } catch {
      window.alert('엑셀 파일을 만들지 못했습니다. 다시 시도해 주세요.')
    }
  }

  const deleteSelectedSale = () => {
    if (!selectedSale) return
    if (!window.confirm(`${selectedSale.clientName || '이 영업건'}을(를) 삭제할까요? 연결된 견적서는 유지됩니다.`)) return
    persistSales(sales.filter((sale) => sale.id !== selectedSale.id))
    persistQuotes(savedQuotes.map((quote) => quote.salesId === selectedSale.id ? { ...quote, salesId: null } : quote))
    showSalesList()
  }

  const applyQuoteData = (quote) => {
    setDate(quote.date || today())
    setRecipient(quote.recipient || '')
    setRecipientTitle(quote.recipientTitle || '대표이사 귀하')
    setIntro(quote.intro || '아래와 같이 납품 및 청구합니다.')
    setItems(quote.items?.length ? quote.items.map((item, index) => createItem(item?.id ?? index + 1, item)) : [createItem(1)])
    setNotes(quote.notes?.length ? quote.notes : createDefaultNotes(quote.date || today()))
    if (quote.supplier) setSupplier({ ...DEFAULT_SUPPLIER, ...quote.supplier })
    setSelectedQuoteId(quote.id || '')
    setLinkedSaleId(quote.salesId || '')
  }

  const openQuoteForSale = (sale = selectedSale) => {
    if (!sale) return
    const quoteItems = quoteItemsFromSale(sale)
    if (!sale.clientName.trim()) {
      window.alert('견적서를 만들려면 거래처명을 입력해주세요.')
      return
    }
    if (!sale.items?.length || sale.items.some((item) => (
      !item.name?.trim()
      || item.qty === '' || item.qty == null || !Number.isFinite(Number(item.qty)) || Number(item.qty) <= 0
      || item.price === '' || item.price == null || !Number.isFinite(Number(item.price)) || Number(item.price) < 0
    ))) {
      window.alert('견적서를 만들려면 모든 품목의 품명, 수량, 공급가를 입력하거나 빈 품목을 삭제해주세요.')
      return
    }
    if (sale.includeShipping && (sale.shippingFee === '' || sale.shippingFee == null
      || !Number.isFinite(Number(sale.shippingFee)) || Number(sale.shippingFee) < 0)) {
      window.alert('견적서에 반영할 받는 배송비를 입력해주세요. 배송비가 없으면 0을 입력하세요.')
      return
    }

    persistSales(sales)
    const existingQuote = savedQuotes.find((quote) => quote.id === sale.quoteId || quote.salesId === sale.id)
    if (existingQuote) {
      applyQuoteData(existingQuote)
      if ((!quoteItemsMatch(existingQuote.items, quoteItems) || existingQuote.recipient !== sale.clientName
        || existingQuote.recipientTitle !== (sale.recipientTitle || '대표이사 귀하') || existingQuote.date !== (sale.quoteDate || today()))
        && window.confirm('저장된 견적서와 현재 영업건의 거래처, 견적일 또는 품목이 다릅니다.\n\n확인: 현재 영업건 내용으로 견적서에 다시 반영\n취소: 저장된 견적서 그대로 열기\n\n변경한 견적서는 저장 버튼을 눌러야 저장됩니다.')) {
        setRecipient(sale.clientName)
        setRecipientTitle(sale.recipientTitle || '대표이사 귀하')
        setDate(sale.quoteDate || today())
        setItems(quoteItems)
      }
    } else {
      const quoteDate = sale.quoteDate || today()
      setDate(quoteDate)
      setRecipient(sale.clientName)
      setRecipientTitle(sale.recipientTitle || '대표이사 귀하')
      setIntro('아래와 같이 납품 및 청구합니다.')
      setItems(quoteItems)
      setNotes(createDefaultNotes(quoteDate))
      setSelectedQuoteId('')
      setLinkedSaleId(sale.id)
    }
    setActiveTab('quote')
    writeAppHistory({ tab: 'quote' })
  }

  const createBlankQuote = () => {
    setDate(today())
    setRecipient('')
    setRecipientTitle('대표이사 귀하')
    setIntro('아래와 같이 납품 및 청구합니다.')
    setItems([createItem(1)])
    setNotes(createDefaultNotes())
    setSelectedQuoteId('')
    setLinkedSaleId('')
    setActiveTab('quote')
    writeAppHistory({ tab: 'quote' })
  }

  const saveQuote = () => {
    const now = new Date().toISOString()
    const existingQuote = savedQuotes.find((quote) => quote.id === selectedQuoteId)
    const id = existingQuote?.id || makeId('quote')
    const snapshot = { date, recipient, recipientTitle, intro, items, notes, supplier }
    const quote = {
      id,
      ...snapshot,
      salesId: linkedSaleId || null,
      createdAt: existingQuote?.createdAt || now,
      savedAt: now,
      title: quoteLabel(snapshot),
    }
    const nextQuotes = existingQuote
      ? savedQuotes.map((savedQuote) => savedQuote.id === id ? quote : savedQuote)
      : [quote, ...savedQuotes]
    persistQuotes(nextQuotes)
    setSelectedQuoteId(id)

    if (linkedSaleId) {
      persistSales(sales.map((sale) => sale.id === linkedSaleId ? {
        ...sale,
        quoteId: id,
        updatedAt: now,
      } : sale))
    }
  }

  const loadQuote = () => {
    const quote = savedQuotes.find((savedQuote) => savedQuote.id === selectedQuoteId)
    if (quote) applyQuoteData(quote)
  }

  const deleteQuote = () => {
    if (!selectedQuoteId) return
    const quote = savedQuotes.find((savedQuote) => savedQuote.id === selectedQuoteId)
    if (quote && !window.confirm(`${quote.title || quoteLabel(quote)} 저장 기록을 삭제할까요?`)) return
    persistQuotes(savedQuotes.filter((savedQuote) => savedQuote.id !== selectedQuoteId))
    if (quote?.salesId) {
      persistSales(sales.map((sale) => sale.id === quote.salesId && sale.quoteId === quote.id
        ? { ...sale, quoteId: '', updatedAt: new Date().toISOString() }
        : sale))
    }
    setSelectedQuoteId('')
  }

  const updateSupplier = (field, value) => setSupplier((previous) => ({ ...previous, [field]: value }))
  const updateItem = useCallback((itemId, field, value) => {
    if (['qty', 'price'].includes(field) && !nonNegativeInput(value)) return
    setItems((currentItems) => currentItems.map((item) => item.id === itemId ? { ...item, [field]: value } : item))
  }, [])
  const addItem = () => setItems((currentItems) => [...currentItems, createItem(nextItemId(currentItems), { qty: 1, price: 0 })])
  const removeItem = (itemId) => setItems((currentItems) => currentItems.length === 1 ? currentItems : currentItems.filter((item) => item.id !== itemId))
  const updateNote = (index, value) => setNotes((currentNotes) => currentNotes.map((note, noteIndex) => noteIndex === index ? value : note))
  const addNote = () => setNotes((currentNotes) => [...currentNotes, ''])
  const removeNote = (index) => setNotes((currentNotes) => currentNotes.filter((_, noteIndex) => noteIndex !== index))

  const handlePrint = () => {
    document.querySelectorAll('textarea[data-autosize="true"]').forEach(resizeTextArea)
    const previousTitle = document.title
    const cleanRecipient = recipient.trim().replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ')
    document.title = `${date.replaceAll('-', '').slice(2)}_${cleanRecipient || '거래처'}_견적서`
    window.addEventListener('afterprint', () => { document.title = previousTitle }, { once: true })
    window.print()
  }

  const quoteToolbar = (
    <div className="toolbar-actions">
      <button className="btn" onClick={saveQuote}>저장</button>
      <select className="quote-select" value={selectedQuoteId} onChange={(event) => setSelectedQuoteId(event.target.value)}>
        <option value="">저장된 견적서</option>
        {savedQuotes.map((quote) => <option key={quote.id} value={quote.id}>{quote.title || quoteLabel(quote)}</option>)}
      </select>
      <button className="btn" onClick={loadQuote} disabled={!selectedQuoteId}>불러오기</button>
      <button className="btn" onClick={deleteQuote} disabled={!selectedQuoteId}>삭제</button>
      <button className="btn" onClick={createBlankQuote}>새 견적서</button>
      <button className="btn btn-white" onClick={handlePrint}>인쇄 / PDF</button>
    </div>
  )

  return (
    <>
      <header className="toolbar no-print">
        <div className="toolbar-left">
          <div className="toolbar-logo">펀타 영업·견적</div>
          <nav className="app-tabs" aria-label="주요 메뉴">
            <button className={`app-tab ${activeTab === 'sales' ? 'app-tab-active' : ''}`} onClick={() => selectAppTab('sales')}>영업관리</button>
            <button className={`app-tab ${activeTab === 'quote' ? 'app-tab-active' : ''}`} onClick={() => selectAppTab('quote')}>견적서</button>
            <button className={`app-tab ${activeTab === 'costs' ? 'app-tab-active' : ''}`} onClick={() => selectAppTab('costs')}>원가관리</button>
          </nav>
        </div>
        {activeTab === 'quote'
          ? quoteToolbar
          : activeTab === 'costs'
            ? <div className="toolbar-actions"><button className="btn-light" onClick={saveCostCatalog} disabled={!costCatalogDirty}>원가표 저장</button><button className="btn btn-white" onClick={openCostFilePicker}>원가 파일 가져오기</button></div>
            : <div className="toolbar-actions"><button className="btn btn-white" onClick={openNewSale}>+ 새 영업건</button></div>}
      </header>

      <input ref={costFileInputRef} className="visually-hidden" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={importCostCatalog} />

      {activeTab === 'sales' ? (
        <main className="sales-page">
          {salesView === 'list' ? (
            <>
              <section className="sales-heading">
                <div>
                  <p className="eyebrow">SALES MANAGEMENT</p>
                  <h1>영업관리</h1>
                  <p>거래처와 품목을 관리하고, 확정된 내용을 견적서로 바로 보냅니다.</p>
                </div>
                <div className="sales-heading-actions">
                  <button className="btn-light sales-heading-action" onClick={() => downloadSalesList('selected')} disabled={!selectedSales.length}>선택 엑셀 다운로드 ({selectedSales.length})</button>
                  <button className="btn-light sales-heading-action" onClick={() => downloadSalesList('all')} disabled={!sales.length}>전체 엑셀 다운로드</button>
                  <button className="button-primary sales-heading-action" onClick={openNewSale}>+ 새 영업건</button>
                </div>
              </section>

              <section className="sales-list-card">
                <div className="sales-controls">
                  <input className="sales-search" value={salesSearch} onChange={(event) => setSalesSearch(event.target.value)} placeholder="거래처 또는 품명 검색" aria-label="영업건 검색" />
                  <select value={salesStatusFilter} onChange={(event) => setSalesStatusFilter(event.target.value)} aria-label="영업 상태 필터">
                    <option value="all">전체 상태</option>
                    {Object.entries(SALE_STATUS).map(([value, status]) => <option key={value} value={value}>{status.label}</option>)}
                  </select>
                  <button type="button" className={`btn-light sales-filter-toggle${salesAdvancedSearchOpen ? ' is-active' : ''}`} onClick={() => setSalesAdvancedSearchOpen((current) => !current)} aria-expanded={salesAdvancedSearchOpen}>상세 검색</button>
                  {hasSalesFilters && <button type="button" className="btn-light sales-filter-reset" onClick={resetSalesFilters}>초기화</button>}
                  <span className="sales-count">{filteredSales.length}건{selectedSales.length ? ` · ${selectedSales.length}건 선택` : ''}</span>
                </div>
                {salesAdvancedSearchOpen && (
                  <div className="sales-advanced-filters">
                    <label className="field sales-date-filter"><span>일자 기준</span><select value={salesDateField} onChange={(event) => setSalesDateField(event.target.value)}>{SALES_DATE_FIELDS.map((field) => <option key={field.value} value={field.value}>{field.label}</option>)}</select></label>
                    <label className="field sales-date-filter"><span>시작일</span><input type="date" value={salesDateFrom} onClick={openNativeDatePicker} onChange={(event) => setSalesDateFrom(event.target.value)} /></label>
                    <span className="sales-date-range-mark">~</span>
                    <label className="field sales-date-filter"><span>종료일</span><input type="date" value={salesDateTo} onClick={openNativeDatePicker} onChange={(event) => setSalesDateTo(event.target.value)} /></label>
                  </div>
                )}

                {filteredSales.length ? (
                  <div className="sales-table-wrap">
                    <table className="sales-table">
                      <thead><tr><th className="sales-select-cell"><input ref={selectAllSalesRef} type="checkbox" checked={allFilteredSalesSelected} onChange={toggleAllFilteredSales} aria-label="현재 목록 전체 선택" disabled={!filteredSales.length} /></th><th>등록일</th><th>상태</th><th>거래처</th><th>대표 품목</th><th>품목 수</th><th>견적합계</th><th>총순이익</th><th>순이익률</th></tr></thead>
                      <tbody>
                        {filteredSales.map((sale) => {
                          const quoteItems = quoteItemsFromSale(sale)
                          const saleTotals = calculateSaleTotals(sale)
                          const profit = saleTotals.totalProfit
                          const profitRate = saleTotals.totalProfitRate
                          const firstItem = quoteItems[0]?.name || '품목 미입력'
                          const status = SALE_STATUS[sale.status] || SALE_STATUS.draft
                          const isSelected = selectedSaleIds.includes(sale.id)
                          return (
                            <tr key={sale.id} onClick={() => openSale(sale.id)}>
                              <td className="sales-select-cell"><input type="checkbox" checked={isSelected} onClick={(event) => event.stopPropagation()} onChange={() => toggleSaleSelection(sale.id)} aria-label={`${sale.clientName || '거래처 미입력'} 선택`} /></td>
                              <td>{formatShortDate(sale.saleDate)}</td>
                              <td><span className={`status-badge ${status.className}`}>{status.label}</span></td>
                              <td className="sales-client">{sale.clientName || '거래처 미입력'}</td>
                              <td>{firstItem}</td>
                              <td>{sale.items?.filter((item) => item.name?.trim()).length || 0}개</td>
                              <td className="amount">{money(saleTotals.totalGross)}</td>
                              <td className={`amount ${profit != null && profit < 0 ? 'amount-negative' : ''}`}>{money(profit)}</td>
                              <td className={`amount ${profitRate != null && profitRate < 0 ? 'amount-negative' : ''}`}>{percent(profitRate)}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="empty-state">
                    <div className="empty-state-icon">+</div>
                    <h2>{sales.length ? '조건에 맞는 영업건이 없습니다.' : '아직 등록된 영업건이 없습니다.'}</h2>
                    <p>{sales.length ? '검색어나 상태를 바꿔보세요.' : '거래처와 품목을 먼저 등록하면 견적서로 바로 보낼 수 있습니다.'}</p>
                    {!sales.length && <button className="button-primary" onClick={openNewSale}>첫 영업건 등록</button>}
                  </div>
                )}
              </section>
            </>
          ) : selectedSale ? (
            <>
              <div className="sales-detail-header">
                <button className="back-button" onClick={leaveSalesEditor}>← 목록</button>
                <div className="sales-detail-status">
                  <select className="status-select" value={selectedSale.status} onChange={(event) => updateSaleField('status', event.target.value)} aria-label="영업 상태" disabled={!salesEditMode}>
                    {Object.entries(SALE_STATUS).map(([value, status]) => <option key={value} value={value}>{status.label}</option>)}
                  </select>
                </div>
                <div className="sales-detail-actions">
                  {salesEditMode ? (
                    <>
                      <button className="btn-light btn-del" onClick={deleteSelectedSale}>삭제</button>
                      <button className="btn-light" onClick={saveSale}>저장</button>
                      <button className="btn-light" onClick={finishSaleEditing}>편집 완료</button>
                    </>
                  ) : <button className="btn-light" onClick={() => { setSalesEditMode(true); setSalesSaveState('idle') }}>편집</button>}
                  {salesSaveState !== 'idle' && <span className={`sales-save-status ${SALES_SAVE_STATUS[salesSaveState].className}`} role="status">{SALES_SAVE_STATUS[salesSaveState].label}</span>}
                  <button className="button-primary" onClick={() => openQuoteForSale(selectedSale)}>견적서 작업</button>
                </div>
              </div>

              <div className={`sales-edit-fields${salesEditMode ? ' is-editing' : ' sales-readonly'}`}>
                <fieldset disabled={!salesEditMode}>
              <section className="sales-detail-title">
                <div><p className="eyebrow">SALES RECORD</p><h1>{selectedSale.clientName || '새 영업건'}</h1></div>
              </section>

              <div className="sales-record-overview">
                <section className="form-card sales-core-card">
                  <div className="sales-date-strip sales-core-date-strip">
                    <label className="field"><span>견적일</span><input type="date" value={selectedSale.quoteDate} onClick={openNativeDatePicker} onChange={(event) => updateSaleField('quoteDate', event.target.value)} /></label>
                    <label className="field"><span>납기 희망일</span><input type="date" value={selectedSale.requestedDueDate} onClick={openNativeDatePicker} onChange={(event) => updateSaleField('requestedDueDate', event.target.value)} /></label>
                  </div>
                  <div className="sales-core-heading"><h2>거래처 정보</h2></div>
                  <div className="form-fields sales-core-fields">
                    <label className="field"><span>거래처명 <em>*</em></span><input value={selectedSale.clientName} onChange={(event) => updateSaleField('clientName', event.target.value)} /></label>
                    <label className="field"><span>사업자번호</span><input value={selectedSale.businessRegistrationNumber} onChange={(event) => updateSaleField('businessRegistrationNumber', event.target.value)} placeholder="000-00-00000" autoComplete="off" /></label>
                    <label className="field"><span>세금계산서 받을 메일주소</span><input type="email" value={selectedSale.taxInvoiceEmail} onChange={(event) => updateSaleField('taxInvoiceEmail', event.target.value)} placeholder="tax@example.com" autoComplete="email" /></label>
                    <label className="field"><span>연락처</span><input type="tel" value={selectedSale.contactPhone} onChange={(event) => updateSaleField('contactPhone', event.target.value)} placeholder="010-0000-0000" autoComplete="tel" /></label>
                  </div>
                </section>

                <section className="form-card tracking-card">
                  <div className="tracking-card-header">
                    <h2>출고 · 입금 관리</h2>
                  </div>
                  <div className="tracking-stack">
                    <section className="tracking-section tracking-shipment-section">
                      <div className="tracking-section-heading"><h3>출고</h3><button type="button" className="btn-light" onClick={addShipment}>+ 출고 추가</button></div>
                      <div className="tracking-list">
                        {selectedSale.shipments.map((shipment, index) => (
                          <div className="tracking-row tracking-shipment-row" key={shipment.id}>
                            <div className="tracking-row-top">
                              <div className="tracking-status-buttons" role="group" aria-label={`출고 ${index + 1} 상태`}>
                                <button type="button" aria-pressed={shipment.status === 'before'} className={`tracking-status-button tracking-status-before ${shipment.status === 'before' ? 'is-active' : ''}`} onClick={() => updateShipment(shipment.id, 'status', 'before')}>출고전</button>
                                <button type="button" aria-pressed={shipment.status === 'completed'} className={`tracking-status-button tracking-status-completed ${shipment.status === 'completed' ? 'is-active' : ''}`} onClick={() => updateShipment(shipment.id, 'status', 'completed')}>출고완료</button>
                              </div>
                              <button type="button" className="btn-light btn-del tracking-remove" onClick={() => removeShipment(shipment.id)} disabled={selectedSale.shipments.length === 1}>삭제</button>
                            </div>
                            <div className="tracking-row-fields tracking-shipment-fields">
                              <label className="tracking-date-field"><span>출고일</span><input type="date" value={shipment.date} onClick={openNativeDatePicker} onChange={(event) => updateShipment(shipment.id, 'date', event.target.value)} /></label>
                              <label className="tracking-memo-field"><span>메모</span><input value={shipment.memo ?? ''} onChange={(event) => updateShipment(shipment.id, 'memo', event.target.value)} placeholder="출고 메모" /></label>
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>

                    <section className="tracking-section tracking-payment-section">
                      <div className="tracking-section-heading"><h3>입금</h3><button type="button" className="btn-light" onClick={addPayment}>+ 입금 추가</button></div>
                      <div className="tracking-list">
                        {selectedSale.payments.map((payment, index) => (
                          <div className="tracking-row tracking-payment-row" key={payment.id}>
                            <div className="tracking-row-top">
                              <div className="tracking-status-buttons" role="group" aria-label={`입금 ${index + 1} 상태`}>
                                <button type="button" aria-pressed={payment.status === 'before'} className={`tracking-status-button tracking-status-before ${payment.status === 'before' ? 'is-active' : ''}`} onClick={() => updatePayment(payment.id, 'status', 'before')}>입금전</button>
                                <button type="button" aria-pressed={payment.status === 'completed'} className={`tracking-status-button tracking-status-completed ${payment.status === 'completed' ? 'is-active' : ''}`} onClick={() => updatePayment(payment.id, 'status', 'completed')}>입금완료</button>
                              </div>
                              <button type="button" className="btn-light btn-del tracking-remove" onClick={() => removePayment(payment.id)} disabled={selectedSale.payments.length === 1}>삭제</button>
                            </div>
                            <div className="tracking-row-fields tracking-payment-fields">
                              <label className="tracking-amount-field"><span>입금액 (선택)</span><div className="input-with-unit"><input className="formatted-number-input" type="text" inputMode="decimal" value={formatGroupedNumber(payment.amount)} onChange={(event) => updatePayment(payment.id, 'amount', ungroupNumber(event.target.value))} placeholder="0" /><span>원</span></div></label>
                              <label className="tracking-date-field"><span>입금일</span><input type="date" value={payment.date} onClick={openNativeDatePicker} onChange={(event) => updatePayment(payment.id, 'date', event.target.value)} /></label>
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  </div>
                </section>
              </div>

              <section className="form-card items-card">
                <div className="form-card-heading">
                  <div><h2>품목 정보</h2></div>
                  <div className="form-card-actions">
                    <button type="button" className="btn-light" onClick={addSaleItem}>+ 빈 품목 추가</button>
                    <button type="button" className="btn-light" onClick={addSaleItemFromPrevious}>+ 위 품목과 동일하게 추가</button>
                  </div>
                </div>
                <div className={`sales-margin-table-wrap${catalogSearchOpenItemId ? ' sales-margin-table-lookup-open' : ''}`}>
                  <table className="sales-margin-table">
                    <colgroup>
                      <col className="sales-margin-code-col" />
                      <col className="sales-margin-name-col" />
                      <col className="sales-margin-option-col" />
                      <col className="sales-margin-quantity-col" />
                      <col className="sales-margin-cost-col" />
                      <col className="sales-margin-wholesale-col" />
                      <col className="sales-margin-price-col" />
                      <col className="sales-margin-discount-col" />
                      <col className="sales-margin-sales-vat-col" />
                      <col className="sales-margin-profit-col" />
                      <col className="sales-margin-rate-col" />
                    </colgroup>
                    <thead>
                      <tr className="sales-margin-group-row">
                        <th colSpan={3} className="sales-margin-group-product">상품 정보</th>
                        <th colSpan={3} className="sales-margin-group-purchase">매입</th>
                        <th colSpan={2} className="sales-margin-group-sales">판매 조건</th>
                        <th colSpan={3} className="sales-margin-group-profit">마진</th>
                      </tr>
                      <tr className="sales-margin-label-row">
                        <th>코드</th>
                        <th>품목</th>
                        <th>옵션</th>
                        <th>수량 <em>*</em></th>
                        <th>개당 원가</th>
                        <th>도매가</th>
                        <th>공급가 <em>*</em></th>
                        <th>할인율</th>
                        <th>매출 부가세</th>
                        <th>개당 순이익</th>
                        <th>순이익률</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedSale.items.map((item, index) => {
                        const margin = calculateSaleItem(item)
                        const productQuery = item.name ?? ''
                        const catalogSuggestionsId = `catalog-suggestions-${item.id}`
                        const isCatalogSearchOpen = catalogSearchOpenItemId === item.id && Boolean(productQuery.trim())
                        const productCandidates = isCatalogSearchOpen ? searchCostCatalog(costCatalog, productQuery, 8) : []
                        return (
                          <tr key={item.id}>
                            <td><input value={item.productCode ?? ''} onChange={(event) => updateSaleItem(item.id, 'productCode', event.target.value)} placeholder="품목코드" aria-label={`품목 ${index + 1} 품목코드`} /></td>
                            <td className="sales-margin-name-cell">
                              {salesEditMode && <div className="sales-margin-product-toolbar"><span>품목 {index + 1}</span><button type="button" className="btn-light btn-del" onClick={() => removeSaleItem(item.id)} disabled={selectedSale.items.length === 1}>삭제</button></div>}
                              <div className="catalog-search-field sales-margin-product-search" onBlur={(event) => {
                                if (!event.currentTarget.contains(event.relatedTarget)) setCatalogSearchOpenItemId((current) => current === item.id ? '' : current)
                              }}>
                                <div className="catalog-search-box">
                                  <input
                                    value={productQuery}
                                    onFocus={() => setCatalogSearchOpenItemId(item.id)}
                                    onKeyDown={(event) => { if (event.key === 'Escape') setCatalogSearchOpenItemId('') }}
                                    onChange={(event) => updateSaleItem(item.id, 'name', event.target.value)}
                                    placeholder="품명 검색 또는 직접 입력"
                                    autoComplete="off"
                                    aria-label={`품목 ${index + 1} 품명`}
                                    aria-autocomplete="list"
                                    aria-controls={catalogSuggestionsId}
                                    aria-expanded={Boolean(isCatalogSearchOpen)}
                                  />
                                  {isCatalogSearchOpen && <div className="catalog-suggestions" id={catalogSuggestionsId} role="listbox">
                                    {productCandidates.length ? productCandidates.map((catalogItem) => (
                                      <button type="button" className="catalog-suggestion" role="option" aria-label={`${catalogItem.name || '품목명 미입력'} 선택`} key={catalogItem.id} onMouseDown={(event) => event.preventDefault()} onClick={() => selectCatalogItem(item.id, catalogItem)}>
                                        <span className="catalog-suggestion-main"><strong>{catalogItem.name || '품목명 미입력'}</strong><small>{catalogItem.productCode || '코드 없음'}{catalogItem.spec ? ` · ${catalogItem.spec}` : ''}{catalogItem.category ? ` · ${catalogItem.category}` : ''}</small></span>
                                        <span className="catalog-suggestion-cost">{money(catalogItem.cost)}</span>
                                      </button>
                                    )) : <p className="catalog-no-result">{costCatalog.length ? '일치하는 원가표 품목이 없습니다.' : '원가관리 탭에서 원가 파일을 먼저 가져와 주세요.'}</p>}
                                  </div>}
                                </div>
                              </div>
                            </td>
                            <td><input value={item.spec ?? ''} onChange={(event) => updateSaleItem(item.id, 'spec', event.target.value)} placeholder="옵션" aria-label={`품목 ${index + 1} 옵션`} /></td>
                            <td><input className="formatted-number-input" type="text" inputMode="decimal" value={formatGroupedNumber(item.qty)} onChange={(event) => updateSaleItem(item.id, 'qty', ungroupNumber(event.target.value))} placeholder="수량" aria-label={`품목 ${index + 1} 수량`} /></td>
                            <td><input className="formatted-number-input" type="text" inputMode="decimal" value={formatGroupedNumber(item.cost)} onChange={(event) => updateSaleItem(item.id, 'cost', ungroupNumber(event.target.value))} placeholder="원가" aria-label={`품목 ${index + 1} 개당 원가`} /></td>
                            <td><input className="formatted-number-input" type="text" inputMode="decimal" value={formatGroupedNumber(item.wholesalePrice)} onChange={(event) => updateSaleItem(item.id, 'wholesalePrice', ungroupNumber(event.target.value))} placeholder="도매가" aria-label={`품목 ${index + 1} 도매가`} /></td>
                            <td><input className="formatted-number-input" type="text" inputMode="decimal" value={formatGroupedNumber(item.price)} onChange={(event) => updateSaleItem(item.id, 'price', ungroupNumber(event.target.value))} placeholder="공급가" aria-label={`품목 ${index + 1} 공급가`} /></td>
                            <td className="sales-margin-metric">{percent(margin.discountRate)}</td>
                            <td className="sales-margin-metric">{money(margin.unitVat)}</td>
                            <td className={`sales-margin-metric sales-margin-profit-value ${margin.unitProfit != null && margin.unitProfit < 0 ? 'amount-negative' : ''}`}>{money(margin.unitProfit)}</td>
                            <td className={`sales-margin-metric sales-margin-profit-rate ${margin.unitProfitRate != null && margin.unitProfitRate < 0 ? 'amount-negative' : ''}`}>{percent(margin.unitProfitRate)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="margin-summary">
                  <div className="margin-summary-heading">
                    <div><h3>TOTAL</h3><span>견적 금액과 비용을 기준으로 자동 계산됩니다</span></div>
                  </div>
                  <div className="total-summary-groups">
                    <section className="total-group total-group-sales"><h4>매출</h4><div className="total-line"><span>견적합계</span><strong>{money(selectedSaleTotals.totalGross)}</strong></div><div className="total-line"><span>매출 부가세</span><strong>{money(selectedSaleTotals.totalVat)}</strong></div></section>
                    <section className="total-group total-group-cost"><h4>비용</h4><div className="total-line"><span>총 원가</span><strong>{money(selectedSaleTotals.totalCost)}</strong></div><div className="total-line"><span>배송비 차액 <small>(받은−실)</small></span><strong className={selectedSaleShippingNet != null && selectedSaleShippingNet < 0 ? 'amount-negative' : ''}>{money(selectedSaleShippingNet)}</strong></div></section>
                    <section className="total-group total-group-profit"><h4>마진</h4><div className="total-line total-line-primary"><span>총 순이익</span><strong className={selectedSaleTotals.totalProfit != null && selectedSaleTotals.totalProfit < 0 ? 'amount-negative' : ''}>{money(selectedSaleTotals.totalProfit)}</strong></div><div className="total-line"><span>순이익률</span><strong className={selectedSaleTotals.totalProfitRate != null && selectedSaleTotals.totalProfitRate < 0 ? 'amount-negative' : ''}>{percent(selectedSaleTotals.totalProfitRate)}</strong></div></section>
                  </div>
                  <div className="total-shipping-bar">
                    <strong>배송비</strong>
                    <label className="margin-shipping-field"><span>받은 배송비 (+)</span><div className="input-with-unit"><input className="formatted-number-input" type="text" inputMode="decimal" value={formatGroupedNumber(selectedSale.shippingFee)} onChange={(event) => updateSaleField('shippingFee', ungroupNumber(event.target.value))} placeholder="0" /><span>원</span></div></label>
                    <label className="margin-shipping-field"><span>실 배송비 (-)</span><div className="input-with-unit"><input className="formatted-number-input" type="text" inputMode="decimal" value={formatGroupedNumber(selectedSale.shippingCost)} onChange={(event) => updateSaleField('shippingCost', ungroupNumber(event.target.value))} placeholder="0" /><span>원</span></div></label>
                    <label className="check-label" title="받는 배송비를 견적서와 매출에 반영"><input type="checkbox" checked={Boolean(selectedSale.includeShipping)} onChange={(event) => updateSaleField('includeShipping', event.target.checked)} />견적서 반영</label>
                    <label className="check-label" title="받는 배송비 VAT 포함"><input type="checkbox" checked={Boolean(selectedSale.shippingVatIncluded)} onChange={(event) => updateSaleField('shippingVatIncluded', event.target.checked)} disabled={!selectedSale.includeShipping} />VAT 포함</label>
                  </div>
                  {selectedSaleTotals.totalProfit == null && <p className="margin-warning">순이익을 계산하려면 모든 품목의 공급가·수량·원가와 실 배송비를 0 이상으로 입력해 주세요. 받은 배송비를 반영할 때도 금액이 필요합니다. 비용이 없으면 0을 입력하세요.</p>}
                </div>
              </section>

              <section className="form-card">
                <h2>내부 메모</h2>
                <textarea className="internal-memo" value={selectedSale.internalMemo} onChange={(event) => updateSaleField('internalMemo', event.target.value)} placeholder="고객 협의 내용, 특이사항 등 내부에서만 볼 메모를 남기세요." rows={4} />
              </section>
                </fieldset>
              </div>
            </>
          ) : (
            <div className="empty-state"><h2>영업건을 찾을 수 없습니다.</h2><button className="button-primary" onClick={() => showSalesList()}>목록으로 이동</button></div>
          )}
        </main>
      ) : activeTab === 'costs' ? (
        <main className="cost-page">
          <section className="sales-heading">
            <div>
              <p className="eyebrow">COST CATALOG</p>
              <h1>원가관리</h1>
              <p>원가 파일을 가져오면 영업관리에서 품목 또는 품목코드로 검색해 원가를 바로 채울 수 있습니다.</p>
            </div>
            <button className="button-primary" onClick={openCostFilePicker}>원가 파일 가져오기</button>
          </section>

          <section className="cost-import-card">
            <div>
              <h2>원가 원본 데이터</h2>
              <p><strong>O열 works 신규 원가</strong>를 우선 적용하고, O열이 비어 있으면 <strong>N열 works 기존 원가</strong>를 사용합니다. J열 특가(元), K열 신규원가(元), 품목코드·품목명·규격과 원가 열을 이 브라우저에만 저장합니다.</p>
              {costCatalogMeta && <p className="cost-meta">최근 가져오기: {costCatalogMeta.fileName} · {costCatalogMeta.sheetName || '시트'} · {costCatalogMeta.itemCount?.toLocaleString('ko-KR')}건</p>}
            </div>
            <div className="cost-import-actions">
              {costCatalogDirty && <span className="catalog-unsaved">저장 필요</span>}
              <button className="btn-light" onClick={saveCostCatalog} disabled={!costCatalogDirty}>원가표 저장</button>
              <button className="btn" onClick={openCostFilePicker}>{costCatalog.length ? '새 파일로 교체' : '엑셀 파일 선택'}</button>
            </div>
          </section>

          {costCatalogMessage && <p className="catalog-message" role="status">{costCatalogMessage}</p>}

          <section className="sales-list-card cost-catalog-card">
            <div className="sales-controls">
              <input
                className="sales-search"
                value={costCatalogSearch}
                onChange={(event) => { setCostCatalogSearch(event.target.value); setCostCatalogVisibleCount(COST_CATALOG_PAGE_SIZE) }}
                placeholder="품목코드, 품목명, 규격 검색"
                aria-label="원가 품목 검색"
              />
              <button className="btn-light" onClick={addCostCatalogItem}>+ 직접 추가</button>
              <span className="sales-count">{filteredCostCatalog.length.toLocaleString('ko-KR')}건{costCatalogDirty ? ' · 저장 필요' : ''}</span>
            </div>

            {costCatalog.length ? (
              filteredCostCatalog.length ? (
                <>
                  <div className="cost-table-wrap">
                    <table className="cost-table">
                      <colgroup>
                        <col className="cost-col-code" />
                        <col className="cost-col-name" />
                        <col className="cost-col-spec" />
                        <col className="cost-col-yuan" />
                        <col className="cost-col-yuan" />
                        <col className="cost-col-work" />
                        <col className="cost-col-work" />
                        <col className="cost-col-applied" />
                        <col className="cost-col-actions" />
                      </colgroup>
                      <thead><tr><th>품목코드</th><th>품목명</th><th>규격</th><th>특가 (元) · J</th><th>신규원가 (元) · K</th><th>works 기존 원가 (N)</th><th>works 신규 원가 (O)</th><th>적용 원가</th><th></th></tr></thead>
                      <tbody>
                        {visibleCostCatalog.map((item) => (
                          <tr key={item.id}>
                            <td data-label="품목코드"><input aria-label="품목코드" value={item.productCode} onChange={(event) => updateCostCatalogItem(item.id, 'productCode', event.target.value)} placeholder="품목코드" /></td>
                            <td data-label="품목명"><input aria-label="품목명" value={item.name} onChange={(event) => updateCostCatalogItem(item.id, 'name', event.target.value)} placeholder="품목명" /></td>
                            <td data-label="규격"><input aria-label="규격" value={item.spec} onChange={(event) => updateCostCatalogItem(item.id, 'spec', event.target.value)} placeholder="규격" /></td>
                            <td data-label="특가 (元) · J"><input aria-label="특가 위안화 J열" className="number-input formatted-number-input" type="text" inputMode="decimal" value={formatGroupedNumber(item.specialPriceYuan)} onChange={(event) => updateCostCatalogItem(item.id, 'specialPriceYuan', ungroupNumber(event.target.value))} placeholder="-" /></td>
                            <td data-label="신규원가 (元) · K"><input aria-label="신규원가 위안화 K열" className="number-input formatted-number-input" type="text" inputMode="decimal" value={formatGroupedNumber(item.newCostYuan)} onChange={(event) => updateCostCatalogItem(item.id, 'newCostYuan', ungroupNumber(event.target.value))} placeholder="-" /></td>
                            <td data-label="works 기존 원가 (N)"><input aria-label="works 기존 원가 N열" className="number-input formatted-number-input" type="text" inputMode="decimal" value={formatGroupedNumber(item.existingCost)} onChange={(event) => updateCostCatalogItem(item.id, 'existingCost', ungroupNumber(event.target.value))} placeholder="-" /></td>
                            <td data-label="works 신규 원가 (O)"><input aria-label="works 신규 원가 O열" className="number-input formatted-number-input" type="text" inputMode="decimal" value={formatGroupedNumber(item.newCost)} onChange={(event) => updateCostCatalogItem(item.id, 'newCost', ungroupNumber(event.target.value))} placeholder="-" /></td>
                            <td data-label="적용 원가" className="amount cost-apply-cell">{money(item.cost)}</td>
                            <td data-label="관리" className="center cost-delete-cell"><button className="btn-light btn-del" onClick={() => deleteCostCatalogItem(item.id)}>×</button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {visibleCostCatalog.length < filteredCostCatalog.length && <div className="cost-load-more"><button className="btn-light" onClick={() => setCostCatalogVisibleCount((current) => current + COST_CATALOG_PAGE_SIZE)}>다음 {Math.min(COST_CATALOG_PAGE_SIZE, filteredCostCatalog.length - visibleCostCatalog.length)}건 더 보기</button><span>{visibleCostCatalog.length.toLocaleString('ko-KR')} / {filteredCostCatalog.length.toLocaleString('ko-KR')}건 표시</span></div>}
                </>
              ) : (
                <div className="empty-state"><h2>검색 결과가 없습니다.</h2><p>품목코드, 품목명 또는 규격을 다시 확인해 주세요.</p></div>
              )
            ) : (
              <div className="empty-state">
                <div className="empty-state-icon">₩</div>
                <h2>아직 원가 데이터가 없습니다.</h2>
                <p>원가 엑셀 파일을 가져오면 품목 검색과 원가 자동 입력을 바로 사용할 수 있습니다.</p>
                <button className="button-primary" onClick={openCostFilePicker}>원가 파일 가져오기</button>
              </div>
            )}
          </section>

          <p className="cost-catalog-help">원가표를 수정하거나 새 파일로 교체해도, 이미 영업건에 입력된 원가와 마진은 바뀌지 않습니다. 과거 견적의 수익 기록을 보호하기 위해 선택 당시의 값만 영업건에 복사합니다.</p>
        </main>
      ) : (
        <main className="page">
          {linkedSale && (
            <div className="linked-sale-banner no-print">
              <div><span>연결된 영업건</span><strong>{linkedSale.clientName || '거래처 미입력'}</strong><small>{SALE_STATUS[linkedSale.status]?.label || '작성중'} · 견적서에서 수정한 거래처와 품목은 영업관리 정보에 자동 반영되지 않습니다.</small></div>
              <button className="btn-light" onClick={() => openSale(linkedSale.id)}>영업건 열기</button>
            </div>
          )}

          <div className="quote-paper">
            <div className="quote-title">견 적 서</div>

            <div className="info-grid">
              <div className="info-left">
                {[
                  ['날  짜', 'date'],
                  ['수  신', 'recipient'],
                  ['참  조', 'recipientTitle'],
                ].map(([label, field]) => (
                  <div key={field} className="info-row">
                    <span className="info-label">{label}</span>
                    <div className="info-val">
                      {field === 'date'
                        ? <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="editable-inline" />
                        : field === 'recipient'
                          ? <input value={recipient} onChange={(event) => setRecipient(event.target.value)} className="editable-inline" placeholder="거래처명" />
                          : <input value={recipientTitle} onChange={(event) => setRecipientTitle(event.target.value)} className="editable-inline" placeholder="대표님 귀하" />}
                    </div>
                  </div>
                ))}
                <div className="quote-intro"><input value={intro} onChange={(event) => setIntro(event.target.value)} className="editable-inline" /></div>
              </div>

              <div className="supplier-area">
                <div className="supplier-vertical">공급자</div>
                <div className="supplier-fields">
                  <div className="info-row"><span className="info-label">등록번호</span><div className="info-val"><input className="editable-inline centered-input" value={supplier.reg} onChange={(event) => updateSupplier('reg', event.target.value)} /></div></div>
                  <div className="info-row"><span className="info-label compact-label">상&nbsp;&nbsp;호</span><div className="info-val"><input className="editable-inline" value={supplier.name} onChange={(event) => updateSupplier('name', event.target.value)} /></div><span className="info-label compact-label divided-label">성&nbsp;&nbsp;명</span><div className="info-val"><input className="editable-inline" value={supplier.rep} onChange={(event) => updateSupplier('rep', event.target.value)} /></div></div>
                  <div className="info-row"><span className="info-label">사업장 주소</span><div className="info-val"><input className="editable-inline" value={supplier.addr} onChange={(event) => updateSupplier('addr', event.target.value)} /></div></div>
                  <div className="info-row"><span className="info-label compact-label">업&nbsp;&nbsp;태</span><div className="info-val"><input className="editable-inline" value={supplier.biz} onChange={(event) => updateSupplier('biz', event.target.value)} /></div><span className="info-label compact-label divided-label">종&nbsp;&nbsp;목</span><div className="info-val"><input className="editable-inline" value={supplier.type} onChange={(event) => updateSupplier('type', event.target.value)} /></div></div>
                  <div className="info-row"><span className="info-label">전화번호</span><div className="info-val"><input className="editable-inline" value={supplier.tel} onChange={(event) => updateSupplier('tel', event.target.value)} /></div></div>
                </div>
              </div>
            </div>

            <div className="total-box">
              <div className="total-label">합계금액<br /><span>(공급가액+세액)</span></div>
              <div><div className="total-amount">₩ {comma(totals.total)}</div><div className="total-text">{toKorean(totals.total)}</div></div>
            </div>

            <div className="action-row no-print"><button className="btn-light" onClick={addItem}>+ 품목 추가</button></div>

            <div className="quote-table-wrap">
              <table className="items-table">
                <thead><tr><th className="narrow-cell">No.</th><th>품명</th><th className="spec-cell">옵션</th><th className="quantity-cell">수량</th><th className="price-cell">단가</th><th className="supply-cell">공급가액</th><th className="vat-cell">세액</th><th className="note-cell">비고</th><th className="narrow-cell no-print"></th></tr></thead>
                <tbody>
                  {items.map((item, index) => {
                    const { supply, vat } = calculateQuoteItem(item)
                    return (
                      <tr key={item.id}>
                        <td className="center">{index + 1}</td>
                        <td><textarea className="editable item-name" data-autosize="true" value={item.name} onChange={(event) => updateItem(item.id, 'name', event.target.value)} placeholder="품명" rows={1} onInput={(event) => resizeTextArea(event.currentTarget)} /></td>
                        <td className="center"><input className="editable" value={item.spec} onChange={(event) => updateItem(item.id, 'spec', event.target.value)} /></td>
                        <td><input className="editable num formatted-number-input" type="text" inputMode="decimal" value={formatGroupedNumber(item.qty)} onChange={(event) => updateItem(item.id, 'qty', ungroupNumber(event.target.value))} /></td>
                        <td><input className="editable num formatted-number-input" type="text" inputMode="decimal" value={formatGroupedNumber(item.price)} onChange={(event) => updateItem(item.id, 'price', ungroupNumber(event.target.value))} /></td>
                        <td className="num">{comma(supply)}</td>
                        <td className="center"><label className="quote-vat"><input className="no-print" type="checkbox" checked={Boolean(item.vatIncluded)} onChange={(event) => updateItem(item.id, 'vatIncluded', event.target.checked)} aria-label="단가에 VAT 포함" />{comma(vat)}</label></td>
                        <td><input className="editable" value={item.note} onChange={(event) => updateItem(item.id, 'note', event.target.value)} placeholder="" /></td>
                        <td className="center no-print"><button className="btn-light btn-del" onClick={() => removeItem(item.id)}>×</button></td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot><tr><td colSpan={5} className="center">합계</td><td className="num">{comma(totals.supply)}</td><td className="num">{comma(totals.vat)}</td><td colSpan={2}></td></tr></tfoot>
              </table>
            </div>

            <div className="notes">
              {notes.map((note, index) => (
                <div key={`${index}-${note}`} className="note-item">
                  <span className="note-prefix">※</span>
                  <textarea className="note-text" data-autosize="true" value={note} onChange={(event) => updateNote(index, event.target.value)} rows={1} onInput={(event) => resizeTextArea(event.currentTarget)} />
                  <button className="btn-light btn-del no-print" onClick={() => removeNote(index)}>×</button>
                </div>
              ))}
              <button className="btn-light no-print" onClick={addNote}>+ 비고 추가</button>
            </div>
          </div>
        </main>
      )}
    </>
  )
}
