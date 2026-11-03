import { useCallback, useEffect, useId, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import useDismiss from '../../lib/useDismiss.js'

/**
 * The one filter kit every list uses:
 *   <FilterBar count="12 requests" onClear={…} active={2}> <SearchBox/> <FilterMenu/> … </FilterBar>
 * A FilterMenu is a pill ("Brand: Team Up ▾") that opens a short list: one choice, or several (multiple).
 * It is highlighted while it filters something and clears with one click. Search waits for a pause in typing.
 */

/** Search with an icon and a clear button; onChange fires after a short pause (and at once on clear / Enter). */
export function SearchBox({ value, onChange, placeholder = 'Search', label = 'Search', delay = 250 }) {
  const [text, setText] = useState(value ?? '')
  const timer = useRef(null)
  const last = useRef(value ?? '')
  useEffect(() => { // the URL changed elsewhere (a link, Clear all): show it
    if ((value ?? '') !== last.current) { last.current = value ?? ''; setText(value ?? '') }
  }, [value])
  const send = useCallback((v) => {
    clearTimeout(timer.current)
    last.current = v
    onChange(v)
  }, [onChange])
  useEffect(() => () => clearTimeout(timer.current), [])
  return (
    <label className="search-box">
      <Icon name="search" size={16} className="search-box__icon" />
      <span className="sr-only">{label}</span>
      <input type="search" value={text} placeholder={placeholder}
        onChange={(e) => {
          const v = e.target.value
          setText(v)
          clearTimeout(timer.current)
          timer.current = setTimeout(() => send(v), delay)
        }}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); send(text) } }} />
      {text && (
        <button type="button" className="search-box__clear" aria-label="Clear search" onClick={() => { setText(''); send('') }}>
          <Icon name="x" size={14} strokeWidth={2.25} />
        </button>
      )}
    </label>
  )
}

/**
 * A filter pill with its list. options: [{ value, label, hint? }]. Single: value is a string ('' = any).
 * multiple: value is an array. anyLabel: what "no filter" reads as ("All brands"). The pill reads
 * "Label: Choice" (or "Label: 2 chosen") when filtering, else just the label.
 */
export function FilterMenu({ label, options, value, onChange, multiple = false, anyLabel = 'Any', icon = null, align = 'start', clearable = true }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const listId = useId()
  const close = useCallback(() => setOpen(false), [])
  useDismiss(ref, open, close)
  const chosen = multiple ? (value ?? []) : (value ? [value] : [])
  const active = chosen.length > 0
  const names = chosen.map((v) => options.find((o) => o.value === v)?.label ?? v)
  const shown = !active ? label : names.length === 1 ? `${label}: ${names[0]}` : `${label}: ${names.length} chosen`
  const pick = (v) => {
    if (multiple) onChange(chosen.includes(v) ? chosen.filter((x) => x !== v) : [...chosen, v])
    else { onChange(v === value ? '' : v); setOpen(false) }
  }
  return (
    <div className="filter-menu" ref={ref}>
      {/* A setting that always has a value (Sort, Group) never looks like an active filter. */}
      <button type="button" className={`filter-pill${active && clearable ? ' is-active' : ''}${clearable ? '' : ' filter-pill--setting'}`}
        aria-haspopup="listbox" aria-expanded={open}
        aria-controls={listId} onClick={() => setOpen((o) => !o)} title={active ? names.join(', ') : undefined}>
        {icon && <Icon name={icon} size={14} />}
        <span className="filter-pill__text">{shown}</span>
        <Icon name="chevronDown" size={14} className="filter-pill__chevron" />
      </button>
      {active && clearable && (
        <button type="button" className="filter-pill__x" aria-label={`Clear ${label}`} onClick={() => onChange(multiple ? [] : '')}>
          <Icon name="x" size={12} strokeWidth={2.5} />
        </button>
      )}
      {open && (
        <div className={`popover filter-menu__panel${align === 'end' ? '' : ' popover--start'}`}>
          <ul id={listId} role="listbox" aria-multiselectable={multiple || undefined} aria-label={label} className="filter-menu__list">
            {!multiple && clearable && (
              <li>
                <button type="button" role="option" aria-selected={!active} className={`filter-menu__option${!active ? ' is-selected' : ''}`}
                  onClick={() => { onChange(''); setOpen(false) }}>
                  <span className="filter-menu__mark">{!active && <Icon name="checkmark" size={14} strokeWidth={2.5} />}</span>
                  {anyLabel}
                </button>
              </li>
            )}
            {options.map((o) => {
              const on = chosen.includes(o.value)
              return (
                <li key={o.value}>
                  <button type="button" role="option" aria-selected={on} className={`filter-menu__option${on ? ' is-selected' : ''}`}
                    onClick={() => pick(o.value)}>
                    <span className={`filter-menu__mark${multiple ? ' filter-menu__mark--box' : ''}`}>
                      {on && <Icon name="checkmark" size={14} strokeWidth={2.5} />}
                    </span>
                    <span className="filter-menu__label">{o.label}</span>
                    {o.hint !== undefined && <span className="filter-menu__hint tabular">{o.hint}</span>}
                  </button>
                </li>
              )
            })}
          </ul>
          {multiple && active && (
            <div className="filter-menu__foot">
              <button type="button" className="link-btn" onClick={() => onChange([])}>Clear</button>
              <button type="button" className="btn btn--sm btn--primary" onClick={() => setOpen(false)}>Done</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** An on / off pill ("4★ and up", "Waiting on me"). */
export function FilterToggle({ label, on, onChange, icon = null }) {
  return (
    <button type="button" aria-pressed={on} className={`filter-pill${on ? ' is-active' : ''}`} onClick={() => onChange(!on)}>
      {icon && <Icon name={icon} size={14} />}
      <span className="filter-pill__text">{label}</span>
    </button>
  )
}

/**
 * The row: search and pills on the left; the result count, Clear all (when anything filters) and any
 * extra controls (sort, view) on the right.
 */
export function FilterBar({ children, end = null, count = null, active = 0, onClear }) {
  const [open, setOpen] = useState(false) // phones: the pills fold behind one "Filters" button
  return (
    <div className={`filter-bar${open ? ' is-open' : ''}`} role="search">
      <button type="button" className={`filter-pill filter-bar__toggle${active ? ' is-active' : ''}`} aria-expanded={open}
        onClick={() => setOpen((o) => !o)}>
        <Icon name="filter" size={14} /><span className="filter-pill__text">Filters{active ? ` (${active})` : ''}</span>
        <Icon name="chevronDown" size={14} className="filter-pill__chevron" />
      </button>
      <div className="filter-bar__main">{children}</div>
      <div className="filter-bar__end">
        {count !== null && <span className="filter-bar__count" role="status">{count}</span>}
        {active > 0 && onClear && <button type="button" className="link-btn" onClick={onClear}>Clear all ({active})</button>}
        {end}
      </div>
    </div>
  )
}
