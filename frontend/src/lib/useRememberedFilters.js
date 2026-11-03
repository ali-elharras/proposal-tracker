import { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * A list remembers its filters on this computer: opening it with no filters in the address (from the
 * menu) brings back the last ones, shown as highlighted pills with "Clear all". A link that carries its
 * own filters (a dashboard card, a bookmark) always wins. key: one per page and person; skip: keys never kept.
 */
export default function useRememberedFilters(key, skip = ['page', 'peek', 'past']) {
  const [params, setParams] = useSearchParams()
  const restored = useRef(false)
  useEffect(() => {
    if (restored.current) return
    restored.current = true
    if ([...params.keys()].length > 0) return
    try {
      const saved = window.localStorage.getItem(key)
      if (saved) setParams(new URLSearchParams(saved), { replace: true })
    } catch { /* nothing remembered */ }
  }, [key, params, setParams])
  useEffect(() => {
    if (!restored.current) return
    const keep = new URLSearchParams(params)
    for (const k of skip) keep.delete(k)
    try {
      if ([...keep.keys()].length) window.localStorage.setItem(key, keep.toString())
      else window.localStorage.removeItem(key)
    } catch { /* not remembered */ }
  }, [key, params, skip])
}
