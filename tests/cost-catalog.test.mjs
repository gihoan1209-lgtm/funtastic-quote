import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyCatalogItemToSaleItem,
  asCost,
  catalogItemsFromWorksheetRows,
  normalizeCatalogItem,
  resolveCatalogCost,
  searchCostCatalog,
} from '../lib/cost-catalog.mjs'

const headers = Array.from({ length: 19 }, () => '')
headers[0] = '품목코드'
headers[1] = '품목명'
headers[2] = '규격정보'
headers[9] = '특가(元)'
headers[10] = '신규원가(元)'
headers[13] = 'works 기존 원가'
headers[14] = 'works 신규 원가'
headers[15] = '품목구분'

const row = ({ code, name, spec = '', specialPriceYuan = '', newCostYuan = '', existingCost = '', newCost = '', category = '' }) => {
  const values = Array.from({ length: 19 }, () => '')
  values[0] = code
  values[1] = name
  values[2] = spec
  values[9] = specialPriceYuan
  values[10] = newCostYuan
  values[13] = existingCost
  values[14] = newCost
  values[15] = category
  return values
}

test('new works cost from O wins over existing works cost from N', () => {
  assert.deepEqual(resolveCatalogCost('1,608', 1500), { cost: 1608, costSource: 'works 신규 원가' })
  assert.deepEqual(resolveCatalogCost(0, 1500), { cost: 0, costSource: 'works 신규 원가' })
})

test('blank O falls back to N and invalid costs remain unknown', () => {
  assert.deepEqual(resolveCatalogCost('', 1500), { cost: 1500, costSource: 'works 기존 원가' })
  assert.deepEqual(resolveCatalogCost('원가 미입력', '2,500원'), { cost: 2500, costSource: 'works 기존 원가' })
  assert.deepEqual(resolveCatalogCost('', ''), { cost: null, costSource: '' })
  assert.equal(asCost('-1'), null)
})

test('keeps a partially typed decimal visible until the source-table edit is complete', () => {
  const item = normalizeCatalogItem({ id: 'manual-1', newCost: '1608.', existingCost: 1500 })
  assert.equal(item.newCost, '1608.')
  assert.equal(item.cost, 1500)
  assert.equal(item.costSource, 'works 기존 원가')
})

test('imports workbook rows while retaining code, name, spec, J/K yuan values, raw work costs, and applied cost', () => {
  const result = catalogItemsFromWorksheetRows([
    ['회사명 : 테이포프'],
    headers,
    row({ code: '00001', name: '에어캡포장', spec: '완충재', specialPriceYuan: 16.8, newCostYuan: 18.2, existingCost: 1500, newCost: 1608, category: '[부재료]' }),
    row({ code: '00002', name: '기존원가 품목', spec: 'EA', existingCost: 700, category: '[상품]' }),
    row({ code: '00003', name: '원가 미입력' }),
  ])

  assert.equal(result.headerRow, 2)
  assert.equal(result.items.length, 3)
  assert.deepEqual(result.items[0], {
    id: 'import-3-00001',
    productCode: '00001',
    name: '에어캡포장',
    spec: '완충재',
    category: '[부재료]',
    specialPriceYuan: '16.8',
    newCostYuan: '18.2',
    newCost: '1608',
    existingCost: '1500',
    cost: 1608,
    costSource: 'works 신규 원가',
    sourceRow: 3,
  })
  assert.equal(result.items[1].cost, 700)
  assert.equal(result.items[1].costSource, 'works 기존 원가')
  assert.equal(result.items[2].cost, null)
})

test('search matches code, name, spec and category with exact codes first', () => {
  const items = catalogItemsFromWorksheetRows([
    headers,
    row({ code: 'A-001', name: '수납 선반', spec: '소형', category: '[상품]' }),
    row({ code: '100450-0001', name: '심플 유럽식난간', spec: '소', category: '[상품]' }),
    row({ code: 'B-002', name: '수납 박스', spec: '대형', category: '[부재료]' }),
  ]).items

  assert.equal(searchCostCatalog(items, '100450-0001')[0].name, '심플 유럽식난간')
  assert.equal(searchCostCatalog(items, '수납').length, 2)
  assert.equal(searchCostCatalog(items, '대형')[0].productCode, 'B-002')
  assert.equal(searchCostCatalog(items, '부재료')[0].productCode, 'B-002')
})

test('selecting a catalog item takes a cost snapshot without touching sales quantity or selling price', () => {
  const saleItem = applyCatalogItemToSaleItem(
    { id: 4, qty: '8', price: '2300', wholesalePrice: '3000', note: '빨강', vatIncluded: true },
    { id: 'source-1', productCode: '00001', name: '에어캡포장', spec: 'EA', newCost: '', existingCost: 1608 },
  )

  assert.deepEqual(saleItem, {
    id: 4,
    qty: '8',
    price: '2300',
    wholesalePrice: '3000',
    note: '빨강',
    vatIncluded: true,
    productCode: '00001',
    name: '에어캡포장',
    spec: 'EA',
    cost: '1608',
    catalogItemId: 'source-1',
    catalogCostSource: 'works 기존 원가',
  })
})
