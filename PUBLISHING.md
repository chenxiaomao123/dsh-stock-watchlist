# 上架到 DSH 插件市场

## 现状（已全部就绪，只差两个账号动作）

- 包名 `dsh-stock-watchlist`，版本 1.0.0，npm 上确认可用。
- `npm pack --dry-run` 通过：13 个文件、28.2 kB（`index.js` / `client.js` / `lib` / `locale` / `docs` / `icon.svg` / `LICENSE` / `README`）。
- 本机 profile 已按这个包名安装并激活，界面与 `stock_watch` 工具都在跑。
- **GitHub 仓库上传包已打好**：`default-workspace/dsh-stock-watchlist-repo.zip`（15 个文件，解压后就是仓库根目录）。
- **PR 记录文件已备好**：本目录 `market-entry.yml`，只需把 `<owner>` 换成你的 GitHub 用户名。

## 市场规则（来自 awesome-dsh-plugin）

市场没有上传接口，只读社区列表，每条记录要求：

1. 一个**公开 GitHub 仓库**，`package.json` 里有 `dsh.bundle`（已有）；
2. 仓库**建满 1 天**，带 `dsh-plugin` topic；
3. 给 awesome-dsh-plugin 提 PR，新增 `data/plugins/<owner>__<repo>.yml`。

所以即使今天发完 npm、建好仓库，**最快也要明天**才能进列表。

## 剩下两步（需要你的账号）

### 1. 发 npm（一次登录）

在 PowerShell 里：

```powershell
npm login
```

成功后再告诉我，我执行 `npm publish --access public` 并核对 `npm view dsh-stock-watchlist`。
（如果你的账号对发布开了 2FA，把那一刻的 6 位码发我一次。）

### 2. 建 GitHub 仓库

- 新建一个 public 仓库，名字建议 `dsh-stock-watchlist`；
- 把 `dsh-stock-watchlist-repo.zip` 解压后**把里面的文件**拖进仓库上传；
- 仓库 Settings 里加 topic `dsh-plugin`；
- 明天起，把 `market-entry.yml` 改好（`url` / `name` 填 `你的用户名/dsh-stock-watchlist`），fork `awesome-dsh-plugin/awesome-dsh-plugin`，新增 `data/plugins/你的用户名__dsh-stock-watchlist.yml`，提 PR。

## 如果愿意给临时令牌

我可以代做 1、2 和 PR（fork + 建分支 + 提交 + 开 PR 都能走 GitHub REST API）：

- npm：Granular Access Token，只勾 **read and write** + publish，1 天有效期；
- GitHub：Fine-grained token，仅限这一个仓库，权限 `Contents: Read and write`、`Metadata: Read`；要开 PR 还得加 `Pull requests: Read and write`（和对 awesome-dsh-plugin 的 fork 权限）。

令牌只在环境变量里用一次，不落盘、不写进任何文件；用完即失效。
