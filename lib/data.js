/**
 * Stock Watch data layer.
 *
 * Everything that talks to the public quote feed lives here so the Web route
 * and the agent tool share one implementation. The upstream is the public
 * Eastmoney quote endpoint: one JSON request answers a whole watchlist for
 * Shanghai/Shenzhen, Hong Kong, US and index symbols, and a second endpoint
 * returns today's minute series for one symbol.
 */

/** Batch quote endpoint accepting a comma-separated secid list. */
const QUOTE_ENDPOINT = 'https://push2.eastmoney.com/api/qt/ulist.np/get'
/** Intraday minute endpoint for a single secid. */
const TREND_ENDPOINT = 'https://push2.eastmoney.com/api/qt/stock/trends2/get'
/** Symbol suggest endpoint behind the quote site's own search box. */
const SUGGEST_ENDPOINT = 'https://searchapi.eastmoney.com/api/suggest/get'
/** Public suggest token the quote site ships to every visitor. */
const SUGGEST_TOKEN = 'D43BF722C8E33BDC906FB84D85E326E8'
/** Upstream markets a symbol may belong to; anything else cannot be quoted here. */
const SEARCHABLE_MARKETS = new Set([0, 1, 100, 105, 106, 107, 116])
/** Security kinds worth listing: mainland A/B shares (incl. Beijing), Hong Kong, US, indices. */
const SEARCHABLE_KINDS = new Set(['沪A', '深A', '京A', '港股', '美股', '指数', '沪B', '深B'])
/** Preview order: mainland first, then Hong Kong, then the US, then indices. */
const MARKET_RANK = { 0: 0, 1: 0, 116: 1, 105: 2, 106: 2, 107: 2, 100: 3 }
/** Fields requested for every quote row (see mapQuote for their meaning). */
const QUOTE_FIELDS = 'f2,f3,f4,f5,f6,f12,f13,f14,f15,f16,f17,f18,f124'
/** Upstream treats requests without a browser-shaped identity as anonymous; these keep it stable. */
const UPSTREAM_HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  referer: 'https://quote.eastmoney.com/',
  accept: 'application/json, text/plain, */*',
}
/** Upper bound on one watchlist request. */
export const MAX_SYMBOLS = 20
/** Upper bound on one symbol search result. */
export const MAX_SEARCH_RESULTS = 8
/** Upstream payloads are shared by concurrent readers for this long. */
const QUOTE_CACHE_TTL_MS = 1500

/** Raised when the upstream feed itself cannot answer (as opposed to an unknown symbol). */
export class QuoteFeedError extends Error {
  /**
   * @param message - human readable reason.
   * @param code - stable machine code used by the route's JSON body.
   * @param options - optional cause chaining.
   */
  constructor(message, code = 'UPSTREAM_ERROR', options) {
    super(message, options)
    this.name = 'QuoteFeedError'
    this.code = code
  }
}

/** Market prefix of the resolved secid, keyed by upstream market id. */
const MARKET_LABELS = {
  0: 'SZ',
  1: 'SH',
  100: 'IDX',
  105: 'US',
  106: 'US',
  107: 'US',
  116: 'HK',
}

/** Hong Kong index aliases, which upstream identifies by name rather than a numeric code. */
const HK_INDEX_ALIASES = { hsi: '100.HSI', hstech: '100.HSTECH', hscei: '100.HSCEI' }

/** Memory of which market a resolved key belongs to, so a US ticker is probed once. */
const resolvedSecids = new Map()

/** Recently fetched upstream rows keyed by their joined secid request. */
const quoteCache = new Map()

/** Convert an upstream scalar (number or numeric string, `-` when unavailable) to a number or null. */
function finiteOrNull(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    const text = value.trim()
    if (text === '' || text === '-') return null
    const parsed = Number(text)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/**
 * Name the exchange a quote row belongs to. Beijing shares share market id 0
 * with Shenzhen, so the code prefix decides between them.
 * @param market - upstream market id (`f13`).
 * @param code - the security code (`f12`).
 * @returns SH / SZ / BJ / HK / US / IDX / OTHER.
 */
function marketLabel(market, code) {
  if (market === 0 && /^(92|89|83|87|43)/.test(code)) return 'BJ'
  return MARKET_LABELS[market] ?? 'OTHER'
}

/**
 * Parse one user- or config-supplied symbol into a display key plus the secids
 * worth trying, in order. US tickers are the only ambiguous case: upstream
 * assigns NASDAQ/NYSE/AMEX different market ids, so the reader probes them.
 * @param raw - symbol such as `sh600519`, `600519`, `hk00700`, `us:AAPL`, `105.AAPL`, `AAPL`.
 * @returns the key and candidate secids, or null when the text is not a symbol.
 */
export function parseSymbol(raw) {
  if (typeof raw !== 'string') return null
  const text = raw.trim()
  if (text === '') return null
  const rawSecid = /^(\d{1,3})\.([A-Za-z0-9]{1,12})$/.exec(text)
  if (rawSecid !== null) {
    const key = `${rawSecid[1]}.${rawSecid[2].toUpperCase()}`
    return { key, candidates: [key] }
  }
  const lower = text.toLowerCase()
  const exchange = /^(sh|sz|bj)(\d{6})$/.exec(lower)
  if (exchange !== null) {
    const market = exchange[1] === 'sh' ? '1' : '0'
    return { key: `${exchange[1]}${exchange[2]}`, candidates: [`${market}.${exchange[2]}`] }
  }
  if (/^\d{6}$/.test(text)) {
    // Mainland boards: 60/68/9xx (B shares 900) are Shanghai, 00/30 Shenzhen,
    // 92/83/87/43 Beijing (Beijing moved to the 920xxx range, which a plain
    // leading-9 rule would otherwise read as Shanghai).
    const beijing = /^(92|89|83|87|43)/.test(text)
    const shanghai = !beijing && /^[695]/.test(text)
    const market = shanghai ? '1' : '0'
    const exchange = beijing ? 'bj' : shanghai ? 'sh' : 'sz'
    return { key: `${exchange}${text}`, candidates: [`${market}.${text}`] }
  }
  const hkIndex = /^hk([a-z]{2,8})$/.exec(lower)
  if (hkIndex !== null) {
    const alias = HK_INDEX_ALIASES[hkIndex[1]]
    if (alias !== undefined) return { key: `hk${hkIndex[1].toUpperCase()}`, candidates: [alias] }
    return null
  }
  const hkStock = /^hk(\d{5})$/.exec(lower)
  if (hkStock !== null) return { key: `hk${hkStock[1]}`, candidates: [`116.${hkStock[1]}`] }
  if (/^\d{5}$/.test(text)) return { key: `hk${text}`, candidates: [`116.${text}`] }
  const usPrefixed = /^us[:\s]?([A-Za-z][A-Za-z0-9.]{0,9})$/.exec(text)
  if (usPrefixed !== null) {
    const ticker = usPrefixed[1].toUpperCase()
    return { key: `us:${ticker}`, candidates: ['105', '106', '107'].map(market => `${market}.${ticker}`) }
  }
  if (/^[A-Za-z][A-Za-z0-9.]{0,9}$/.test(text)) {
    const ticker = text.toUpperCase()
    return { key: `us:${ticker}`, candidates: ['105', '106', '107'].map(market => `${market}.${ticker}`) }
  }
  return null
}

/**
 * Parse and de-duplicate a requested symbol list while bounding its size.
 * @param symbols - raw symbol texts, in display order.
 * @returns accepted entries plus one rejection per unusable input.
 */
export function parseSymbols(symbols) {
  const accepted = []
  const rejected = []
  const seen = new Set()
  for (const raw of symbols) {
    const parsed = parseSymbol(raw)
    if (parsed === null) {
      rejected.push({ key: String(raw), reason: 'UNKNOWN_SYMBOL' })
      continue
    }
    const displayKey = String(raw).trim()
    if (seen.has(parsed.key)) continue
    seen.add(parsed.key)
    accepted.push({ ...parsed, displayKey })
    if (accepted.length >= MAX_SYMBOLS) break
  }
  return { accepted, rejected }
}

/**
 * Project one upstream row into the shape the route and the tool both speak.
 * @param row - one `diff` entry from the upstream payload.
 * @param key - the symbol key the caller asked for.
 * @param secid - the secid that answered.
 * @param fetchedAt - the local fetch time, used when upstream reports none.
 */
function mapQuote(row, key, secid, fetchedAt) {
  const market = finiteOrNull(row.f13)
  const updatedSeconds = finiteOrNull(row.f124)
  return {
    key,
    secid,
    code: typeof row.f12 === 'string' ? row.f12 : null,
    name: typeof row.f14 === 'string' ? row.f14 : null,
    market: market === null ? null : marketLabel(market, typeof row.f12 === 'string' ? row.f12 : ''),
    price: finiteOrNull(row.f2),
    change: finiteOrNull(row.f4),
    changePct: finiteOrNull(row.f3),
    open: finiteOrNull(row.f17),
    high: finiteOrNull(row.f15),
    low: finiteOrNull(row.f16),
    prevClose: finiteOrNull(row.f18),
    volume: finiteOrNull(row.f5),
    amount: finiteOrNull(row.f6),
    quoteTime: updatedSeconds === null ? null : new Date(updatedSeconds * 1000).toISOString(),
    fetchedAt,
  }
}

/** Build the abort signal for one upstream call: the caller's cancellation plus our own deadline. */
function requestSignal(timeoutMs, signal) {
  const deadline = AbortSignal.timeout(timeoutMs)
  return signal === undefined ? deadline : AbortSignal.any([signal, deadline])
}

/**
 * Read one upstream quote batch, memoized briefly so several browsers polling
 * the same watchlist share a single upstream call.
 * @param secids - comma-joined secid list forming the request identity.
 * @param timeoutMs - upstream deadline.
 * @param signal - caller cancellation.
 * @returns the raw `diff` rows, keyed by secid.
 */
async function loadRows(secids, timeoutMs, signal) {
  const cacheKey = secids.join(',')
  const cached = quoteCache.get(cacheKey)
  if (cached !== undefined && Date.now() - cached.at < QUOTE_CACHE_TTL_MS) return cached.rows
  const url = `${QUOTE_ENDPOINT}?fltt=2&invt=2&secids=${encodeURIComponent(secids.join(','))}&fields=${QUOTE_FIELDS}`
  let response
  try {
    response = await fetch(url, { headers: UPSTREAM_HEADERS, signal: requestSignal(timeoutMs, signal) })
  } catch (error) {
    throw new QuoteFeedError(`行情接口连接失败：${error instanceof Error ? error.message : String(error)}`, 'UPSTREAM_UNREACHABLE', { cause: error })
  }
  if (!response.ok) {
    throw new QuoteFeedError(`行情接口返回 HTTP ${response.status}`, 'UPSTREAM_STATUS')
  }
  let payload
  try {
    payload = await response.json()
  } catch (error) {
    throw new QuoteFeedError('行情接口返回了无法解析的内容', 'UPSTREAM_PAYLOAD', { cause: error })
  }
  const rows = new Map()
  const diff = payload?.data?.diff
  if (Array.isArray(diff)) {
    for (const row of diff) {
      if (row === null || typeof row !== 'object') continue
      const market = finiteOrNull(row.f13)
      const code = typeof row.f12 === 'string' ? row.f12 : ''
      if (market === null || code === '') continue
      rows.set(`${market}.${code}`, row)
    }
  }
  quoteCache.set(cacheKey, { at: Date.now(), rows })
  if (quoteCache.size > 16) quoteCache.delete(quoteCache.keys().next().value)
  return rows
}

/**
 * Fetch a watchlist in one upstream round, retrying only the symbols whose
 * first market guess did not answer.
 * @param symbols - raw symbol texts.
 * @param options - upstream deadline and caller cancellation.
 * @returns quotes in request order plus one error entry per unresolved symbol.
 */
export async function fetchQuotes(symbols, options = {}) {
  const { timeoutMs = 8000, signal } = options
  const fetchedAt = new Date().toISOString()
  const { accepted, rejected } = parseSymbols(Array.isArray(symbols) ? symbols : [])
  const errors = rejected.map(entry => ({ key: entry.key, reason: entry.reason }))
  const resolved = new Map()
  if (accepted.length > 0) {
    const firstPass = accepted.map(entry => resolvedSecids.get(entry.key) ?? entry.candidates[0])
    let rows = await loadRows([...new Set(firstPass)], timeoutMs, signal)
    const unresolved = accepted.filter(entry => !rows.has(resolvedSecids.get(entry.key) ?? entry.candidates[0]))
    if (unresolved.length > 0) {
      const retry = []
      for (const entry of unresolved) {
        for (const candidate of entry.candidates) {
          if (candidate !== (resolvedSecids.get(entry.key) ?? entry.candidates[0])) retry.push(candidate)
        }
      }
      if (retry.length > 0) {
        const retryRows = await loadRows([...new Set(retry)], timeoutMs, signal)
        rows = new Map([...rows, ...retryRows])
      }
    }
    for (const entry of accepted) {
      const cached = resolvedSecids.get(entry.key)
      const match = entry.candidates.find(candidate => rows.has(candidate)) ?? (cached !== undefined && rows.has(cached) ? cached : undefined)
      if (match === undefined) {
        errors.push({ key: entry.displayKey, reason: 'NOT_FOUND' })
        continue
      }
      resolvedSecids.set(entry.key, match)
      resolved.set(entry.key, mapQuote(rows.get(match), entry.key, match, fetchedAt))
    }
  }
  const quotes = []
  for (const entry of accepted) {
    const quote = resolved.get(entry.key)
    if (quote !== undefined) quotes.push(quote)
  }
  return { asOf: fetchedAt, quotes, errors }
}

/**
 * Read today's minute series for one symbol.
 * @param symbol - one raw symbol text.
 * @param options - upstream deadline and caller cancellation.
 * @returns the series with its previous close, or a feed error.
 */
export async function fetchTrend(symbol, options = {}) {
  const { timeoutMs = 8000, signal } = options
  const parsed = parseSymbol(symbol)
  if (parsed === null) throw new QuoteFeedError(`无法识别的代码：${symbol}`, 'UNKNOWN_SYMBOL')
  const candidates = resolvedSecids.has(parsed.key) ? [resolvedSecids.get(parsed.key)] : parsed.candidates
  let lastCode = 'NOT_FOUND'
  for (const secid of candidates) {
    const url = `${TREND_ENDPOINT}?secid=${encodeURIComponent(secid)}&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13&fields2=f51,f53,f56&ndays=1&iscr=0`
    let response
    try {
      response = await fetch(url, { headers: UPSTREAM_HEADERS, signal: requestSignal(timeoutMs, signal) })
    } catch (error) {
      throw new QuoteFeedError(`分时接口连接失败：${error instanceof Error ? error.message : String(error)}`, 'UPSTREAM_UNREACHABLE', { cause: error })
    }
    if (!response.ok) {
      lastCode = 'UPSTREAM_STATUS'
      continue
    }
    let payload
    try {
      payload = await response.json()
    } catch {
      lastCode = 'UPSTREAM_PAYLOAD'
      continue
    }
    const data = payload?.data
    if (data === null || data === undefined || !Array.isArray(data.trends) || data.trends.length === 0) {
      lastCode = 'NO_TREND'
      continue
    }
    const points = []
    for (const row of data.trends) {
      if (typeof row !== 'string') continue
      const parts = row.split(',')
      const stamp = parts[0]
      const price = finiteOrNull(parts[1])
      if (typeof stamp !== 'string' || price === null) continue
      points.push({ t: stamp.length > 11 ? stamp.slice(11, 16) : stamp, p: price })
    }
    resolvedSecids.set(parsed.key, secid)
    return {
      key: parsed.key,
      secid,
      name: typeof data.name === 'string' ? data.name : null,
      prevClose: finiteOrNull(data.preClose) ?? finiteOrNull(data.preSettlement),
      points,
      fetchedAt: new Date().toISOString(),
    }
  }
  throw new QuoteFeedError(`没有取到 ${symbol} 的分时数据`, lastCode)
}

/**
 * Search symbols by what the user knows: a Chinese name, pinyin, or a code.
 * The suggest endpoint behind the quote site's own search box answers all of
 * them; derivatives and board rows are dropped because they cannot be quoted
 * as a watchlist entry.
 * @param query - the raw search text.
 * @param options - upstream deadline and caller cancellation.
 * @returns up to {@link MAX_SEARCH_RESULTS} candidates, mainland first.
 */
export async function searchSymbols(query, options = {}) {
  const { timeoutMs = 8000, signal } = options
  const text = typeof query === 'string' ? query.trim() : ''
  if (text === '') return []
  if (text.length > 32) throw new QuoteFeedError('搜索词太长了', 'INVALID_QUERY')
  const url = `${SUGGEST_ENDPOINT}?input=${encodeURIComponent(text)}&type=14&token=${SUGGEST_TOKEN}&count=20`
  let response
  try {
    response = await fetch(url, { headers: UPSTREAM_HEADERS, signal: requestSignal(timeoutMs, signal) })
  } catch (error) {
    throw new QuoteFeedError(`搜索接口连接失败：${error instanceof Error ? error.message : String(error)}`, 'UPSTREAM_UNREACHABLE', { cause: error })
  }
  if (!response.ok) throw new QuoteFeedError(`搜索接口返回 HTTP ${response.status}`, 'UPSTREAM_STATUS')
  let payload
  try {
    payload = await response.json()
  } catch (error) {
    throw new QuoteFeedError('搜索接口返回了无法解析的内容', 'UPSTREAM_PAYLOAD', { cause: error })
  }
  const rows = payload?.QuotationCodeTable?.Data
  const candidates = []
  const seen = new Set()
  if (Array.isArray(rows)) {
    for (const row of rows) {
      if (row === null || typeof row !== 'object') continue
      const market = Number(row.MktNum)
      if (!SEARCHABLE_MARKETS.has(market)) continue
      const kind = typeof row.SecurityTypeName === 'string' ? row.SecurityTypeName : null
      // Kinds are the reliable filter: funds, futures, boards and pink sheets all
      // share a market id with real shares, while TypeUS differs per exchange.
      if (kind === null || !SEARCHABLE_KINDS.has(kind)) continue
      // Hong Kong warrants wear the 港股 label; there TypeUS 6 separates them from
      // stocks. On the mainland TypeUS 6 is an ordinary A-share, so it must pass.
      if (market === 116 && String(row.TypeUS) === '6') continue
      const code = typeof row.Code === 'string' ? row.Code : ''
      const name = typeof row.Name === 'string' ? row.Name : ''
      const secid = typeof row.QuoteID === 'string' && row.QuoteID !== '' ? row.QuoteID : `${market}.${code}`
      if (code === '' || name === '' || !/^\d{1,3}\.[A-Za-z0-9]{1,12}$/.test(secid)) continue
      if (seen.has(secid)) continue
      seen.add(secid)
      // Equities answer a name search better than an index, fund, or bond that
      // merely shares the words, so those drop behind; an exact name or code
      // match wins inside its group.
      const kindRank = kind.includes('指数') ? 30 : kind.includes('基金') || kind.includes('债') ? 20 : 0
      const exact = name === text || code.toLowerCase() === text.toLowerCase() ? 0 : 1
      candidates.push({
        key: secid,
        secid,
        name,
        code,
        market: marketLabel(market, code),
        kind,
        rank: kindRank + (MARKET_RANK[market] ?? 9) + exact,
      })
    }
  }
  return candidates
    .sort((left, right) => left.rank - right.rank)
    .slice(0, MAX_SEARCH_RESULTS)
    .map(({ rank, ...rest }) => rest)
}
