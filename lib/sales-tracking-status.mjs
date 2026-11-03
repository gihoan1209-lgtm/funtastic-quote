const trackingRows = (rows) => (
  Array.isArray(rows) && rows.length ? rows : [{ status: 'before' }]
)

/**
 * Derive the operational sale status from shipment and payment progress.
 * Empty legacy tracking groups are treated as one outstanding row, never complete.
 */
export function saleStatusFromTracking(sale = {}) {
  const rows = [...trackingRows(sale?.shipments), ...trackingRows(sale?.payments)]
  if (rows.every((row) => row?.status === 'completed')) return 'completed'
  if (rows.some((row) => row?.status === 'completed')) return 'inProgress'
  return 'pending'
}

export function withTrackingSaleStatus(sale = {}) {
  return { ...sale, status: saleStatusFromTracking(sale) }
}
