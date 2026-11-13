/**
 * Stock Watch — Host half.
 *
 * Owns the one quote operation the whole plugin speaks: the browser strip and
 * the `stock_watch` agent tool both read `lib/data.js`, and the Web route is the
 * only thing the browser can call. Nothing is polled here: the page asks, this
 * answers, so an idle page costs no upstream traffic.
 */
import { MAX_SYMBOLS, QuoteFeedError, fetchQuotes, fetchTrend, searchSymbols } from './lib/data.js'

/** Web route prefix owned by this plugin. */
const ROUTE_PATH = '/plugin/stock-watch'
/** Symbols shown before the user customizes the watchlist: one index per board, then the stocks people ask about most. */
const DEFAULT_SYMBOLS = ['sh000001', 'sh600519', 'sz300750', 'hk00700', '105.AAPL', 'sz399001', 'sz399006', '0.899050']
/** Refresh cadence the browser strip uses unless configured otherwise. */
const DEFAULT_REFRESH_MS = 5000
/** Refresh cadence for an open intraday chart. */
const DEFAULT_TREND_REFRESH_MS = 20000
/** Upstream deadline for one request. */
const DEFAULT_TIMEOUT_MS = 8000

/** Tool names this plugin registers, used for diagnostics and cleanup labels. */
const TOOL_NAME = 'stock_watch'

/** Clamp a configured number into a usable range, falling back on the default. */
function numberOr(value, fallback, min, max) {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.round(parsed)))
}

/**
 * Normalize the plugin row's config into the values this plugin uses.
 * @param config - raw row config, possibly absent or malformed.
 * @returns watchlist, refresh cadences, and the upstream deadline.
 */
function readConfig(config) {
  const source = config !== null && typeof config === 'object' ? config : {}
  const rawWatchlist = Array.isArray(source.watchlist)
    ? source.watchlist.filter(entry => typeof entry === 'string' && entry.trim() !== '')
    : []
  const watchlist = rawWatchlist.length > 0 ? rawWatchlist.slice(0, MAX_SYMBOLS) : DEFAULT_SYMBOLS
  return {
    watchlist,
    refreshMs: numberOr(source.refreshMs, DEFAULT_REFRESH_MS, 2000, 60000),
    trendRefreshMs: numberOr(source.trendRefreshMs, DEFAULT_TREND_REFRESH_MS, 5000, 120000),
    timeoutMs: numberOr(source.timeoutMs, DEFAULT_TIMEOUT_MS, 1000, 20000),
  }
}

/** Build a JSON response that no cache may reuse. */
function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

/** Format an amount in the yuan/ten-thousand/yuan-hundred-million units readers expect. */
function formatAmount(value) {
  if (value === null) return '—'
  if (Math.abs(value) >= 1e8) return `${(value / 1e8).toFixed(2)}亿`
  if (Math.abs(value) >= 1e4) return `${(value / 1e4).toFixed(2)}万`
  return value.toFixed(0)
}

/** Format a signed percentage, or an em dash when the field is absent. */
function formatPercent(value) {
  if (value === null) return '—'
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
}

/** Format a price with two decimals (three below one), or an em dash when the field is absent. */
function formatPrice(value) {
  if (value === null) return '—'
  return value.toFixed(Math.abs(value) >= 1 ? 2 : 3)
}

/** Format an ISO timestamp as a Shanghai wall-clock `MM-DD HH:mm:ss`. */
function formatStamp(iso) {
  const date = typeof iso === 'string' ? new Date(iso) : new Date()
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date)
}

/** Format one quote as a single line for the model. */
function quoteLine(quote) {
  const parts = [
    `${quote.name ?? '未知'} ${quote.key}`,
    formatPrice(quote.price),
    formatPercent(quote.changePct),
  ]
  if (quote.change !== null) parts.push(`(${quote.change >= 0 ? '+' : ''}${quote.change.toFixed(2)})`)
  const details = []
  if (quote.high !== null && quote.low !== null) details.push(`高 ${formatPrice(quote.high)} / 低 ${formatPrice(quote.low)}`)
  if (quote.open !== null) details.push(`开 ${formatPrice(quote.open)}`)
  if (quote.prevClose !== null) details.push(`昨收 ${formatPrice(quote.prevClose)}`)
  if (quote.amount !== null) details.push(`成交额 ${formatAmount(quote.amount)}`)
  if (quote.quoteTime !== null) details.push(`行情时间 ${formatStamp(quote.quoteTime)}`)
  return `${parts.join('  ')}${details.length > 0 ? `  ·  ${details.join(' / ')}` : ''}`
}

/** Sample an intraday series down to at most `limit` points for a text summary. */
function sampleTrend(trend, limit = 20) {
  const points = trend.points
  if (points.length <= limit) return points.map(point => [point.t, point.p])
  const sampled = []
  for (let index = 0; index < limit; index++) {
    const point = points[Math.round((index * (points.length - 1)) / (limit - 1))]
    sampled.push([point.t, point.p])
  }
  return sampled
}

/**
 * Render the tool's canonical value as model-facing text.
 * @param value - the object `execute` returned.
 * @returns model content blocks.
 */
function renderQuotes(value) {
  const lines = [`行情来源：东方财富公开行情接口 · 取数时间 ${formatStamp(value.asOf)}（北京时间）`]
  const candidates = Array.isArray(value.candidates) ? value.candidates : []
  if (candidates.length > 0) {
    lines.push('候选代码（把 key 作为 symbols 再调一次即可取行情）：')
    for (const candidate of candidates) {
      lines.push(`${candidate.name}  代码 ${candidate.code}  ${candidate.market}${candidate.kind === null ? '' : ` / ${candidate.kind}`}  key=${candidate.key}`)
    }
    return [{ type: 'text', text: lines.join('\n') }]
  }
  if (Array.isArray(value.candidates)) lines.push('没有匹配的代码。')
  if (value.quotes.length === 0 && !Array.isArray(value.candidates)) lines.push('没有取到任何行情。')
  for (const quote of value.quotes) lines.push(quoteLine(quote))
  for (const error of value.errors) {
    lines.push(`未取到 ${error.key}：${error.reason === 'UNKNOWN_SYMBOL' ? '代码格式无法识别' : '行情源没有此代码'}`)
  }
  if (value.trend !== undefined && value.trend !== null) {
    const points = value.trend.points.map(point => `${point[0]} ${point[1]}`).join(' | ')
    lines.push(`当日分时（${value.trend.name ?? value.trend.key}，昨收 ${formatPrice(value.trend.prevClose)}）：${points}`)
  }
  if (typeof value.trendError === 'string') lines.push(`分时数据未取到：${value.trendError}`)
  return [{ type: 'text', text: lines.join('\n') }]
}

/**
 * Host plugin body: one Web route over the shared quote operation and one
 * agent tool over the same operation.
 * @param ctx - Host context with `tools` and `webServer` available.
 * @param config - the plugin row's config (watchlist, refresh cadence, deadline).
 */
export function apply(ctx, config) {
  const settings = readConfig(config)

  /** One quote read shared by the route and the tool. */
  const readQuotes = async (symbols, signal) => {
    const result = await fetchQuotes(symbols, { timeoutMs: settings.timeoutMs, signal })
    return {
      asOf: result.asOf,
      quotes: result.quotes,
      errors: result.errors,
    }
  }

  const route = {
    kind: 'prefix',
    path: ROUTE_PATH,
    resource: async (request) => {
      let url
      try {
        url = new URL(request.url)
      } catch {
        return jsonResponse(400, { ok: false, error: 'BAD_REQUEST' })
      }
      const path = url.pathname
      try {
        if (path === `${ROUTE_PATH}/config`) {
          return jsonResponse(200, {
            ok: true,
            watchlist: settings.watchlist,
            refreshMs: settings.refreshMs,
            trendRefreshMs: settings.trendRefreshMs,
            maxSymbols: MAX_SYMBOLS,
          })
        }
        if (path === `${ROUTE_PATH}/quotes`) {
          const requested = url.searchParams.getAll('symbols').flatMap(entry => entry.split(','))
          const symbols = requested.filter(entry => entry.trim() !== '')
          const result = await readQuotes(symbols.length > 0 ? symbols : settings.watchlist, request.signal)
          return jsonResponse(200, { ok: true, ...result })
        }
        if (path === `${ROUTE_PATH}/search`) {
          const query = url.searchParams.get('q') ?? ''
          const items = await searchSymbols(query, { timeoutMs: settings.timeoutMs, signal: request.signal })
          return jsonResponse(200, { ok: true, items })
        }
        if (path === `${ROUTE_PATH}/trend`) {
          const symbol = url.searchParams.get('symbol')
          if (symbol === null || symbol.trim() === '') {
            return jsonResponse(400, { ok: false, error: 'MISSING_SYMBOL' })
          }
          const trend = await fetchTrend(symbol, { timeoutMs: settings.timeoutMs, signal: request.signal })
          return jsonResponse(200, { ok: true, trend })
        }
        return jsonResponse(404, { ok: false, error: 'NOT_FOUND' })
      } catch (error) {
        if (error instanceof QuoteFeedError) {
          return jsonResponse(502, { ok: false, error: error.code, message: error.message })
        }
        return jsonResponse(500, { ok: false, error: 'INTERNAL', message: error instanceof Error ? error.message : String(error) })
      }
    },
  }

  const tool = {
    name: TOOL_NAME,
    description: 'Read near-real-time quotes for mainland China (Shanghai, Shenzhen, and Beijing), Hong Kong, and US stocks and indices from the public Eastmoney quote feed. '
      + 'Returns price, change, open/high/low, previous close, turnover, and the quote timestamp. '
      + 'Symbols look like sh600519, sz000001, hk00700, us:AAPL, or a raw secid such as 105.AAPL; omit them to read the configured watchlist. '
      + 'Pass query instead to resolve a Chinese name, pinyin, or code into candidate symbols. '
      + 'Set trend to also get today\'s minute series for the first symbol.',
    parameters: {
      type: 'object',
      properties: {
        symbols: {
          type: 'array',
          items: { type: 'string' },
          description: 'Symbols to quote, for example ["sh600519","hk00700"]. Omit to use the plugin watchlist.',
        },
        query: {
          type: 'string',
          description: 'Search text such as 茅台, 腾讯, 比亚迪, or 600519; returns candidate symbols instead of quotes.',
        },
        trend: {
          type: 'boolean',
          description: 'Also return today\'s intraday minute series for the first quoted symbol.',
        },
      },
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          asOf: { type: 'string' },
          quotes: { type: 'array', items: { type: 'object' } },
          errors: { type: 'array', items: { type: 'object' } },
          candidates: { type: 'array', items: { type: 'object' } },
          trend: { type: 'object' },
          trendError: { type: 'string' },
        },
      },
      render: (_args, value) => renderQuotes(value),
    },
    execute: async (args, exec) => {
      const source = args !== null && typeof args === 'object' ? args : {}
      const asOf = new Date().toISOString()
      const query = typeof source.query === 'string' ? source.query.trim() : ''
      if (query !== '') {
        const candidates = await searchSymbols(query, { timeoutMs: settings.timeoutMs, signal: exec.signal })
        return { asOf, quotes: [], errors: [], candidates }
      }
      const requested = Array.isArray(source.symbols)
        ? source.symbols.filter(entry => typeof entry === 'string')
        : []
      const symbols = requested.length > 0 ? requested : settings.watchlist
      const result = await readQuotes(symbols, exec.signal)
      const value = { ...result }
      if (source.trend === true && result.quotes.length > 0) {
        const first = result.quotes[0]
        try {
          const trend = await fetchTrend(first.key, { timeoutMs: settings.timeoutMs, signal: exec.signal })
          value.trend = {
            key: trend.key,
            name: trend.name,
            prevClose: trend.prevClose,
            points: sampleTrend(trend),
          }
        } catch (error) {
          value.trendError = error instanceof Error ? error.message : String(error)
        }
      }
      return value
    },
  }

  ctx.effect(() => ctx.webServer.register(route), 'stock-watch: quotes route')
  ctx.effect(() => ctx.tools.register(tool), 'stock-watch: stock_watch tool')
}

/** Services this plugin cannot work without: the Web carrier and the tool registry. */
export const inject = ['tools', 'webServer']
