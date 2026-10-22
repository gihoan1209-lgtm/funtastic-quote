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

const QUOTE_STORAGE_KEY = 'funtastic-quote-history'
const SALES_STORAGE_KEY = 'funtastic-sales-history'
const COST_CATALOG_STORAGE_KEY = 'funtastic-cost-catalog'
const COST_CATALOG_PAGE_SIZE = 100

const today = () => new Date().toISOString().slice(0, 10)
const comma = (value) => Math.round(Number(value) || 0).toLocaleString('ko-KR')
const money = (value) => value == null ? '—' : `₩ ${comma(value)}`
const percent = (value) => value == null ? '—' : `${(value * 100).toFixed(1)}%`
const nonNegativeInput = (value) => value === '' || (Number.isFinite(Number(value)) && Number(value) >= 0)
const makeId = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
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
  spec: 'EA',
  qty: '',
  price: '',
  vatIncluded: false,
  note: '',
  ...values,
})

const createSaleItem = (id = 1, values = {}) => createItem(id, {
  productCode: '',
  cost: '',
  wholesalePrice: '',
  vatIncluded: true,
  ...values,
})

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
  issued: { label: '발행완료', className: 'status-issued' },
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
    item.name || '', item.spec || 'EA', String(item.qty ?? ''), String(item.price ?? ''),
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
    recipientTitle: '대표이사 귀하',
    status: 'draft',
    requestedDueDate: '',
    validityDays: '30',
    includeShipping: false,
    shippingFee: '',
    shippingCost: 0,
    shippingVatIncluded: true,
    internalMemo: '',
    quoteId: '',
    issuedAt: '',
    items: [createSaleItem(1)],
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
  const [costCatalog, setCostCatalog] = useState([])
  const [costCatalogMeta, setCostCatalogMeta] = useState(null)
  const [costCatalogSearch, setCostCatalogSearch] = useState('')
  const [costCatalogVisibleCount, setCostCatalogVisibleCount] = useState(COST_CATALOG_PAGE_SIZE)
  const [costCatalogDirty, setCostCatalogDirty] = useState(false)
  const [costCatalogMessage, setCostCatalogMessage] = useState('')
  const [productSearches, setProductSearches] = useState({})
  const costFileInputRef = useRef(null)

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

  const selectedSale = sales.find((sale) => sale.id === selectedSaleId)
  const linkedSale = sales.find((sale) => sale.id === linkedSaleId)
  const totals = useMemo(() => calculateQuoteTotals(items), [items])
  const selectedSaleTotals = selectedSale ? calculateSaleTotals(selectedSale) : null

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
      const firstItem = sale.items?.find((item) => item.name?.trim())?.name || ''
      const matchesSearch = !query || [sale.clientName, sale.contactName, firstItem]
        .join(' ')
        .toLocaleLowerCase('ko-KR')
        .includes(query)
      return matchesStatus && matchesSearch
    })
  }, [sales, salesSearch, salesStatusFilter])

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
    try {
      const storedSales = JSON.parse(window.localStorage.getItem(SALES_STORAGE_KEY) || '[]')
      setSales(Array.isArray(storedSales) ? storedSales : [])
    } catch {
      setSales([])
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
  }, [])

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
    } catch {
      window.alert('브라우저 저장소에 영업건을 저장하지 못했습니다. 새로고침 전에 저장 공간과 브라우저 설정을 확인해주세요.')
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
    setSales((currentSales) => currentSales.map((sale) => (
      sale.id === selectedSaleId ? { ...updater(sale), updatedAt: new Date().toISOString() } : sale
    )))
  }

  const updateSaleField = (field, value) => {
    if (['shippingFee', 'shippingCost', 'validityDays'].includes(field) && !nonNegativeInput(value)) return
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
  const removeSaleItem = (itemId) => updateSelectedSale((sale) => ({
    ...sale,
    items: sale.items.length === 1 ? sale.items : sale.items.filter((item) => item.id !== itemId),
  }))

  const updateProductSearch = (searchKey, value) => {
    setProductSearches((current) => ({ ...current, [searchKey]: value }))
  }

  const selectCatalogItem = (itemId, catalogItem, searchKey) => {
    updateSelectedSale((sale) => ({
      ...sale,
      items: sale.items.map((item) => item.id === itemId ? applyCatalogItemToSaleItem(item, catalogItem) : item),
    }))
    setProductSearches((current) => ({ ...current, [searchKey]: '' }))
  }

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
    setSelectedSaleId(sale.id)
    setSalesView('edit')
    setActiveTab('sales')
  }

  const openSale = (saleId) => {
    setSelectedSaleId(saleId)
    setSalesView('edit')
    setActiveTab('sales')
  }

  const saveSale = () => persistSales(sales)

  const deleteSelectedSale = () => {
    if (!selectedSale) return
    if (!window.confirm(`${selectedSale.clientName || '이 영업건'}을(를) 삭제할까요? 연결된 견적서는 유지됩니다.`)) return
    persistSales(sales.filter((sale) => sale.id !== selectedSale.id))
    persistQuotes(savedQuotes.map((quote) => quote.salesId === selectedSale.id ? { ...quote, salesId: null } : quote))
    setSelectedSaleId('')
    setSalesView('list')
  }

  const applyQuoteData = (quote) => {
    setDate(quote.date || today())
    setRecipient(quote.recipient || '')
    setRecipientTitle(quote.recipientTitle || '대표이사 귀하')
    setIntro(quote.intro || '아래와 같이 납품 및 청구합니다.')
    setItems(quote.items?.length ? quote.items : [createItem(1)])
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

  const markLinkedSaleIssued = () => {
    if (!linkedSaleId) return
    const now = new Date().toISOString()
    persistSales(sales.map((sale) => sale.id === linkedSaleId ? {
      ...sale,
      status: 'issued',
      issuedAt: now,
      updatedAt: now,
    } : sale))
  }

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
      {linkedSaleId && <button className="btn" onClick={markLinkedSaleIssued}>발행완료</button>}
      <button className="btn btn-white" onClick={handlePrint}>인쇄 / PDF</button>
    </div>
  )

  return (
    <>
      <header className="toolbar no-print">
        <div className="toolbar-left">
          <div className="toolbar-logo">펀타 영업·견적</div>
          <nav className="app-tabs" aria-label="주요 메뉴">
            <button className={`app-tab ${activeTab === 'sales' ? 'app-tab-active' : ''}`} onClick={() => setActiveTab('sales')}>영업관리</button>
            <button className={`app-tab ${activeTab === 'quote' ? 'app-tab-active' : ''}`} onClick={() => setActiveTab('quote')}>견적서</button>
            <button className={`app-tab ${activeTab === 'costs' ? 'app-tab-active' : ''}`} onClick={() => setActiveTab('costs')}>원가관리</button>
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
                <button className="button-primary" onClick={openNewSale}>+ 새 영업건</button>
              </section>

              <section className="sales-list-card">
                <div className="sales-controls">
                  <input className="sales-search" value={salesSearch} onChange={(event) => setSalesSearch(event.target.value)} placeholder="거래처 또는 품명 검색" aria-label="영업건 검색" />
                  <select value={salesStatusFilter} onChange={(event) => setSalesStatusFilter(event.target.value)} aria-label="영업 상태 필터">
                    <option value="all">전체 상태</option>
                    {Object.entries(SALE_STATUS).map(([value, status]) => <option key={value} value={value}>{status.label}</option>)}
                  </select>
                  <span className="sales-count">{filteredSales.length}건</span>
                </div>

                {filteredSales.length ? (
                  <div className="sales-table-wrap">
                    <table className="sales-table">
                      <thead><tr><th>등록일</th><th>상태</th><th>거래처</th><th>대표 품목</th><th>품목 수</th><th>견적 합계</th><th>총순이익</th><th></th></tr></thead>
                      <tbody>
                        {filteredSales.map((sale) => {
                          const quoteItems = quoteItemsFromSale(sale)
                          const saleTotals = calculateSaleTotals(sale)
                          const profit = saleTotals.totalProfit
                          const firstItem = quoteItems[0]?.name || '품목 미입력'
                          const status = SALE_STATUS[sale.status] || SALE_STATUS.draft
                          return (
                            <tr key={sale.id} onClick={() => openSale(sale.id)}>
                              <td>{formatShortDate(sale.saleDate)}</td>
                              <td><span className={`status-badge ${status.className}`}>{status.label}</span></td>
                              <td className="sales-client">{sale.clientName || '거래처 미입력'}</td>
                              <td>{firstItem}</td>
                              <td>{sale.items?.filter((item) => item.name?.trim()).length || 0}개</td>
                              <td className="amount">{money(saleTotals.totalGross)}</td>
                              <td className={`amount ${profit != null && profit < 0 ? 'amount-negative' : ''}`}>{money(profit)}</td>
                              <td className="sales-row-action"><button className="table-link" onClick={(event) => { event.stopPropagation(); openQuoteForSale(sale) }}>{sale.quoteId ? '견적서 편집' : '견적서 작성'}</button></td>
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
                <button className="back-button" onClick={() => setSalesView('list')}>← 목록</button>
                <div className="sales-detail-actions">
                  <button className="btn-light btn-del" onClick={deleteSelectedSale}>삭제</button>
                  <button className="btn-light" onClick={saveSale}>저장</button>
                  <button className="button-primary" onClick={() => openQuoteForSale(selectedSale)}>견적서 작성</button>
                </div>
              </div>

              <section className="sales-detail-title">
                <div><p className="eyebrow">SALES RECORD</p><h1>{selectedSale.clientName || '새 영업건'}</h1></div>
                <select className="status-select" value={selectedSale.status} onChange={(event) => updateSaleField('status', event.target.value)} aria-label="영업 상태">
                  {Object.entries(SALE_STATUS).map(([value, status]) => <option key={value} value={value}>{status.label}</option>)}
                </select>
              </section>

              <div className="sales-form-grid">
                <section className="form-card">
                  <h2>거래처 정보</h2>
                  <div className="form-fields two-columns">
                    <label className="field field-wide"><span>거래처명 <em>*</em></span><input value={selectedSale.clientName} onChange={(event) => updateSaleField('clientName', event.target.value)} placeholder="예: 글로벌아그로" /></label>
                    <label className="field"><span>담당자명</span><input value={selectedSale.contactName} onChange={(event) => updateSaleField('contactName', event.target.value)} placeholder="담당자 이름" /></label>
                    <label className="field"><span>연락처</span><input value={selectedSale.contactPhone} onChange={(event) => updateSaleField('contactPhone', event.target.value)} placeholder="010-0000-0000" /></label>
                    <label className="field"><span>영업 등록일</span><input type="date" value={selectedSale.saleDate} onChange={(event) => updateSaleField('saleDate', event.target.value)} /></label>
                    <label className="field"><span>견적일</span><input type="date" value={selectedSale.quoteDate} onChange={(event) => updateSaleField('quoteDate', event.target.value)} /></label>
                    <label className="field"><span>수신 표기</span><input value={selectedSale.recipientTitle} onChange={(event) => updateSaleField('recipientTitle', event.target.value)} placeholder="대표이사 귀하" /></label>
                  </div>
                </section>

                <section className="form-card">
                  <h2>거래 조건</h2>
                  <div className="form-fields two-columns">
                    <label className="field"><span>납기 희망일</span><input type="date" value={selectedSale.requestedDueDate} onChange={(event) => updateSaleField('requestedDueDate', event.target.value)} /></label>
                    <label className="field"><span>견적 유효기간</span><div className="input-with-unit"><input type="number" min="0" value={selectedSale.validityDays} onChange={(event) => updateSaleField('validityDays', event.target.value)} /><span>일</span></div></label>
                    <label className="field"><span>받는 배송비 (+)</span><div className="input-with-unit"><input type="number" min="0" value={selectedSale.shippingFee ?? ''} onChange={(event) => updateSaleField('shippingFee', event.target.value)} placeholder="0" /><span>원</span></div></label>
                    <label className="field"><span>부담 배송비 (-)</span><div className="input-with-unit"><input type="number" min="0" value={selectedSale.shippingCost ?? ''} onChange={(event) => updateSaleField('shippingCost', event.target.value)} placeholder="0" /><span>원</span></div></label>
                    <div className="shipping-options field-wide">
                      <label className="check-label"><input type="checkbox" checked={Boolean(selectedSale.includeShipping)} onChange={(event) => updateSaleField('includeShipping', event.target.checked)} />받는 배송비를 견적서와 매출에 반영</label>
                      <label className="check-label"><input type="checkbox" checked={Boolean(selectedSale.shippingVatIncluded)} onChange={(event) => updateSaleField('shippingVatIncluded', event.target.checked)} disabled={!selectedSale.includeShipping} />받는 배송비 VAT 포함</label>
                    </div>
                    <p className="margin-note field-wide">고객에게 받는 배송비와 실제 부담하는 배송비를 각각 입력하세요. 부담 배송비가 없으면 0을 입력합니다.</p>
                  </div>
                </section>
              </div>

              <section className="form-card items-card">
                <div className="form-card-heading">
                  <div><h2>품목 및 개당 마진</h2><p>품명·옵션·수량·공급가만 견적서로 넘어가며, 원가와 이익은 내부에서만 보입니다.</p></div>
                  <button className="btn-light" onClick={addSaleItem}>+ 품목 추가</button>
                </div>
                <div className="sales-item-list">
                  {selectedSale.items.map((item, index) => {
                    const margin = calculateSaleItem(item)
                    const productSearchKey = `${selectedSale.id}:${item.id}`
                    const productQuery = productSearches[productSearchKey] || ''
                    const productCandidates = productQuery.trim() ? searchCostCatalog(costCatalog, productQuery, 8) : []
                    return (
                      <div className="sales-item-card" key={item.id}>
                        <div className="sales-item-header">
                          <span>품목 {index + 1}{item.productCode ? ` · ${item.productCode}` : ''}{item.name ? ` · ${item.name}` : ''}</span>
                          <button className="btn-light btn-del" onClick={() => removeSaleItem(item.id)} disabled={selectedSale.items.length === 1}>품목 삭제</button>
                        </div>
                        <div className="sales-item-fields">
                          <label className="field field-wide catalog-search-field">
                            <span>원가표에서 품목 찾기</span>
                            <div className="catalog-search-box">
                              <input value={productQuery} onChange={(event) => updateProductSearch(productSearchKey, event.target.value)} placeholder="품목명 또는 품목코드로 검색" autoComplete="off" />
                              {productQuery.trim() && <div className="catalog-suggestions">
                                {productCandidates.length ? productCandidates.map((catalogItem) => (
                                  <button type="button" className="catalog-suggestion" key={catalogItem.id} onClick={() => selectCatalogItem(item.id, catalogItem, productSearchKey)}>
                                    <span className="catalog-suggestion-main"><strong>{catalogItem.name || '품목명 미입력'}</strong><small>{catalogItem.productCode || '코드 없음'}{catalogItem.spec ? ` · ${catalogItem.spec}` : ''}{catalogItem.category ? ` · ${catalogItem.category}` : ''}</small></span>
                                    <span className="catalog-suggestion-cost">{money(catalogItem.cost)}</span>
                                  </button>
                                )) : <p className="catalog-no-result">{costCatalog.length ? '일치하는 원가표 품목이 없습니다.' : '원가관리 탭에서 원가 파일을 먼저 가져와 주세요.'}</p>}
                              </div>}
                            </div>
                            <small>선택하면 품목코드·품명·옵션·개당 원가가 복사됩니다. 공급가와 수량은 유지됩니다.</small>
                          </label>
                          <label className="field"><span>품목코드</span><input value={item.productCode ?? ''} onChange={(event) => updateSaleItem(item.id, 'productCode', event.target.value)} placeholder="예: 100450-0001" /></label>
                          <label className="field"><span>품명 <em>*</em></span><input value={item.name ?? ''} onChange={(event) => updateSaleItem(item.id, 'name', event.target.value)} placeholder="상품명" /></label>
                          <label className="field"><span>옵션</span><input value={item.spec ?? ''} onChange={(event) => updateSaleItem(item.id, 'spec', event.target.value)} placeholder="EA" /></label>
                          <label className="field"><span>구매수량 <em>*</em></span><input type="number" min="0" value={item.qty ?? ''} onChange={(event) => updateSaleItem(item.id, 'qty', event.target.value)} placeholder="수량" /></label>
                          <label className="field"><span>개당 원가</span><input type="number" min="0" value={item.cost ?? ''} onChange={(event) => updateSaleItem(item.id, 'cost', event.target.value)} placeholder="원가 입력" /></label>
                          <label className="field"><span>도매가</span><input type="number" min="0" value={item.wholesalePrice ?? ''} onChange={(event) => updateSaleItem(item.id, 'wholesalePrice', event.target.value)} placeholder="도매가 입력" /></label>
                          <label className="field"><span>공급가 / 견적 단가 <em>*</em></span><input type="number" min="0" value={item.price ?? ''} onChange={(event) => updateSaleItem(item.id, 'price', event.target.value)} placeholder="공급가 입력" /></label>
                          <div className="field"><span>공급가 부가세</span><label className="check-label"><input type="checkbox" checked={Boolean(item.vatIncluded)} onChange={(event) => updateSaleItem(item.id, 'vatIncluded', event.target.checked)} />VAT 포함</label></div>
                        </div>
                        <div className="item-calc-grid">
                          <div className="item-calc"><span>할인율</span><strong>{percent(margin.discountRate)}</strong></div>
                          <div className="item-calc"><span>개당 매출부가세</span><strong>{money(margin.unitVat)}</strong></div>
                          <div className="item-calc"><span>개당 순이익</span><strong className={margin.unitProfit != null && margin.unitProfit < 0 ? 'amount-negative' : ''}>{money(margin.unitProfit)}</strong></div>
                          <div className="item-calc"><span>개당 순이익률</span><strong className={margin.unitProfitRate != null && margin.unitProfitRate < 0 ? 'amount-negative' : ''}>{percent(margin.unitProfitRate)}</strong></div>
                        </div>
                      </div>
                    )
                  })}
                </div>
                <p className="margin-note">새 품목의 공급가는 엑셀과 같이 VAT 포함이 기본입니다. VAT 미포함을 선택하면 견적서에 부가세 10%가 추가됩니다.</p>
                <div className="margin-summary">
                  <div className="margin-summary-heading"><h3>전체 금액 및 마진</h3><span>입력값을 바꾸면 자동으로 계산됩니다</span></div>
                  <div className="margin-summary-grid">
                    <div className="margin-metric"><span>총구매액</span><strong>{money(selectedSaleTotals.totalGross)}</strong><small>고객이 결제할 금액</small></div>
                    <div className="margin-metric"><span>총원가</span><strong>{money(selectedSaleTotals.totalCost)}</strong><small>원가 × 구매수량</small></div>
                    <div className="margin-metric"><span>총매출부가세</span><strong>{money(selectedSaleTotals.totalVat)}</strong></div>
                    <div className="margin-metric"><span>받는 배송비 (+)</span><strong>{money(selectedSaleTotals.shippingGross)}</strong><small>견적서 반영 선택 시 포함</small></div>
                    <div className="margin-metric"><span>부담 배송비 (-)</span><strong>{money(selectedSaleTotals.shippingCost)}</strong></div>
                    <div className="margin-metric"><span>총순이익</span><strong className={selectedSaleTotals.totalProfit != null && selectedSaleTotals.totalProfit < 0 ? 'amount-negative' : ''}>{money(selectedSaleTotals.totalProfit)}</strong></div>
                    <div className="margin-metric"><span>총순이익률</span><strong className={selectedSaleTotals.totalProfitRate != null && selectedSaleTotals.totalProfitRate < 0 ? 'amount-negative' : ''}>{percent(selectedSaleTotals.totalProfitRate)}</strong></div>
                  </div>
                  <p className="margin-note">총순이익 = 총구매액 − 총원가 − 총매출부가세 − 부담 배송비. 받는 배송비는 총구매액에 한 번만 포함합니다. 견적 금액과 맞추기 위해 품목별 금액과 부가세를 원 단위로 반올림합니다.</p>
                  {selectedSaleTotals.totalProfit == null && <p className="margin-warning">순이익을 계산하려면 모든 품목의 공급가·수량·원가와 부담 배송비를 0 이상으로 입력해 주세요. 받는 배송비를 반영할 때도 금액이 필요합니다. 비용이 없으면 0을 입력하세요.</p>}
                </div>
              </section>

              <section className="form-card">
                <h2>내부 메모</h2>
                <textarea className="internal-memo" value={selectedSale.internalMemo} onChange={(event) => updateSaleField('internalMemo', event.target.value)} placeholder="고객 협의 내용, 특이사항 등 내부에서만 볼 메모를 남기세요." rows={4} />
              </section>
            </>
          ) : (
            <div className="empty-state"><h2>영업건을 찾을 수 없습니다.</h2><button className="button-primary" onClick={() => setSalesView('list')}>목록으로 이동</button></div>
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
                      <thead><tr><th>품목코드</th><th>품목명</th><th>규격</th><th>특가 (元) · J</th><th>신규원가 (元) · K</th><th>works 기존 원가 (N)</th><th>works 신규 원가 (O)</th><th>적용 원가</th><th></th></tr></thead>
                      <tbody>
                        {visibleCostCatalog.map((item) => (
                          <tr key={item.id}>
                            <td><input value={item.productCode} onChange={(event) => updateCostCatalogItem(item.id, 'productCode', event.target.value)} placeholder="품목코드" /></td>
                            <td><input value={item.name} onChange={(event) => updateCostCatalogItem(item.id, 'name', event.target.value)} placeholder="품목명" /></td>
                            <td><input value={item.spec} onChange={(event) => updateCostCatalogItem(item.id, 'spec', event.target.value)} placeholder="규격" /></td>
                            <td><input className="number-input" type="number" min="0" step="any" value={item.specialPriceYuan} onChange={(event) => updateCostCatalogItem(item.id, 'specialPriceYuan', event.target.value)} placeholder="-" /></td>
                            <td><input className="number-input" type="number" min="0" step="any" value={item.newCostYuan} onChange={(event) => updateCostCatalogItem(item.id, 'newCostYuan', event.target.value)} placeholder="-" /></td>
                            <td><input className="number-input" type="number" min="0" step="any" value={item.existingCost} onChange={(event) => updateCostCatalogItem(item.id, 'existingCost', event.target.value)} placeholder="-" /></td>
                            <td><input className="number-input" type="number" min="0" step="any" value={item.newCost} onChange={(event) => updateCostCatalogItem(item.id, 'newCost', event.target.value)} placeholder="-" /></td>
                            <td className="amount">{money(item.cost)}</td>
                            <td className="center"><button className="btn-light btn-del" onClick={() => deleteCostCatalogItem(item.id)}>×</button></td>
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
              <button className="btn-light" onClick={() => { setSelectedSaleId(linkedSale.id); setSalesView('edit'); setActiveTab('sales') }}>영업건 열기</button>
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
                <thead><tr><th className="narrow-cell">No.</th><th>품명</th><th className="spec-cell">규격</th><th className="quantity-cell">수량</th><th className="price-cell">단가</th><th className="supply-cell">공급가액</th><th className="vat-cell">세액</th><th className="note-cell">비고</th><th className="narrow-cell no-print"></th></tr></thead>
                <tbody>
                  {items.map((item, index) => {
                    const { supply, vat } = calculateQuoteItem(item)
                    return (
                      <tr key={item.id}>
                        <td className="center">{index + 1}</td>
                        <td><textarea className="editable item-name" data-autosize="true" value={item.name} onChange={(event) => updateItem(item.id, 'name', event.target.value)} placeholder="품명" rows={1} onInput={(event) => resizeTextArea(event.currentTarget)} /></td>
                        <td className="center"><input className="editable" value={item.spec} onChange={(event) => updateItem(item.id, 'spec', event.target.value)} /></td>
                        <td><input className="editable num" type="number" value={item.qty} onChange={(event) => updateItem(item.id, 'qty', event.target.value)} min="0" /></td>
                        <td><input className="editable num" type="number" value={item.price} onChange={(event) => updateItem(item.id, 'price', event.target.value)} min="0" /></td>
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
