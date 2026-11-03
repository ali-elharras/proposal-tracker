/**
 * Smart defaults for the New client and New proposal forms: good first guesses so people type less.
 * Every guess is visible and editable, and nothing here is a rule: the server still checks every field.
 */

const SCHOOL = /\b(school|schools|academy|college|nursery|kindergarten|kg|lyc[eé]e|institute|university|montessori|preparatory|prep|stem)\b|مدرس|أكاديمي|حضان/i
const AGENCY = /\b(agency|agencies|events?|productions?|media|marketing|advertising|pr|communications|creative|studio)\b/i
const CORPORATE = /\b(company|co|group|holding|holdings|bank|pharma|pharmaceuticals?|telecom|fintech|logistics|corp|corporation|inc|ltd|llc|s\.?a\.?e|plc|industries|motors|insurance|consulting|solutions|systems|technologies|tech|foods?|developments?|properties|real estate|hotels?|resorts?)\b/i

/** The client type a name suggests ('school' · 'agency' · 'corporate'), or '' when the name says nothing. */
export function guessClientType(name) {
  const n = String(name ?? '').trim()
  if (n.length < 3) return ''
  if (SCHOOL.test(n)) return 'school'
  if (AGENCY.test(n)) return 'agency'
  if (CORPORATE.test(n)) return 'corporate'
  return ''
}

/** The brands a client type usually works with: schools with Grasshoppers, companies with Team Up, agencies both. */
export function brandsForType(type) {
  if (type === 'school') return ['grasshoppers']
  if (type === 'corporate') return ['teamup']
  if (type === 'agency') return ['grasshoppers', 'teamup']
  return []
}

const DAY = 86400000
const utc = (iso) => new Date(`${iso}T00:00:00Z`)
export const addDays = (iso, n) => new Date(utc(iso).getTime() + n * DAY).toISOString().slice(0, 10)

/**
 * The proposal deadline to start with: a week from today, but always before the event starts (the day
 * before it at the latest). '' when there is no room (the event is today or tomorrow) or the start is unknown.
 */
export function suggestedDeadline(eventStart, today, days = 7) {
  if (!today) return ''
  const week = addDays(today, days)
  if (!eventStart) return week
  if (eventStart <= today) return ''
  const latest = addDays(eventStart, -1)
  const pick = week < latest ? week : latest
  return pick >= today ? pick : ''
}

/** The occasion whose dates contain this day (Settings → Occasions), or null. occasions: [{ id, periods }] */
export function occasionFor(date, occasions = []) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date ?? ''))) return null
  return occasions.find((o) => (o.periods ?? []).some((p) => p.startsOn <= date && date <= p.endsOn)) ?? null
}

/** Quick tags whose name appears in the brief ("…with transport and catering" → Transport, Catering). */
export function tagsFromBrief(brief, tags = []) {
  const text = ` ${String(brief ?? '').toLowerCase()} `
  return tags.filter((t) => {
    const word = String(t.label ?? '').toLowerCase().trim()
    return word.length >= 3 && new RegExp(`[^\\p{L}]${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'u').test(text)
  }).map((t) => t.code)
}

/** A typed Egyptian mobile in one readable form (+20 10 1234 5678); anything else is left as typed. */
export function tidyPhone(phone) {
  const raw = String(phone ?? '').trim()
  let d = raw.replace(/\D+/g, '')
  if (d.startsWith('0020')) d = d.slice(4)
  else if (d.startsWith('20') && d.length === 12) d = d.slice(2)
  if (d.startsWith('0')) d = d.slice(1)
  if (/^1[0125]\d{8}$/.test(d)) return `+20 ${d.slice(0, 2)} ${d.slice(2, 6)} ${d.slice(6)}`
  return raw
}
