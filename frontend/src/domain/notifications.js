/**
 * Notifications about the same page (the same proposal or event) become one line: the latest one, and
 * "+2 more updates". Newest group first. -> [{ key, latest, items, unread }]
 */
export function groupNotifications(items) {
  const groups = new Map()
  for (const n of items) {
    const key = n.link ?? `n${n.id}`
    if (!groups.has(key)) groups.set(key, { key, latest: n, items: [], unread: 0 })
    const g = groups.get(key)
    g.items.push(n)
    if (!n.readAt) g.unread += 1
  }
  return [...groups.values()]
}
