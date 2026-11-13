/**
 * Stock Watch — browser half.
 *
 * One draggable floating pane over the whole frame: a watchlist of live quotes,
 * a click-to-open intraday chart, and add/remove controls. It reads the Host's
 * `/plugin/stock-watch` route, which is also what the `stock_watch` tool reads,
 * so the page and the model always show the same numbers.
 */
window.__ModuleLoader__.load({
  id: 'dsh-stock-watchlist',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Locale namespace owned by this plugin. */
    const NS = 'stockWatch'
    /** Browser-local watchlist; the plugin row's config only supplies defaults. */
    const STORAGE_SYMBOLS = 'dsh.stock-watch.symbols'
    /** Whether the pane is folded into its title bar. */
    const STORAGE_COLLAPSED = 'dsh.stock-watch.collapsed'
    /** Last dragged position, relative to the floating layer. */
    const STORAGE_POSITION = 'dsh.stock-watch.position'
    /** Pane width; the layer is the frame, so this also bounds dragging. */
    const PANE_WIDTH = 288

    const DICT = {
      zh: {
        label: '自选股',
        drag: '拖动窗口',
        expand: '展开行情窗',
        collapse: '收起到标题栏',
        refresh: '立即刷新',
        add: '添加自选',
        addSymbol: '添加',
        addPlaceholder: '代码或名称，如 600519 / 茅台 / 腾讯',
        searching: '搜索中…',
        noMatch: '没有找到这个名称',
        cancel: '取消',
        reset: '恢复默认',
        remove: '移出自选',
        close: '关闭详情',
        loading: '加载中…',
        empty: '还没有自选，点下面的“添加自选”。',
        updated: '截至',
        closed: '休市',
        fetchedAt: '拉取于',
        error: '行情不可用',
        retry: '重试',
        badSymbol: '识别不了这个代码',
        noSuchSymbol: '行情源里没有这个代码',
        fetchFailed: '暂时取不到行情，请稍后重试',
        alreadyAdded: '这只已经在自选里了',
        partialError: '这些代码没取到行情：',
        timeout: '行情请求超时',
        maxReached: '自选已达上限',
        detail: {
          open: '今开',
          high: '最高',
          low: '最低',
          prevClose: '昨收',
          amount: '成交额',
          trend: '当日分时',
          trendLoading: '分时加载中…',
          trendError: '分时没取到',
          quoteTime: '行情时间',
        },
        market: { SH: '沪', SZ: '深', BJ: '京', HK: '港', US: '美', IDX: '指数', OTHER: '其他' },
      },
      en: {
        label: 'Watchlist',
        drag: 'Drag this pane',
        expand: 'Expand the quote pane',
        collapse: 'Fold into the title bar',
        refresh: 'Refresh now',
        add: 'Add a symbol',
        addSymbol: 'Add',
        addPlaceholder: 'Code or name, e.g. 600519 / 茅台 / 腾讯',
        searching: 'Searching…',
        noMatch: 'No match for that name',
        cancel: 'Cancel',
        reset: 'Reset to defaults',
        remove: 'Remove from watchlist',
        close: 'Close details',
        loading: 'Loading…',
        empty: 'No symbols yet. Use "Add a symbol" below.',
        updated: 'As of',
        closed: 'Closed',
        fetchedAt: 'Fetched',
        error: 'Quotes unavailable',
        retry: 'Retry',
        badSymbol: 'Unrecognized symbol',
        noSuchSymbol: 'The feed has no quote for this symbol',
        fetchFailed: 'Quotes are temporarily unavailable, try again',
        alreadyAdded: 'Already in the watchlist',
        partialError: 'No quotes for: ',
        timeout: 'The quote request timed out',
        maxReached: 'Watchlist is full',
        detail: {
          open: 'Open',
          high: 'High',
          low: 'Low',
          prevClose: 'Prev close',
          amount: 'Turnover',
          trend: 'Today',
          trendLoading: 'Loading intraday ticks…',
          trendError: 'Intraday data unavailable',
          quoteTime: 'Quote time',
        },
        market: { SH: 'SH', SZ: 'SZ', BJ: 'BSE', HK: 'HK', US: 'US', IDX: 'Index', OTHER: 'Other' },
      },
    }

    /** Flatten one nested dictionary into `dotted.key` lookups. */
    function flattenDictionary(source, prefix = '', out = {}) {
      for (const [key, value] of Object.entries(source)) {
        if (value !== null && typeof value === 'object') flattenDictionary(value, `${prefix}${key}.`, out)
        else out[`${prefix}${key}`] = value
      }
      return out
    }

    /** Chinese copy used when the locale seat cannot resolve a key. */
    const ZH_FLAT = flattenDictionary(DICT.zh)

    /**
     * Quote-detail vocabulary. These are the terms a mainland trader reads on a
     * quote board, so they stay Chinese whatever the interface language is.
     */
    const DETAIL_LABELS = {
      open: '今开',
      high: '最高',
      low: '最低',
      prevClose: '昨收',
      amount: '成交额',
      quoteTime: '行情时间',
      trend: '当日分时',
      trendLoading: '分时加载中…',
      trendError: '分时没取到',
      market: { SH: '沪', SZ: '深', BJ: '京', HK: '港', US: '美', IDX: '指数', OTHER: '其他' },
    }

    /** Tokens the pane uses; literal colors appear only for gain/loss direction. */
    const C = {
      up: 'var(--dsw-static-red-500)',
      down: 'var(--dsw-static-green-500)',
      flat: 'var(--dsw-alias-label-tertiary)',
      text: 'var(--dsw-alias-label-primary)',
      secondary: 'var(--dsw-alias-label-secondary)',
      tertiary: 'var(--dsw-alias-label-tertiary)',
      border: 'var(--dsw-alias-border-l2)',
      borderSelected: 'var(--dsw-alias-border-selected)',
      surface: 'var(--dsw-alias-bg-layer-1)',
      surfaceActive: 'var(--dsw-alias-interactive-bg-active)',
      hover: 'var(--dsw-alias-interactive-bg-hover)',
      ok: 'var(--dsw-alias-state-success-primary)',
      warn: 'var(--dsw-alias-state-warn-primary)',
      bad: 'var(--dsw-alias-state-error-primary)',
      radius: 'var(--dsw-radius-md)',
      radiusSm: 'var(--dsw-radius-sm)',
      radiusPane: 'var(--dsw-radius-panel)',
    }

    /** Width/height of the inline sparkline canvas before it is stretched. */
    const CHART_W = 320
    const CHART_H = 44

    /**
     * Regular trading sessions in Shanghai wall-clock minutes, `[open, close)`.
     * A close past 1440 wraps into the next calendar day.
     */
    const SESSIONS = {
      CN: [[555, 690], [780, 900]], // 09:15–11:30, 13:00–15:00
      HK: [[570, 720], [780, 960]], // 09:30–12:00, 13:00–16:00
      US: [[1290, 1740]], // 21:30–05:00 next day (covers both DST offsets)
    }
    /** Weekdays that hold a session. */
    const TRADING_WEEKDAYS = new Set(['Mon', 'Tue', 'Wed', 'Thu', 'Fri'])
    /** Shanghai clock reader shared by every session check. */
    const SHANGHAI_CLOCK = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Shanghai',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })

    /** Read the current Shanghai wall-clock weekday and minute-of-day. */
    function shanghaiNow() {
      const parts = SHANGHAI_CLOCK.formatToParts(new Date())
      const lookup = {}
      for (const part of parts) lookup[part.type] = part.value
      return {
        weekday: lookup.weekday,
        minutes: (Number(lookup.hour) % 24) * 60 + Number(lookup.minute),
      }
    }

    /** Convert one symbol key into the market whose session it follows. */
    function marketOfSymbol(key) {
      if (typeof key !== 'string') return 'CN'
      const text = key.trim()
      if (/^hk/i.test(text) || /^116\./.test(text) || /^100\./.test(text)) return 'HK'
      if (/^us:/i.test(text) || /^(105|106|107)\./.test(text)) return 'US'
      return 'CN'
    }

    /** Whether any market in the watchlist holds a session right now. */
    function anySessionOpen(symbols) {
      const markets = new Set(symbols.map(marketOfSymbol))
      const { weekday, minutes } = shanghaiNow()
      const previousWeekday = {
        Mon: 'Sun', Tue: 'Mon', Wed: 'Tue', Thu: 'Wed', Fri: 'Thu', Sat: 'Fri', Sun: 'Sat',
      }[weekday]
      for (const market of markets) {
        const ranges = SESSIONS[market]
        if (ranges === undefined) continue
        for (const [from, to] of ranges) {
          if (to <= 1440) {
            if (TRADING_WEEKDAYS.has(weekday) && minutes >= from && minutes < to) return true
          } else {
            // The after-midnight tail belongs to the previous trading day.
            if (TRADING_WEEKDAYS.has(weekday) && minutes >= from) return true
            if (TRADING_WEEKDAYS.has(previousWeekday) && minutes < to - 1440) return true
          }
        }
      }
      return false
    }

    /** Direction color for a change percentage. */
    function trendColor(value) {
      if (value === null || value === undefined || value === 0) return C.flat
      return value > 0 ? C.up : C.down
    }

    /** Format a price, adding a digit below one. */
    function fmtPrice(value) {
      if (value === null || value === undefined) return '—'
      return value.toFixed(Math.abs(value) >= 1 ? 2 : 3)
    }

    /** Format a signed percentage. */
    function fmtPct(value) {
      if (value === null || value === undefined) return '—'
      return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
    }

    /** Format a signed absolute change. */
    function fmtChange(value) {
      if (value === null || value === undefined) return '—'
      return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`
    }

    /** Format turnover in 万/亿 units. */
    function fmtAmount(value) {
      if (value === null || value === undefined) return '—'
      if (Math.abs(value) >= 1e8) return `${(value / 1e8).toFixed(2)}亿`
      if (Math.abs(value) >= 1e4) return `${(value / 1e4).toFixed(2)}万`
      return String(Math.round(value))
    }

    /** Format an ISO timestamp as Shanghai wall-clock time. */
    function fmtClock(iso, withSeconds) {
      if (typeof iso !== 'string') return '—'
      const date = new Date(iso)
      if (Number.isNaN(date.getTime())) return '—'
      return new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        hour: '2-digit',
        minute: '2-digit',
        second: withSeconds === false ? undefined : '2-digit',
        hour12: false,
      }).format(date)
    }

    /** Reject a stored value that is not a usable symbol list. */
    function asSymbolList(value) {
      if (!Array.isArray(value)) return null
      const list = value.filter(entry => typeof entry === 'string' && entry.trim() !== '')
      return list.length > 0 ? list.slice(0, 40) : null
    }

    /** Read the browser-local watchlist, or null when the user never edited it (an empty list is a real value). */
    function readStoredSymbols() {
      try {
        const parsed = JSON.parse(window.localStorage.getItem(STORAGE_SYMBOLS) ?? 'null')
        if (!Array.isArray(parsed)) return null
        return parsed.filter(entry => typeof entry === 'string' && entry.trim() !== '').slice(0, 40)
      } catch {
        return null
      }
    }

    /** Persist the browser-local watchlist; failures only cost the customization. */
    function writeStoredSymbols(symbols) {
      try {
        if (symbols === null) window.localStorage.removeItem(STORAGE_SYMBOLS)
        else window.localStorage.setItem(STORAGE_SYMBOLS, JSON.stringify(symbols))
      } catch {
        /* storage may be unavailable; the pane still works for this page view */
      }
    }

    /** Read the persisted folded flag. */
    function readCollapsed() {
      try {
        return window.localStorage.getItem(STORAGE_COLLAPSED) === '1'
      } catch {
        return false
      }
    }

    /** Persist the folded flag. */
    function writeCollapsed(value) {
      try {
        window.localStorage.setItem(STORAGE_COLLAPSED, value ? '1' : '0')
      } catch {
        /* ignore */
      }
    }

    /** Read the dragged position, validated against the current viewport. */
    function readPosition() {
      try {
        const parsed = JSON.parse(window.localStorage.getItem(STORAGE_POSITION) ?? 'null')
        if (parsed === null || typeof parsed !== 'object') return null
        if (!Number.isFinite(parsed.left) || !Number.isFinite(parsed.top)) return null
        return { left: parsed.left, top: parsed.top }
      } catch {
        return null
      }
    }

    /** Persist the dragged position. */
    function writePosition(position) {
      try {
        window.localStorage.setItem(STORAGE_POSITION, JSON.stringify(position))
      } catch {
        /* ignore */
      }
    }

    /**
     * Keep a viewport-anchored pane on screen while letting it reach every edge:
     * the title bar stays reachable even when the body hangs past the bottom.
     */
    function clampToViewport(left, top, width, height) {
      const maxLeft = Math.max(8, window.innerWidth - width - 8)
      const maxTop = Math.max(8, window.innerHeight - Math.min(height, 40) - 8)
      return {
        left: Math.min(Math.max(8, left), maxLeft),
        top: Math.min(Math.max(8, top), maxTop),
      }
    }

    /** The origin serving this page, used to reach the plugin's Host route. */
    function resolveOrigin() {
      if (typeof window === 'undefined') return ''
      if (/^https?:$/.test(window.location.protocol)) return window.location.origin
      const boot = window.__DSH_BOOT__
      const port = boot !== null && typeof boot === 'object' ? boot.webPort ?? boot.port : undefined
      return typeof port === 'number' || typeof port === 'string' ? `http://127.0.0.1:${port}` : ''
    }

    /** Fetch one JSON body from the plugin route. */
    async function requestJson(path, signal) {
      const origin = resolveOrigin()
      const response = await fetch(`${origin}/plugin/stock-watch/${path}`, {
        signal,
        headers: { accept: 'application/json' },
        credentials: 'same-origin',
      })
      let body = null
      try {
        body = await response.json()
      } catch {
        body = null
      }
      if (!response.ok || body === null || body.ok !== true) {
        const detail = body !== null && typeof body.message === 'string' ? body.message : `HTTP ${response.status}`
        throw new Error(detail)
      }
      return body
    }

    /** A small square icon button matching the host's compact controls. */
    function iconButton(label, glyph, onClick) {
      return h('button', {
        type: 'button',
        onClick,
        title: label,
        'aria-label': label,
        // The pane is a drag surface: never let a button press start a drag.
        onPointerDown: event => event.stopPropagation(),
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          minWidth: 22,
          height: 22,
          padding: '0 4px',
          border: '1px solid transparent',
          borderRadius: C.radiusSm,
          background: 'transparent',
          color: C.secondary,
          font: 'inherit',
          fontSize: 12,
          lineHeight: 1,
          cursor: 'pointer',
        },
        onMouseEnter: (event) => {
          event.currentTarget.style.background = C.hover
          event.currentTarget.style.color = C.text
        },
        onMouseLeave: (event) => {
          event.currentTarget.style.background = 'transparent'
          event.currentTarget.style.color = C.secondary
        },
      }, glyph)
    }

    /** The intraday sparkline with its previous-close baseline. */
    function Sparkline({ trend, label }) {
      const points = Array.isArray(trend.points) ? trend.points : []
      if (points.length < 2) return h('div', { style: { color: C.tertiary, fontSize: 12 } }, label)
      const values = points.map(point => point.p)
      const baseline = typeof trend.prevClose === 'number' ? trend.prevClose : null
      const min = Math.min(...(baseline === null ? values : [...values, baseline]))
      const max = Math.max(...(baseline === null ? values : [...values, baseline]))
      const span = max - min || Math.max(Math.abs(max) * 0.001, 0.01)
      const x = index => 2 + (index * (CHART_W - 4)) / Math.max(1, points.length - 1)
      const y = value => 2 + (CHART_H - 4) * (1 - (value - min) / span)
      const line = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)},${y(point.p).toFixed(1)}`).join(' ')
      const area = `${line} L${x(points.length - 1).toFixed(1)},${CHART_H - 2} L${x(0).toFixed(1)},${CHART_H - 2} Z`
      const last = values[values.length - 1]
      const rising = baseline === null ? last >= values[0] : last >= baseline
      const color = rising ? C.up : C.down
      return h('svg', {
        viewBox: `0 0 ${CHART_W} ${CHART_H}`,
        preserveAspectRatio: 'none',
        role: 'img',
        'aria-label': label,
        style: { display: 'block', width: '100%', height: CHART_H },
      },
      baseline === null ? null : h('line', {
        x1: 0, x2: CHART_W, y1: y(baseline), y2: y(baseline),
        stroke: C.border, strokeWidth: 1, strokeDasharray: '3 3',
      }),
      h('path', { d: area, fill: color, opacity: 0.1, stroke: 'none' }),
      h('path', { d: line, fill: 'none', stroke: color, strokeWidth: 1.5, strokeLinejoin: 'round', strokeLinecap: 'round' }))
    }

    /** One quote row inside the pane. */
    function QuoteRow({ quote, active, onClick }) {
      return h('button', {
        type: 'button',
        onClick,
        'aria-pressed': active,
        title: `${quote.name ?? quote.key} ${quote.code ?? ''} · ${fmtPrice(quote.price)} ${fmtPct(quote.changePct)}`,
        style: {
          display: 'flex',
          alignItems: 'baseline',
          gap: 8,
          width: '100%',
          padding: '5px 10px',
          border: 'none',
          borderRadius: C.radiusSm,
          background: active ? C.surfaceActive : 'transparent',
          color: C.text,
          font: 'inherit',
          fontSize: 12,
          lineHeight: 1.4,
          cursor: 'pointer',
          textAlign: 'left',
        },
        onMouseEnter: (event) => {
          if (!active) event.currentTarget.style.background = C.hover
        },
        onMouseLeave: (event) => {
          event.currentTarget.style.background = active ? C.surfaceActive : 'transparent'
        },
      },
      h('span', {
        style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: C.secondary },
      }, quote.name ?? quote.key),
      h('span', { style: { fontVariantNumeric: 'tabular-nums', fontWeight: 600 } }, fmtPrice(quote.price)),
      h('span', {
        style: { width: 54, textAlign: 'right', color: trendColor(quote.changePct), fontVariantNumeric: 'tabular-nums' },
      }, fmtPct(quote.changePct)))
    }

    /** One metric cell inside the detail block. */
    function Metric({ label, value }) {
      return h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 8, whiteSpace: 'nowrap' } },
        h('span', { style: { color: C.tertiary } }, label),
        h('span', { style: { color: C.secondary, fontVariantNumeric: 'tabular-nums' } }, value))
    }

    /** The floating pane: watchlist rows, detail block, and the add form. */
    function StockPane({ t: translate }) {
      // `t` echoes the key when the locale seat has no dictionary; fall back to
      // the Chinese copy so the pane never shows raw keys.
      const t = key => {
        const resolved = translate(key)
        return typeof resolved === 'string' && resolved !== key ? resolved : ZH_FLAT[key] ?? key
      }
      const [configReady, setConfigReady] = React.useState(false)
      const [configOk, setConfigOk] = React.useState(false)
      const [defaults, setDefaults] = React.useState([])
      const [symbols, setSymbols] = React.useState([])
      const [refreshMs, setRefreshMs] = React.useState(5000)
      const [trendRefreshMs, setTrendRefreshMs] = React.useState(20000)
      const [maxSymbols, setMaxSymbols] = React.useState(20)
      const [quotes, setQuotes] = React.useState([])
      const [errors, setErrors] = React.useState([])
      const [asOf, setAsOf] = React.useState(null)
      const [status, setStatus] = React.useState('loading')
      const [message, setMessage] = React.useState(null)
      const [selected, setSelected] = React.useState(null)
      const [detail, setDetail] = React.useState(null)
      const [collapsed, setCollapsed] = React.useState(() => readCollapsed())
      const [position, setPosition] = React.useState(() => readPosition())
      const [dragging, setDragging] = React.useState(false)
      const [addOpen, setAddOpen] = React.useState(false)
      const [draft, setDraft] = React.useState('')
      const [addError, setAddError] = React.useState(null)
      const [suggest, setSuggest] = React.useState({ status: 'idle', items: [], query: '' })
      const [highlight, setHighlight] = React.useState(0)
      const [adding, setAdding] = React.useState(false)
      const [reloadToken, setReloadToken] = React.useState(0)
      const [sessionOpen, setSessionOpen] = React.useState(false)
      const tickRef = React.useRef(null)
      const cardRef = React.useRef(null)
      const dragRef = React.useRef(null)
      const symbolsKey = symbols.join(',')
      const defaultsKey = defaults.join(',')

      // Trading sessions gate the polling: outside them the pane only reads once,
      // when it is opened, and then sits still.
      React.useEffect(() => {
        const update = () => setSessionOpen(anySessionOpen(symbols))
        update()
        const timer = window.setInterval(update, 60000)
        return () => window.clearInterval(timer)
      }, [symbolsKey])

      React.useEffect(() => {
        let cancelled = false
        requestJson('config')
          .then(body => {
            if (cancelled) return
            setRefreshMs(typeof body.refreshMs === 'number' ? body.refreshMs : 5000)
            setTrendRefreshMs(typeof body.trendRefreshMs === 'number' ? body.trendRefreshMs : 20000)
            setMaxSymbols(typeof body.maxSymbols === 'number' ? body.maxSymbols : 20)
            const nextDefaults = asSymbolList(body.watchlist) ?? []
            setDefaults(nextDefaults)
            setSymbols(readStoredSymbols() ?? nextDefaults)
            setConfigOk(true)
            setConfigReady(true)
          })
          .catch(error => {
            if (cancelled) return
            setConfigReady(true)
            setConfigOk(false)
            setDefaults([])
            setSymbols([])
            setStatus('error')
            setMessage(error instanceof Error ? error.message : String(error))
          })
        return () => {
          cancelled = true
        }
      }, [reloadToken])

      React.useEffect(() => {
        // A folded pane is a closed pane: no reads at all.
        if (collapsed) return undefined
        if (symbols.length === 0) {
          setQuotes([])
          setErrors([])
          setAsOf(null)
          setStatus(current => (current === 'error' && message !== null ? current : 'idle'))
          return undefined
        }
        let cancelled = false
        let timer = null
        let inFlight = null
        const tick = async () => {
          // A slow feed must not turn into a silent freeze: skip the beat while a
          // request is still open, and let its own deadline report the failure.
          if (inFlight !== null) return
          const controller = new AbortController()
          inFlight = controller
          let timedOut = false
          const deadline = window.setTimeout(() => {
            timedOut = true
            controller.abort()
          }, 12000)
          try {
            const body = await requestJson(`quotes?symbols=${encodeURIComponent(symbols.join(','))}`, controller.signal)
            if (cancelled) return
            setQuotes(Array.isArray(body.quotes) ? body.quotes : [])
            setErrors(Array.isArray(body.errors) ? body.errors : [])
            setAsOf(typeof body.asOf === 'string' ? body.asOf : null)
            setStatus('live')
            setMessage(null)
          } catch (error) {
            if (cancelled) return
            if (error instanceof Error && error.name === 'AbortError' && !timedOut) return
            setStatus('error')
            setMessage(timedOut ? t('timeout') : error instanceof Error ? error.message : String(error))
          } finally {
            window.clearTimeout(deadline)
            if (inFlight === controller) inFlight = null
          }
        }
        tickRef.current = tick
        // One read whenever the pane is opened, so a closed market still shows its
        // last print; then polls only while a watched market trades.
        tick()
        if (sessionOpen) {
          timer = window.setInterval(() => {
            if (!document.hidden) tick()
          }, refreshMs)
        }
        const onVisible = () => {
          if (!document.hidden && sessionOpen) tick()
        }
        document.addEventListener('visibilitychange', onVisible)
        return () => {
          cancelled = true
          if (timer !== null) window.clearInterval(timer)
          document.removeEventListener('visibilitychange', onVisible)
          if (inFlight !== null) inFlight.abort()
          tickRef.current = null
        }
      }, [symbolsKey, refreshMs, reloadToken, collapsed, sessionOpen])

      React.useEffect(() => {
        if (!configReady || !configOk) return
        const sameAsDefaults = defaults.length === symbols.length && defaults.every((entry, index) => entry === symbols[index])
        writeStoredSymbols(sameAsDefaults ? null : symbols)
      }, [symbolsKey, defaultsKey, configReady, configOk])

      React.useEffect(() => {
        if (selected === null || collapsed) {
          setDetail(null)
          return undefined
        }
        let cancelled = false
        let timer = null
        const load = async () => {
          try {
            const body = await requestJson(`trend?symbol=${encodeURIComponent(selected)}`)
            if (cancelled) return
            setDetail({ status: 'ok', trend: body.trend })
          } catch (error) {
            if (cancelled) return
            setDetail({ status: 'error', message: error instanceof Error ? error.message : String(error) })
          }
        }
        setDetail({ status: 'loading' })
        load()
        if (sessionOpen) {
          timer = window.setInterval(() => {
            if (!document.hidden) load()
          }, trendRefreshMs)
        }
        return () => {
          cancelled = true
          if (timer !== null) window.clearInterval(timer)
        }
      }, [selected, trendRefreshMs, collapsed, sessionOpen])

      // Search while the add form is open, so a Chinese name is enough to find a
      // symbol; typed codes keep working through the same list.
      React.useEffect(() => {
        if (!addOpen) return undefined
        const text = draft.trim()
        if (text === '') {
          setSuggest({ status: 'idle', items: [], query: '' })
          return undefined
        }
        let cancelled = false
        const controller = new AbortController()
        const timer = window.setTimeout(async () => {
          setSuggest(current => ({ status: 'loading', items: current.query === text ? current.items : [], query: text }))
          try {
            const body = await requestJson(`search?q=${encodeURIComponent(text)}`, controller.signal)
            if (cancelled) return
            setSuggest({ status: 'ok', items: Array.isArray(body.items) ? body.items : [], query: text })
            setHighlight(0)
            setAddError(null)
          } catch {
            if (cancelled) return
            setSuggest({ status: 'error', items: [], query: text })
          }
        }, 220)
        return () => {
          cancelled = true
          controller.abort()
          window.clearTimeout(timer)
        }
      }, [addOpen, draft])

      // The pane is fixed to the window, so it can travel across the whole
      // screen; these bounds only keep it reachable after a resize.
      const positionRef = React.useRef(position)
      positionRef.current = position
      const positioned = position !== null
      React.useEffect(() => {
        if (!positioned) return undefined
        const clamp = () => {
          const current = positionRef.current
          const card = cardRef.current
          if (current === null || card === null || card === undefined) return
          const next = clampToViewport(current.left, current.top, card.offsetWidth || PANE_WIDTH, card.offsetHeight || 120)
          if (next.left !== current.left || next.top !== current.top) setPosition(next)
        }
        clamp()
        window.addEventListener('resize', clamp)
        return () => window.removeEventListener('resize', clamp)
      }, [positioned])

      const onDragStart = event => {
        if (event.button !== 0) return
        const card = cardRef.current
        if (card === null) return
        const cardRect = card.getBoundingClientRect()
        dragRef.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          left: cardRect.left,
          top: cardRect.top,
        }
        setDragging(true)
        event.currentTarget.setPointerCapture(event.pointerId)
        event.preventDefault()
      }

      const onDragMove = event => {
        const drag = dragRef.current
        if (drag === null || drag.pointerId !== event.pointerId) return
        const card = cardRef.current
        const next = clampToViewport(
          drag.left + (event.clientX - drag.startX),
          drag.top + (event.clientY - drag.startY),
          card?.offsetWidth ?? PANE_WIDTH,
          card?.offsetHeight ?? 120,
        )
        setPosition(next)
      }

      const onDragEnd = event => {
        const drag = dragRef.current
        if (drag === null || drag.pointerId !== event.pointerId) return
        dragRef.current = null
        setDragging(false)
        const card = cardRef.current
        if (card === null) return
        const rect = card.getBoundingClientRect()
        writePosition(clampToViewport(rect.left, rect.top, rect.width, rect.height))
      }

      const onResetPlacement = () => {
        setPosition(null)
        try {
          window.localStorage.removeItem(STORAGE_POSITION)
        } catch {
          /* ignore */
        }
      }

      const removeSymbol = symbol => {
        setSymbols(current => current.filter(entry => entry !== symbol))
        setSelected(current => (current === symbol ? null : current))
      }

      const resetSymbols = () => {
        setSymbols(defaults)
        setSelected(null)
        setAddOpen(false)
        setAddError(null)
        setSuggest({ status: 'idle', items: [], query: '' })
      }

      /** Add one resolved candidate (from the search list or a code probe). */
      const addCandidate = candidate => {
        if (candidate === null || candidate === undefined) return
        if (symbols.length >= maxSymbols) {
          setAddError(t('maxReached'))
          return
        }
        if (symbols.includes(candidate.key) || quotes.some(quote => quote.secid === candidate.secid)) {
          setAddError(t('alreadyAdded'))
          return
        }
        setSymbols(current => (current.includes(candidate.key) ? current : [...current, candidate.key].slice(0, maxSymbols)))
        setDraft('')
        setSuggest({ status: 'idle', items: [], query: '' })
        setHighlight(0)
        setAddOpen(false)
        setAddError(null)
      }

      const submitAdd = async event => {
        event.preventDefault()
        // Enter that confirms an IME composition must not submit the form.
        if (event.nativeEvent !== undefined && event.nativeEvent !== null && event.nativeEvent.isComposing === true) return
        const input = draft.trim()
        if (input === '' || adding) return
        const matches = suggest.query === input ? suggest.items : []
        if (matches.length > 0) {
          addCandidate(matches[Math.min(Math.max(highlight, 0), matches.length - 1)] ?? matches[0])
          return
        }
        if (/[\u3400-\u9fff]/.test(input)) {
          setAddError(t('noMatch'))
          return
        }
        if (symbols.length >= maxSymbols) {
          setAddError(t('maxReached'))
          return
        }
        setAdding(true)
        setAddError(null)
        try {
          const body = await requestJson(`quotes?symbols=${encodeURIComponent(input)}`)
          const found = Array.isArray(body.quotes) && body.quotes.length > 0 ? body.quotes[0] : null
          if (found === null) {
            const reason = Array.isArray(body.errors) && body.errors.length > 0 ? body.errors[0].reason : null
            setAddError(reason === 'UNKNOWN_SYMBOL' ? t('badSymbol') : t('noSuchSymbol'))
            return
          }
          addCandidate(found)
        } catch {
          setAddError(t('fetchFailed'))
        } finally {
          setAdding(false)
        }
      }

      const selectedQuote = selected === null ? null : quotes.find(quote => quote.key === selected) ?? null
      const errorKeys = new Set(errors.map(entry => entry.key))
      const pending = symbols.filter(symbol => !quotes.some(quote => quote.key === symbol) && !errorKeys.has(symbol))
      /** Newest upstream tick across the pane: the honest "as of" moment, unlike the fetch time. */
      const latestQuoteAt = quotes.reduce((latest, quote) => {
        if (typeof quote.quoteTime !== 'string') return latest
        return latest === null || quote.quoteTime > latest ? quote.quoteTime : latest
      }, null)

      const cardStyle = {
        // Fixed to the window, not to the frame: the pane roams the whole
        // screen, including the title-bar strip and every column.
        position: 'fixed',
        width: collapsed ? 'auto' : `min(${PANE_WIDTH}px, calc(100vw - 16px))`,
        minWidth: collapsed ? 132 : undefined,
        ...(position === null ? { right: 24, bottom: 88 } : { left: position.left, top: position.top }),
        display: 'flex',
        flexDirection: 'column',
        maxHeight: 'calc(100vh - 32px)',
        border: `1px solid ${C.border}`,
        borderRadius: C.radiusPane,
        background: 'var(--dsw-alias-bg-layer-2)',
        boxShadow: 'var(--dsw-shadow-lv2)',
        color: C.text,
        fontSize: 12,
        overflow: 'hidden',
        transition: dragging ? 'none' : 'box-shadow 120ms ease',
        userSelect: dragging ? 'none' : 'auto',
        // Never hand a drag over the window's own title bar to the OS.
        WebkitAppRegion: 'no-drag',
      }

      const header = h('div', {
        onPointerDown: onDragStart,
        onPointerMove: onDragMove,
        onPointerUp: onDragEnd,
        onPointerCancel: onDragEnd,
        onDoubleClick: onResetPlacement,
        title: t('drag'),
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          height: 30,
          padding: '0 6px 0 8px',
          borderBottom: `1px solid ${collapsed ? 'transparent' : C.border}`,
          cursor: dragging ? 'grabbing' : 'grab',
          touchAction: 'none',
          flex: '0 0 auto',
        },
      },
      h('span', { 'aria-hidden': true, style: { color: C.tertiary, letterSpacing: 1, fontSize: 10 } }, '⣿'),
      h('span', { style: { color: C.secondary, fontWeight: 500 } }, t('label')),
      h('span', {
        'aria-hidden': true,
        style: {
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: status === 'error' ? C.bad : status === 'live' ? C.ok : status === 'idle' ? C.border : C.warn,
        },
      }),
      h('span', {
        title: asOf === null ? undefined : `${t('fetchedAt')} ${fmtClock(asOf)}`,
        style: { color: C.tertiary, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' },
      }, status === 'error'
        ? t('error')
        : status === 'idle' || !configReady
          ? ''
          : `${t('updated')} ${latestQuoteAt === null ? '—' : fmtClock(latestQuoteAt, false)}${sessionOpen ? '' : ` · ${t('closed')}`}`),
      h('span', { style: { flex: 1 } }),
      collapsed ? null : iconButton(t('refresh'), '↻', () => {
        setStatus(current => (current === 'live' ? current : 'loading'))
        if (tickRef.current !== null) tickRef.current()
      }),
      iconButton(collapsed ? t('expand') : t('collapse'), collapsed ? '▴' : '▾', () => {
        setCollapsed(current => {
          writeCollapsed(!current)
          return !current
        })
      }))

      const list = collapsed ? null : h('div', {
        style: {
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
          padding: '4px',
          overflowY: 'auto',
          minHeight: 0,
          maxHeight: 260,
        },
      },
      !configReady ? h('div', { style: { padding: '6px 8px', color: C.tertiary } }, t('loading')) : null,
      configReady && symbols.length === 0
        ? h('div', { style: { padding: '6px 8px', color: C.tertiary } }, t('empty'))
        : null,
      quotes.map(quote => h(QuoteRow, {
        key: quote.key,
        quote,
        active: quote.key === selected,
        onClick: () => setSelected(current => (current === quote.key ? null : quote.key)),
      })),
      configReady && pending.length > 0 && quotes.length === 0
        ? h('div', { style: { padding: '6px 8px', color: C.tertiary } }, t('loading'))
        : null,
      configReady && quotes.length > 0
        ? pending.map(symbol => h('div', {
          key: `pending-${symbol}`,
          title: t('loading'),
          style: { padding: '2px 10px', color: C.tertiary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
        }, symbol))
        : null,
      errors.map(entry => h('div', {
        key: `error-${entry.key}`,
        title: t('noSuchSymbol'),
        style: { padding: '2px 10px', color: C.tertiary, textDecoration: 'line-through', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      }, entry.key)))

      const detailBlock = collapsed || selectedQuote === null ? null : h('div', {
        style: {
          margin: '0 4px 4px',
          padding: '8px 10px',
          border: `1px solid ${C.border}`,
          borderRadius: C.radius,
          background: C.surface,
        },
      },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 } },
        h('span', { style: { fontWeight: 600 } }, selectedQuote.name ?? selectedQuote.key),
        h('span', { style: { color: C.tertiary } }, selectedQuote.code ?? ''),
        h('span', {
          style: {
            padding: '0 5px',
            border: `1px solid ${C.border}`,
            borderRadius: C.radiusSm,
            color: C.tertiary,
            fontSize: 11,
          },
        }, DETAIL_LABELS.market[selectedQuote.market ?? 'OTHER'] ?? selectedQuote.market ?? ''),
        h('span', { style: { flex: 1 } }),
        iconButton(t('remove'), '−', () => removeSymbol(selectedQuote.key)),
        iconButton(t('close'), '×', () => setSelected(null))),
      h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 } },
        h('span', {
          style: { fontSize: 20, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: trendColor(selectedQuote.changePct) },
        }, fmtPrice(selectedQuote.price)),
        h('span', { style: { color: trendColor(selectedQuote.changePct), fontVariantNumeric: 'tabular-nums' } },
          `${fmtChange(selectedQuote.change)}  ${fmtPct(selectedQuote.changePct)}`)),
      h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 12px', marginBottom: 6 } },
        h(Metric, { label: DETAIL_LABELS.open, value: fmtPrice(selectedQuote.open) }),
        h(Metric, { label: DETAIL_LABELS.high, value: fmtPrice(selectedQuote.high) }),
        h(Metric, { label: DETAIL_LABELS.low, value: fmtPrice(selectedQuote.low) }),
        h(Metric, { label: DETAIL_LABELS.prevClose, value: fmtPrice(selectedQuote.prevClose) }),
        h(Metric, { label: DETAIL_LABELS.amount, value: fmtAmount(selectedQuote.amount) }),
        h(Metric, { label: DETAIL_LABELS.quoteTime, value: selectedQuote.quoteTime === null ? '—' : fmtClock(selectedQuote.quoteTime) })),
      detail === null || detail.status === 'loading'
        ? h('div', { style: { color: C.tertiary, height: CHART_H, display: 'flex', alignItems: 'center' } }, DETAIL_LABELS.trendLoading)
        : detail.status === 'error'
          ? h('div', { style: { color: C.tertiary, height: CHART_H, display: 'flex', alignItems: 'center' } }, DETAIL_LABELS.trendError)
          : h(Sparkline, { trend: detail.trend, label: DETAIL_LABELS.trend }))

      const notices = collapsed ? null : h('div', { style: { padding: '0 8px', flex: '0 0 auto' } },
      status === 'error' && configReady && message !== null && quotes.length === 0
        ? h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, paddingBottom: 4, color: C.tertiary, fontSize: 11 } },
          h('span', { style: { color: C.bad } }, t('error')),
          h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 } }, message),
          h('button', {
            type: 'button',
            onClick: () => {
              setMessage(null)
              setStatus('loading')
              setReloadToken(token => token + 1)
            },
            style: {
              border: `1px solid ${C.border}`,
              borderRadius: C.radiusSm,
              background: 'transparent',
              color: C.secondary,
              font: 'inherit',
              fontSize: 11,
              padding: '1px 8px',
              cursor: 'pointer',
              flex: '0 0 auto',
            },
          }, t('retry')))
        : null,
      errors.length > 0 && quotes.length > 0
        ? h('div', {
          style: { paddingBottom: 4, color: C.tertiary, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
        }, `⚠ ${t('partialError')}${errors.map(entry => entry.key).join('、')}`)
        : null)

      const matches = suggest.query === draft.trim() ? suggest.items : []
      const suggestionList = !addOpen || matches.length === 0 ? null : h('div', {
        role: 'listbox',
        'aria-label': t('add'),
        style: {
          display: 'flex',
          flexDirection: 'column',
          maxHeight: 156,
          overflowY: 'auto',
          border: `1px solid ${C.border}`,
          borderRadius: C.radiusSm,
          background: C.surface,
        },
      },
      matches.map((item, index) => h('button', {
        key: item.key,
        type: 'button',
        role: 'option',
        'aria-selected': index === highlight,
        onMouseDown: event => event.preventDefault(),
        onClick: () => addCandidate(item),
        onMouseEnter: () => setHighlight(index),
        style: {
          display: 'flex',
          alignItems: 'baseline',
          gap: 6,
          width: '100%',
          padding: '4px 8px',
          border: 'none',
          background: index === highlight ? C.surfaceActive : 'transparent',
          color: C.text,
          font: 'inherit',
          fontSize: 12,
          textAlign: 'left',
          cursor: 'pointer',
        },
      },
      h('span', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, item.name),
      h('span', { style: { color: C.tertiary, fontVariantNumeric: 'tabular-nums' } }, item.code),
      h('span', {
        style: {
          padding: '0 4px',
          border: `1px solid ${C.border}`,
          borderRadius: C.radiusSm,
          color: C.tertiary,
          fontSize: 10,
        },
      }, t(`market.${item.market ?? 'OTHER'}`)))))

      const addArea = collapsed ? null : h('div', {
        style: { padding: '6px 8px', borderTop: `1px solid ${C.border}`, flex: '0 0 auto' },
      },
      addOpen
        ? h('form', { onSubmit: submitAdd, style: { display: 'flex', flexDirection: 'column', gap: 6 } },
          h('input', {
            value: draft,
            onChange: event => setDraft(event.target.value),
            onKeyDown: event => {
              event.stopPropagation()
              if (event.key === 'Escape') {
                setAddOpen(false)
                setDraft('')
                setAddError(null)
                setSuggest({ status: 'idle', items: [], query: '' })
              } else if (event.key === 'ArrowDown') {
                event.preventDefault()
                setHighlight(current => Math.min(current + 1, Math.max(0, matches.length - 1)))
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                setHighlight(current => Math.max(0, current - 1))
              }
            },
            placeholder: t('addPlaceholder'),
            'aria-label': t('addPlaceholder'),
            'aria-autocomplete': 'list',
            'aria-expanded': matches.length > 0,
            spellCheck: false,
            autoFocus: true,
            style: {
              width: '100%',
              height: 24,
              padding: '0 8px',
              border: `1px solid ${C.border}`,
              borderRadius: C.radiusSm,
              background: 'transparent',
              color: C.text,
              font: 'inherit',
              fontSize: 12,
              outline: 'none',
            },
          }),
          suggestionList,
          suggest.status === 'loading' && matches.length === 0
            ? h('div', { style: { color: C.tertiary, fontSize: 11 } }, t('searching'))
            : null,
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
            h('button', {
              type: 'submit',
              disabled: adding,
              style: {
                height: 24,
                padding: '0 10px',
                border: `1px solid ${C.border}`,
                borderRadius: C.radiusSm,
                background: C.surface,
                color: C.text,
                font: 'inherit',
                fontSize: 12,
                cursor: adding ? 'default' : 'pointer',
                opacity: adding ? 0.6 : 1,
              },
            }, t('addSymbol')),
            h('button', {
              type: 'button',
              onClick: () => {
                setAddOpen(false)
                setDraft('')
                setAddError(null)
              },
              style: {
                height: 24,
                padding: '0 10px',
                border: '1px solid transparent',
                borderRadius: C.radiusSm,
                background: 'transparent',
                color: C.secondary,
                font: 'inherit',
                fontSize: 12,
                cursor: 'pointer',
              },
            }, t('cancel')),
            h('span', { style: { flex: 1 } }),
            h('button', {
              type: 'button',
              onClick: resetSymbols,
              style: {
                height: 24,
                padding: '0 4px',
                border: '1px solid transparent',
                borderRadius: C.radiusSm,
                background: 'transparent',
                color: C.tertiary,
                font: 'inherit',
                fontSize: 12,
                cursor: 'pointer',
              },
            }, t('reset'))),
          addError === null ? null : h('span', { style: { color: C.bad, fontSize: 11 } }, addError))
        : h('button', {
          type: 'button',
          onClick: () => {
            setAddOpen(true)
            setAddError(null)
          },
          style: {
            width: '100%',
            height: 24,
            border: `1px dashed ${C.border}`,
            borderRadius: C.radiusSm,
            background: 'transparent',
            color: C.secondary,
            font: 'inherit',
            fontSize: 12,
            cursor: 'pointer',
          },
          onMouseEnter: (event) => {
            event.currentTarget.style.background = C.hover
            event.currentTarget.style.color = C.text
          },
          onMouseLeave: (event) => {
            event.currentTarget.style.background = 'transparent'
            event.currentTarget.style.color = C.secondary
          },
        }, `+ ${t('add')}`))

      return h('div', { ref: cardRef, style: cardStyle, 'data-stock-pane': '' },
        header, notices, list, detailBlock, addArea)
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh: DICT.zh, en: DICT.en }), 'stock-watch: dictionaries')
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'stock-watch',
          order: 10,
          locale: NS,
        }, StockPane))
      },
    }
  },
})
