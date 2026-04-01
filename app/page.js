'use client'
import { useState, useCallback } from 'react'

const today = () => new Date().toISOString().slice(0, 10)
const comma = (n) => Math.round(Number(n) || 0).toLocaleString('ko-KR')

function toKorean(n) {
  const num = Math.round(Number(n) || 0)
  if (num === 0) return '금영원정'
  const units = ['', '만', '억', '조']
  const digits = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구']
  const pos = ['', '십', '백', '천']
  let result = ''
  let remaining = num
  let unitIdx = 0
  while (remaining > 0) {
    const chunk = remaining % 10000
    if (chunk > 0) {
      let chunkStr = ''
      let c = chunk
      for (let i = 0; i < 4; i++) {
        const d = c % 10
        if (d > 0) chunkStr = (d === 1 && i > 0 ? '' : digits[d]) + pos[i] + chunkStr
        c = Math.floor(c / 10)
      }
      result = chunkStr + units[unitIdx] + result
    }
    remaining = Math.floor(remaining / 10000)
    unitIdx++
  }
  return '금' + result + '원정'
}

const initItems = [
  { id: 1, name: '', spec: 'EA', qty: '', price: '', vatIncluded: false, note: '' },
]
const initNotes = [
  '본 견적서는 　　월 　　일에 진행된 발주에 대한 견적서입니다.',
  '본 견적서의 납기일정은 약 2-3주 정도 소요 됩니다.',
  '테이포프(주) 입금계좌: 035-102609-01-026 기업은행',
  '배송은 택배를 통해 발송되며, 택배사는 대한통운입니다.',
  '본 견적서는 발행일로부터 30일동안 유효합니다.',
  '대량건은 단순변심으로 환불이 어려우며, 불량품에 한하여 7일 이내 교환 및 환불 가능합니다.',
]

export default function QuotePage() {
  const [date, setDate] = useState(today())
  const [recipient, setRecipient] = useState('')
  const [recipientTitle, setRecipientTitle] = useState('대표이사 귀하')
  const [intro, setIntro] = useState('아래와 같이 납품 및 청구합니다.')
  const [items, setItems] = useState(initItems)
  const [notes, setNotes] = useState(initNotes)

  const [supplier, setSupplier] = useState({
    reg: '285-86-00885',
    name: '테이포프㈜',
    rep: '한상철',
    addr: '경기도 광주시 직동로8',
    biz: '도매 및 소매업',
    type: '전자상거래업',
    tel: '영업팀 (070-7525-7790)',
  })
  const updateSupplier = (field, val) => setSupplier(prev => ({ ...prev, [field]: val }))

  const totals = items.reduce((acc, item) => {
    const supply = (item.qty || 0) * (item.price || 0)
    const vat = item.vatIncluded ? 0 : Math.round(supply * 0.1)
    return { supply: acc.supply + supply, vat: acc.vat + vat, total: acc.total + supply + vat }
  }, { supply: 0, vat: 0, total: 0 })

  const updateItem = useCallback((id, field, value) => {
    setItems(prev => prev.map(item => item.id === id ? { ...item, [field]: value } : item))
  }, [])

  const addItem = () => {
    const newId = Math.max(...items.map(i => i.id), 0) + 1
    setItems(prev => [...prev, { id: newId, name: '', spec: 'EA', qty: 1, price: 0, vatIncluded: false, note: '' }])
  }

  const removeItem = (id) => {
    if (items.length === 1) return
    setItems(prev => prev.filter(item => item.id !== id))
  }

  const updateNote = (idx, val) => setNotes(prev => prev.map((n, i) => i === idx ? val : n))
  const addNote = () => setNotes(prev => [...prev, ''])
  const removeNote = (idx) => setNotes(prev => prev.filter((_, i) => i !== idx))

  return (
    <>
      <div className="toolbar">
        <div className="toolbar-logo">펀타스틱 견적서</div>
        <div className="toolbar-actions">
          <button className="btn" onClick={addItem}>+ 품목 추가</button>
          <button className="btn btn-white" onClick={() => window.print()}>🖨 인쇄 / PDF</button>
        </div>
      </div>

      <div className="page">
        <div className="quote-paper">
          <div className="quote-title">견 적 서</div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0', marginBottom: '1.25rem', border: '1px solid var(--border)' }}>
            <div style={{ borderRight: '1px solid var(--border)' }}>
              {[['날  짜','date'],['수  신','recipient'],['참  조','recipientTitle']].map(([label, field]) => (
                <div key={field} className="info-row" style={{ borderBottom: '1px solid var(--border)' }}>
                  <span className="info-label" style={{ minWidth: '64px' }}>{label}</span>
                  <div className="info-val">
                    {field === 'date'
                      ? <input type="date" value={date} onChange={e => setDate(e.target.value)} className="editable-inline" />
                      : field === 'recipient'
                      ? <input value={recipient} onChange={e => setRecipient(e.target.value)} className="editable-inline" placeholder="거래처명" />
                      : <input value={recipientTitle} onChange={e => setRecipientTitle(e.target.value)} className="editable-inline" placeholder="대표님 귀하" />
                    }
