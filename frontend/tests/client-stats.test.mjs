// Client at a glance (client page strip, Clients list columns). Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { clientStats, statsByClient } from '../src/domain/clientStats.js'

const r = (id, status, extra = {}) => ({ id, clientId: 'CL-1', status, brand: 'teamup', service: 'team_building',
  eventDatePrecision: 'day', lastUpdated: '2026-10-01T10:00:00Z', ...extra })

test('counts, win rate, confirmed value, next and last event, last activity', () => {
  const s = clientStats([
    r('PR-1', 'accepted', { eventDate: '2026-06-01', finalPrice: 100000, amPrice: 90000 }),
    r('PR-2', 'accepted', { eventDate: '2026-12-10', amPrice: 50000, lastUpdated: '2026-11-20T09:00:00Z' }),
    r('PR-3', 'rejected'),
    r('PR-4', 'in_progress'),
    r('PR-5', 'draft'), // a draft is not counted
  ], '2026-11-22')
  const { nextEventRequest, lastEventRequest, ...rest } = s
  assert.deepEqual(rest, {
    total: 4, open: 1, won: 2, lost: 1, winRate: 67, confirmedValue: 150000,
    nextEvent: '2026-12-10', lastEvent: '2026-06-01', lastActivity: '2026-11-20T09:00:00Z',
  })
  assert.equal(nextEventRequest.id, 'PR-2')
  assert.equal(lastEventRequest.id, 'PR-1')
})

test('nothing decided yet, no prices seen: null rather than 0', () => {
  const s = clientStats([r('PR-1', 'shared_with_client'), r('PR-2', 'accepted', { eventDate: '2026-01-01' })], '2026-11-22')
  assert.equal(s.confirmedValue, null) // no price on the confirmed one (or this viewer sees none)
  assert.equal(s.winRate, 100)
  assert.equal(clientStats([r('PR-1', 'in_progress')], '2026-11-22').winRate, null)
})

test('statsByClient groups the list by client', () => {
  const all = statsByClient([r('PR-1', 'accepted'), { ...r('PR-2', 'rejected'), clientId: 'CL-2' }], '2026-11-22')
  assert.deepEqual(Object.keys(all).sort(), ['CL-1', 'CL-2'])
  assert.equal(all['CL-1'].won, 1)
  assert.equal(all['CL-2'].lost, 1)
})

test('Export to Excel: proposals with something in the period, one row each, Excel-friendly', async () => {
  const { proposalsCsv } = await import('../src/domain/scorecard.js')
  const reqs = [
    { id: 'PR-1', clientId: 'CL-1', status: 'accepted', brand: 'teamup', service: 'team_building', bdOwner: 'u-a', assignedAM: 'u-b',
      submittedAt: '2026-11-10T09:00:00Z', eventDate: '2026-12-01', participants: 40, amPrice: 1000, finalPrice: 1200,
      statusHistory: [{ status: 'accepted', changedAt: '2026-11-12T09:00:00Z' }], eventName: 'Gala "night"' },
    { id: 'PR-2', clientId: 'CL-1', status: 'in_progress', brand: 'teamup', service: 'team_building', submittedAt: '2024-01-01T09:00:00Z', statusHistory: [] },
  ]
  const csv = proposalsCsv(reqs, 'year', '2026-11-22', {
    clientName: () => 'Acme', userName: (id) => id, statusLabel: (s) => s, serviceName: () => 'Team building', brandName: () => 'Team Up',
  })
  assert.ok(csv.startsWith('﻿"ID","Client"'))
  const lines = csv.slice(1).split('\r\n')
  assert.equal(lines.length, 2) // the header and PR-1 (PR-2 has nothing this year)
  assert.ok(lines[1].includes('"Gala ""night"""') && lines[1].includes('"1200"'))
})

test('the bell groups updates about the same page, newest group first', async () => {
  const { groupNotifications } = await import('../src/domain/notifications.js')
  const g = groupNotifications([
    { id: 3, link: '/proposals/PR-1', readAt: null }, { id: 2, link: '/events/PR-2', readAt: 'x' }, { id: 1, link: '/proposals/PR-1', readAt: 'x' },
  ])
  assert.deepEqual(g.map((x) => [x.key, x.items.length, x.unread]), [['/proposals/PR-1', 2, 1], ['/events/PR-2', 1, 0]])
})
