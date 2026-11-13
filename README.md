# Stock watch

A DSH bundle that floats a draggable quote pane over the app and exposes the
same feed to the agent.

- **Pane**: Shanghai, Shenzhen, Beijing, Hong Kong, and US symbols and indices,
  refreshed every 5 s. Click a row for today's minute chart; the footer's
  **Add a symbol** box takes a code *or a Chinese name* (`茅台`, `腾讯`, `比亚迪`,
  `贝特瑞`), lists the matches, and adds the one you pick; `−` in the detail
  block removes one, the chevron folds the pane into its title bar. Drag the
  title bar to move the pane anywhere in the window — it is fixed to the
  viewport, so it can float over the sidebar, the title-bar strip, or any
  column; double-click the title bar to send it back to its corner, and its
  position and folded state survive a reload (`localStorage`).
- **Tool**: `stock_watch` reads the same quote operation on demand (pass a
  `query` to resolve a Chinese name into symbols first), so the model can answer
  "how is 600519 doing" with the same numbers the pane shows.
- **Route**: the page reads `GET /plugin/stock-watch/config|quotes|trend|search`.

## Symbols

| Form | Example | Meaning |
|---|---|---|
| `sh`/`sz`/`bj` + 6 digits | `sh600519`, `sz000001`, `bj920185` | Shanghai / Shenzhen / Beijing stock or index |
| 6 digits | `600519`, `920185` | Exchange inferred from the leading digits (`6/9` Shanghai, `92/89/83/87/43` Beijing, rest Shenzhen) |
| `hk` + 5 digits | `hk00700` | Hong Kong stock |
| 5 digits | `00700` | Hong Kong stock |
| `us:TICKER` | `us:AAPL` | US stock; NASDAQ/NYSE/AMEX is probed automatically |
| `MARKET.CODE` | `105.AAPL`, `0.920185` | Raw upstream secid, no guessing |

## Configuration

The plugin row accepts an optional `config`. Editing it in `cordis.patch.yml`
survives upgrades:

```yaml
- id: stock-watch
  name: 'dsh-stock-watchlist'
  config:
    watchlist: ['sh000001', 'sz399001', 'sh600519', 'hk00700', '105.AAPL']
    refreshMs: 5000
    trendRefreshMs: 20000
    timeoutMs: 8000
```

`watchlist` defaults to 上证指数, 深证成指, 创业板指, 北证50 plus 贵州茅台,
宁德时代, 腾讯控股 and 苹果. Symbols added or removed in the pane are stored in
the browser (`localStorage`) and override the config list; **Reset to defaults**
clears that override.

Search covers the same boards: Shanghai (`600/601/603/605/688`), Shenzhen
(`000/001/002/300`), Beijing (`920/89/83/87/43`), Hong Kong, US, and the indices
of each. Beijing shares share upstream market id `0` with Shenzhen, so their
labels come from the code prefix.

## Refresh policy

Quotes are only polled while the pane is **expanded** and at least one watched
market is **in session** (Beijing time):

| Market | Session |
|---|---|
| Shanghai / Shenzhen / Beijing | 09:15–11:30, 13:00–15:00 |
| Hong Kong | 09:30–12:00, 13:00–16:00 |
| US | 21:30–05:00 next day (covers both DST offsets) |

- Opening the pane reads **once**, even outside those windows, so a closed market
  still shows its last print; the header then says `· 休市` and nothing polls
  until a session opens.
- Folded into its title bar, or with the page hidden, the pane makes **no
  requests at all**.
- The ↻ button always forces a single read.
- These are client HTTP reads: they do not consume model tokens. The
  `stock_watch` tool only runs when you or the model asks for it.

## Limits

- Quotes come from Eastmoney's public endpoint. It needs no key, but the feed
  decides freshness and availability, and each refresh sends the watchlist
  codes to `push2.eastmoney.com`.
- Intraday data is one day (09:30–15:00 for A-shares). US symbols report the
  previous session until their market opens.
- The Host halves need `tools` and `webServer`, so the plugin is inactive in a
  headless profile.
- Nothing is polled while the page is hidden; the pane is gone when the plugin
  is disabled.
- The pane lives in the frame-wide `shell.overlay` layer, so it stays on top of
  every column on every page; fold it into its title bar when it gets in the way.
