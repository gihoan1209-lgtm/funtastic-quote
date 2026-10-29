import assert from 'node:assert/strict'
import test from 'node:test'

import {
  formatGroupedNumber,
  isNonNegativeInput,
  normalizePastedNumber,
  parseNumericClipboardRow,
} from '../lib/numeric-input.mjs'

test('normalizes Excel-formatted non-negative amounts for numeric inputs', () => {
  assert.equal(normalizePastedNumber('1,234'), '1234')
  assert.equal(normalizePastedNumber('₩ 1,234'), '1234')
  assert.equal(normalizePastedNumber('￦\u00a01,234.50원'), '1234.50')
  assert.equal(normalizePastedNumber('\r\n 0. \t'), '0.')
  assert.equal(formatGroupedNumber('1234.50'), '1,234.50')
})

test('keeps valid empty values but rejects invalid or negative pasted numbers', () => {
  assert.equal(normalizePastedNumber(''), '')
  assert.equal(normalizePastedNumber('-1'), null)
  assert.equal(normalizePastedNumber('가격 미정'), null)
  assert.equal(isNonNegativeInput('0.'), true)
  assert.equal(isNonNegativeInput('-1'), false)
})

test('parses one horizontal Excel row without joining multiple cells', () => {
  assert.deepEqual(parseNumericClipboardRow('₩ 8,000\t7,000원'), ['8000', '7000'])
  assert.deepEqual(parseNumericClipboardRow('1,000\t\t3,000'), ['1000', '', '3000'])
  assert.deepEqual(parseNumericClipboardRow('\t7,000'), ['', '7000'])
  assert.deepEqual(parseNumericClipboardRow('10,000\r\n'), ['10000'])
  assert.equal(parseNumericClipboardRow('1,000\t2,000\r\n3,000\t4,000'), null)
  assert.equal(parseNumericClipboardRow('1,000\t미정'), null)
})
