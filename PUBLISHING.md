# 发布与上架清单

包名 `dsh-stock-watchlist`，版本 1.0.0。

## 已完成

- ✅ 仓库：<https://github.com/chenxiaomao123/dsh-stock-watchlist>（public，15 个文件，topic `dsh-plugin` 已加）
- ✅ 包名为 npm 上未占用，`npm pack --dry-run` 通过：13 个文件 / 28.2 kB
- ✅ 本机 profile 已按这个包名安装并激活，浮窗与 `stock_watch` 工具都在跑

## 待办

### 1. 发 npm（需要账号登录）

```powershell
npm login
npm publish --access public
npm view dsh-stock-watchlist version
```

发布后任何人可以 `dsh plugin --profile web add dsh-stock-watchlist` 直接安装。

### 2. 提 PR 进市场列表

市场只读社区列表 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)，要求仓库**建满 1 天**、带 `dsh-plugin` topic、`package.json` 声明 `dsh.bundle`（都满足）。

本仓库建于 2026-11-13 13:20 UTC，因此 **2026-11-14 13:20 UTC（北京时间 21:20）之后**再提：

- fork `awesome-dsh-plugin/awesome-dsh-plugin`
- 新增 `data/plugins/chenxiaomao123__dsh-stock-watchlist.yml`，内容见本仓库 `market-entry.yml`
- PR 标题 `Add chenxiaomao123/dsh-stock-watchlist`

合并后市场通常一天内自动收录。

## 市场里的同类插件

`dsh-stock-watch`、`dsh-stock-ticker`、`dsh-stock-strip`、`dsh-stock-quotes`、`dsh-openfin` 都已上架。本插件的差异点：可拖动的全屏浮窗（`shell.overlay`）+ 中文名称搜索 + 开市时段门控刷新 + `stock_watch` 工具与界面共用同一份行情。
