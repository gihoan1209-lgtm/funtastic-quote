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

  // 공급자 정보 (수정 가능)
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

  // 계산
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

  const handlePrint = () => window.print()

  return (
    <>
      <div className="toolbar">
        <div className="toolbar-logo">펀타스틱 견적서</div>
        <div className="toolbar-actions">
          <button className="btn" onClick={addItem}>+ 품목 추가</button>
          <button className="btn btn-white" onClick={handlePrint}>🖨 인쇄 / PDF</button>
        </div>
      </div>

      <div className="page">
        <div className="quote-paper">
          <div className="quote-title">견 적 서</div>

          {/* 날짜 + 수신 + 공급자 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '0', marginBottom: '1.25rem', border: '1px solid var(--border)' }}>

            {/* 왼쪽: 수신정보 */}
            <div style={{ borderRight: '1px solid var(--border)' }}>
              {[
                ['날  짜', 'date'],
                ['수  신', 'recipient'],
                ['참  조', 'recipientTitle'],
              ].map(([label, field]) => (
                <div key={field} className="info-row" style={{ borderBottom: '1px solid var(--border)' }}>
                  <span className="info-label" style={{ minWidth: '64px' }}>{label}</span>
                  <div className="info-val">
                    {field === 'date'
                      ? <input type="date" value={date} onChange={e => setDate(e.target.value)} className="editable-inline" />
                      : field === 'recipient'
                      ? <input value={recipient} onChange={e => setRecipient(e.target.value)} className="editable-inline" placeholder="거래처명" />
                      : <input value={recipientTitle} onChange={e => setRecipientTitle(e.target.value)} className="editable-inline" placeholder="대표님 귀하" />
                    }
                  </div>
                </div>
              ))}
              <div style={{ padding: '8px 12px', fontSize: '13px', color: 'var(--text2)' }}>
                <input value={intro} onChange={e => setIntro(e.target.value)} className="editable-inline" style={{ width: '100%', color: 'var(--text2)' }} />
              </div>
              <div style={{ minHeight: '20px' }} />
            </div>

            {/* 오른쪽: 공급자 */}
            <div style={{ display: 'flex' }}>
              {/* 세로 "공급자" 텍스트 */}
              <div style={{ background: '#1a1a1a', color: '#fff', writingMode: 'vertical-lr', textOrientation: 'upright', fontSize: '13px', fontWeight: 600, letterSpacing: '0.2em', padding: '12px 6px', display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: '28px' }}>
                공급자
              </div>
              <div style={{ flex: 1, borderLeft: '1px solid var(--border)' }}>
                {/* 등록번호 */}
                <div className="info-row" style={{ borderBottom: '1px solid var(--border)' }}>
                  <span className="info-label" style={{ minWidth: '64px' }}>등록번호</span>
                  <div className="info-val">
                    <input className="editable-inline" value={supplier.reg} onChange={e => updateSupplier('reg', e.target.value)} style={{ fontSize: '12px', width: '100%', textAlign: 'center' }} />
                  </div>
                </div>
                {/* 상호 + 성명 */}
                <div className="info-row" style={{ borderBottom: '1px solid var(--border)' }}>
                  <span className="info-label" style={{ minWidth: '40px' }}>상&nbsp;&nbsp;호</span>
                  <div className="info-val" style={{ flex: 1 }}>
                    <input className="editable-inline" value={supplier.name} onChange={e => updateSupplier('name', e.target.value)} style={{ fontSize: '12px', width: '100%' }} />
                  </div>
                  <span className="info-label" style={{ minWidth: '40px', borderLeft: '1px solid var(--border)' }}>성&nbsp;&nbsp;명</span>
                  <div className="info-val" style={{ flex: 1 }}>
                    <input className="editable-inline" value={supplier.rep} onChange={e => updateSupplier('rep', e.target.value)} style={{ fontSize: '12px', width: '100%' }} />
                  </div>
                </div>
                {/* 사업장 주소 */}
                <div className="info-row" style={{ borderBottom: '1px solid var(--border)' }}>
                  <span className="info-label" style={{ minWidth: '64px' }}>사업장 주소</span>
                  <div className="info-val">
                    <input className="editable-inline" value={supplier.addr} onChange={e => updateSupplier('addr', e.target.value)} style={{ fontSize: '12px', width: '100%' }} />
                  </div>
                </div>
                {/* 업태 + 종목 */}
                <div className="info-row" style={{ borderBottom: '1px solid var(--border)' }}>
                  <span className="info-label" style={{ minWidth: '40px' }}>업&nbsp;&nbsp;태</span>
                  <div className="info-val" style={{ flex: 1 }}>
                    <input className="editable-inline" value={supplier.biz} onChange={e => updateSupplier('biz', e.target.value)} style={{ fontSize: '12px', width: '100%' }} />
                  </div>
                  <span className="info-label" style={{ minWidth: '40px', borderLeft: '1px solid var(--border)' }}>종&nbsp;&nbsp;목</span>
                  <div className="info-val" style={{ flex: 1 }}>
                    <input className="editable-inline" value={supplier.type} onChange={e => updateSupplier('type', e.target.value)} style={{ fontSize: '12px', width: '100%' }} />
                  </div>
                </div>
                {/* 전화번호 */}
                <div className="info-row">
                  <span className="info-label" style={{ minWidth: '64px' }}>전화번호</span>
                  <div className="info-val">
                    <input className="editable-inline" value={supplier.tel} onChange={e => updateSupplier('tel', e.target.value)} style={{ fontSize: '12px', width: '100%' }} />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 합계금액 */}
          <div className="total-box">
            <div className="total-label">합계금액<br /><span style={{ fontSize: '11px' }}>(공급가액+세액)</span></div>
            <div style={{ flex: 1 }}>
              <div className="total-amount">₩ {comma(totals.total)}</div>
              <div style={{ fontSize: '13px', color: 'var(--text2)', marginTop: '2px' }}>{toKorean(totals.total)}</div>
            </div>
          </div>

          {/* 품목 액션 */}
          <div className="action-row no-print">
            <button className="btn-light" onClick={addItem}>+ 품목 추가</button>
          </div>

          {/* 품목 테이블 */}
          <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <table className="items-table">
            <thead>
              <tr>
                <th style={{ width: '36px' }}>No.</th>
                <th>품명</th>
                <th style={{ width: '60px' }}>규격</th>
                <th style={{ width: '60px' }}>수량</th>
                <th style={{ width: '90px' }}>단가</th>
                <th style={{ width: '100px' }}>공급가액</th>
                <th style={{ width: '90px' }}>세액</th>
                <th style={{ width: '70px' }}>비고</th>
                <th style={{ width: '36px' }} className="no-print"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => {
                const supply = (item.qty || 0) * (item.price || 0)
                const vat = item.vatIncluded ? 0 : Math.round(supply * 0.1)
                return (
                  <tr key={item.id}>
                    <td className="center">{idx + 1}</td>
                    <td>
                      <textarea className="editable" value={item.name} onChange={e => updateItem(item.id, 'name', e.target.value)} placeholder="품명" rows={1} style={{ resize: 'none', overflow: 'hidden', lineHeight: '1.4', minHeight: '26px' }}
                        onInput={e => { e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px' }} />
                    </td>
                    <td className="center">
                      <input className="editable" value={item.spec} onChange={e => updateItem(item.id, 'spec', e.target.value)} style={{ textAlign: 'center' }} />
                    </td>
                    <td>
                      <input className="editable num" type="number" value={item.qty} onChange={e => updateItem(item.id, 'qty', e.target.value)} min="0" />
                    </td>
                    <td>
                      <input className="editable num" type="number" value={item.price} onChange={e => updateItem(item.id, 'price', e.target.value)} min="0" />
                    </td>
                    <td className="num">{comma(supply)}</td>
                    <td className="center">
                      <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', cursor: 'pointer', justifyContent: 'center' }}>
                        <input type="checkbox" checked={item.vatIncluded} onChange={e => updateItem(item.id, 'vatIncluded', e.target.checked)} />
                        {item.vatIncluded ? 'VAT포함' : comma(vat)}
                      </label>
                    </td>
                    <td>
                      <input className="editable" value={item.note} onChange={e => updateItem(item.id, 'note', e.target.value)} placeholder="" />
                    </td>
                    <td className="center no-print">
                      <button className="btn-light btn-del" onClick={() => removeItem(item.id)} style={{ padding: '2px 7px', fontSize: '12px' }}>✕</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5} className="center">합&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;계</td>
                <td className="num">{comma(totals.supply)}</td>
                <td className="num">{comma(totals.vat)}</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          </table>
          </div>

          {/* 비고 */}
          <div className="notes">
            {notes.map((note, idx) => (
              <div key={idx} className="note-item">
                <span className="note-prefix">※</span>
                <textarea className="note-text" value={note} onChange={e => updateNote(idx, e.target.value)} rows={1} />
                <button className="btn-light btn-del no-print" onClick={() => removeNote(idx)} style={{ padding: '2px 7px', fontSize: '11px' }}>✕</button>
              </div>
            ))}
            <button className="btn-light no-print" onClick={addNote} style={{ marginTop: '6px', fontSize: '12px' }}>+ 비고 추가</button>
          </div>
        </div>
      </div>
    </>
  )
}
