'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'

const QUOTE_STORAGE_KEY = 'funtastic-quote-history'
const SALES_STORAGE_KEY = 'funtastic-sales-history'

const today = () => new Date().toISOString().slice(0, 10)
const comma = (value) => Math.round(Number(value) || 0).toLocaleString('ko-KR')
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

const calculateTotals = (items) => items.reduce((acc, item) => {
  const supply = (Number(item.qty) || 0) * (Number(item.price) || 0)
  const vat = item.vatIncluded ? 0 : Math.round(supply * 0.1)
  return { supply: acc.supply + supply, vat: acc.vat + vat, total: acc.total + supply + vat }
}, { supply: 0, vat: 0, total: 0 })

const quoteLabel = (quote) => {
  const firstItem = quote.items?.find((item) => item.name?.trim())?.name?.trim()
  return `${quote.recipient?.trim() || '거래처 미입력'} / ${quote.date || '날짜 없음'} / ${firstItem || '품목 미입력'}`
}

const nextItemId = (items) => Math.max(...items.map((item) => Number(item.id) || 0), 0) + 1

const quoteItemsFromSale = (sale) => {
  const items = (sale.items || [])
    .filter((item) => item.name?.trim())
    .map((item, index) => createItem(index + 1, {
      name: item.name,
      spec: item.spec || 'EA',
      qty: item.qty,
      price: item.price,
      vatIncluded: Boolean(item.vatIncluded),
      note: item.note || '',
    }))

  if (sale.includeShipping && Number(sale.shippingFee) > 0) {
    items.push(createItem(items.length + 1, {
      name: '배송비',
      spec: '건',
      qty: 1,
      price: sale.shippingFee,
      vatIncluded: Boolean(sale.shippingVatIncluded),
      note: '',
    }))
  }
  return items
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
    shippingVatIncluded: false,
    internalMemo: '',
    quoteId: '',
    issuedAt: '',
    items: [createItem(1)],
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
  const totals = useMemo(() => calculateTotals(items), [items])

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
  }, [])

  const persistQuotes = (nextQuotes) => {
    setSavedQuotes(nextQuotes)
    try {
      window.localStorage.setItem(QUOTE_STORAGE_KEY, JSON.stringify(nextQuotes))
    } catch {
      // Browser storage might be unavailable, but the in-memory state remains usable.
    }
  }

  const persistSales = (nextSales) => {
    setSales(nextSales)
    try {
      window.localStorage.setItem(SALES_STORAGE_KEY, JSON.stringify(nextSales))
    } catch {
      // Browser storage might be unavailable, but the in-memory state remains usable.
    }
  }

  const updateSelectedSale = (updater) => {
    if (!selectedSaleId) return
    setSales((currentSales) => currentSales.map((sale) => (
      sale.id === selectedSaleId ? { ...updater(sale), updatedAt: new Date().toISOString() } : sale
    )))
  }

  const updateSaleField = (field, value) => updateSelectedSale((sale) => ({ ...sale, [field]: value }))
  const updateSaleItem = (itemId, field, value) => updateSelectedSale((sale) => ({
    ...sale,
    items: sale.items.map((item) => item.id === itemId ? { ...item, [field]: value } : item),
  }))
  const addSaleItem = () => updateSelectedSale((sale) => ({
    ...sale,
    items: [...sale.items, createItem(nextItemId(sale.items), { qty: 1, price: 0 })],
  }))
  const removeSaleItem = (itemId) => updateSelectedSale((sale) => ({
    ...sale,
    items: sale.items.length === 1 ? sale.items : sale.items.filter((item) => item.id !== itemId),
  }))

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
    if (!quoteItems.length || quoteItems.some((item) => (
      !item.name.trim()
      || item.qty === ''
      || Number(item.qty) <= 0
      || item.price === ''
      || Number(item.price) < 0
    ))) {
      window.alert('견적서를 만들려면 품명, 수량, 단가를 확인해주세요.')
      return
    }

    persistSales(sales)
    const existingQuote = savedQuotes.find((quote) => quote.id === sale.quoteId || quote.salesId === sale.id)
    if (existingQuote) {
      applyQuoteData(existingQuote)
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
        clientName: recipient || sale.clientName,
        recipientTitle,
        quoteDate: date,
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
          </nav>
        </div>
        {activeTab === 'quote'
          ? quoteToolbar
          : <div className="toolbar-actions"><button className="btn btn-white" onClick={openNewSale}>+ 새 영업건</button></div>}
      </header>

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
                      <thead><tr><th>등록일</th><th>상태</th><th>거래처</th><th>대표 품목</th><th>품목 수</th><th>견적 합계</th><th></th></tr></thead>
                      <tbody>
                        {filteredSales.map((sale) => {
                          const quoteItems = quoteItemsFromSale(sale)
                          const saleTotal = calculateTotals(quoteItems).total
                          const firstItem = quoteItems[0]?.name || '품목 미입력'
                          const status = SALE_STATUS[sale.status] || SALE_STATUS.draft
                          return (
                            <tr key={sale.id} onClick={() => openSale(sale.id)}>
                              <td>{formatShortDate(sale.saleDate)}</td>
                              <td><span className={`status-badge ${status.className}`}>{status.label}</span></td>
                              <td className="sales-client">{sale.clientName || '거래처 미입력'}</td>
                              <td>{firstItem}</td>
                              <td>{quoteItems.length}개</td>
                              <td className="amount">₩ {comma(saleTotal)}</td>
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
                    <label className="field field-wide"><span>배송비</span><div className="input-with-unit"><input type="number" min="0" value={selectedSale.shippingFee} onChange={(event) => updateSaleField('shippingFee', event.target.value)} placeholder="0" /><span>원</span></div></label>
                    <div className="shipping-options field-wide">
                      <label className="check-label"><input type="checkbox" checked={selectedSale.includeShipping} onChange={(event) => updateSaleField('includeShipping', event.target.checked)} />견적서에 배송비 품목으로 반영</label>
                      <label className="check-label"><input type="checkbox" checked={selectedSale.shippingVatIncluded} onChange={(event) => updateSaleField('shippingVatIncluded', event.target.checked)} disabled={!selectedSale.includeShipping} />배송비 VAT 포함</label>
                    </div>
                  </div>
                </section>
              </div>

              <section className="form-card items-card">
                <div className="form-card-heading">
                  <div><h2>품목</h2><p>이 목록이 견적서 품목으로 그대로 넘어갑니다.</p></div>
                  <button className="btn-light" onClick={addSaleItem}>+ 품목 추가</button>
                </div>
                <div className="sales-items-wrap">
                  <table className="sales-items-table">
                    <thead><tr><th>품명 <em>*</em></th><th>규격</th><th>옵션 / 비고</th><th>수량 <em>*</em></th><th>단가 <em>*</em></th><th>VAT</th><th></th></tr></thead>
                    <tbody>
                      {selectedSale.items.map((item) => (
                        <tr key={item.id}>
                          <td><input value={item.name} onChange={(event) => updateSaleItem(item.id, 'name', event.target.value)} placeholder="상품명" /></td>
                          <td><input value={item.spec} onChange={(event) => updateSaleItem(item.id, 'spec', event.target.value)} placeholder="EA" /></td>
                          <td><input value={item.note} onChange={(event) => updateSaleItem(item.id, 'note', event.target.value)} placeholder="옵션명 또는 비고" /></td>
                          <td><input className="number-input" type="number" min="0" value={item.qty} onChange={(event) => updateSaleItem(item.id, 'qty', event.target.value)} /></td>
                          <td><input className="number-input" type="number" min="0" value={item.price} onChange={(event) => updateSaleItem(item.id, 'price', event.target.value)} /></td>
                          <td><label className="vat-toggle"><input type="checkbox" checked={item.vatIncluded} onChange={(event) => updateSaleItem(item.id, 'vatIncluded', event.target.checked)} />포함</label></td>
                          <td><button className="icon-button" onClick={() => removeSaleItem(item.id)} aria-label="품목 삭제" disabled={selectedSale.items.length === 1}>×</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="sales-total-preview">견적 예상 합계 <strong>₩ {comma(calculateTotals(quoteItemsFromSale(selectedSale)).total)}</strong></div>
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
      ) : (
        <main className="page">
          {linkedSale && (
            <div className="linked-sale-banner no-print">
              <div><span>연결된 영업건</span><strong>{linkedSale.clientName || '거래처 미입력'}</strong><small>{SALE_STATUS[linkedSale.status]?.label || '작성중'}</small></div>
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
                    const supply = (Number(item.qty) || 0) * (Number(item.price) || 0)
                    const vat = item.vatIncluded ? 0 : Math.round(supply * 0.1)
                    return (
                      <tr key={item.id}>
                        <td className="center">{index + 1}</td>
                        <td><textarea className="editable item-name" data-autosize="true" value={item.name} onChange={(event) => updateItem(item.id, 'name', event.target.value)} placeholder="품명" rows={1} onInput={(event) => resizeTextArea(event.currentTarget)} /></td>
                        <td className="center"><input className="editable" value={item.spec} onChange={(event) => updateItem(item.id, 'spec', event.target.value)} /></td>
                        <td><input className="editable num" type="number" value={item.qty} onChange={(event) => updateItem(item.id, 'qty', event.target.value)} min="0" /></td>
                        <td><input className="editable num" type="number" value={item.price} onChange={(event) => updateItem(item.id, 'price', event.target.value)} min="0" /></td>
                        <td className="num">{comma(supply)}</td>
                        <td className="center"><label className="quote-vat"><input type="checkbox" checked={item.vatIncluded} onChange={(event) => updateItem(item.id, 'vatIncluded', event.target.checked)} />{item.vatIncluded ? 'VAT포함' : comma(vat)}</label></td>
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
