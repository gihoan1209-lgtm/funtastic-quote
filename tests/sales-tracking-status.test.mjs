import assert from 'node:assert/strict'
import test from 'node:test'

import { saleStatusFromTracking, withTrackingSaleStatus } from '../lib/sales-tracking-status.mjs'

test('tracking starts pending until either shipment or payment is completed', () => {
  assert.equal(saleStatusFromTracking({}), 'pending')
  assert.equal(saleStatusFromTracking({
    shipments: [{ status: 'before' }],
    payments: [{ status: 'before' }],
  }), 'pending')
})

test('one completed shipment or payment advances tracking to in progress', () => {
  assert.equal(saleStatusFromTracking({
    shipments: [{ status: 'completed' }],
    payments: [{ status: 'before' }],
  }), 'inProgress')
  assert.equal(saleStatusFromTracking({
    shipments: [{ status: 'before' }],
    payments: [{ status: 'completed' }],
  }), 'inProgress')
})

test('multiple tracking rows complete only when every shipment and payment is completed', () => {
  const partialSale = {
    shipments: [{ status: 'completed' }, { status: 'before' }],
    payments: [{ status: 'completed' }, { status: 'completed' }],
  }
  assert.equal(saleStatusFromTracking(partialSale), 'inProgress')

  const completedSale = {
    ...partialSale,
    shipments: [{ status: 'completed' }, { status: 'completed' }],
  }
  assert.equal(saleStatusFromTracking(completedSale), 'completed')
  assert.deepEqual(withTrackingSaleStatus({ ...completedSale, status: 'blocked' }), {
    ...completedSale,
    status: 'completed',
  })
})

test('reverting all tracking rows to before returns the sale to pending', () => {
  assert.equal(saleStatusFromTracking({
    shipments: [{ status: 'before' }, { status: 'before' }],
    payments: [{ status: 'before' }],
  }), 'pending')
})
