# RafaTodo

个人多类型内容管理台。Work / Life / Glean & Idea 三栏常驻，支持 Todo、文案、链接、图片。SQLite 保存最新条目及创建、更新、完成和移除时间，不保存变更历史。

## 本地运行

需要 Node.js 24。

```sh
npm install
npm run dev
```

访问 http://localhost:5173 。数据在 `data/rafa.sqlite`，图片在 `data/uploads`。点击栏目底部直接开始写，回车或点击空白处提交，Shift + 回车换行，Esc 取消。内容使用轻量 Markdown 语法：`@负责人`、`#标签`、`!重要`、`!!紧急`、`due:2026-10-12`、`plan:日期`、`follow:日期`、`stage:阶段`、`字段::值`；`[[条目标题]]` 建立关联，`after:[[条目标题]]` 建立前置依赖。输入 `@` 或 `#` 会给出已有值的补全。拖动条目左侧把手可以排序，放到另一条目中部会成为子条目，拖到另一栏即可移动领域；Tab 缩进、Shift + Tab 取消缩进。原有 Glean 和 Idea 条目启动时自动并入 Glean & Idea。

初始化示例：`node scripts/seed-obsidian.mjs` 会从本机 Obsidian 的 2026-09 和 2026-10 记录导入演示数据。该命令会追加条目，若要重置本地演示数据，可先删除 `data/rafa.sqlite` 和 `data/uploads` 后再运行。

## 生产部署

```sh
APP_PASSWORD='替换为强密码' docker compose up -d --build
```

应用监听本机 3001，通过 Nginx/Caddy 配置 HTTPS 反向代理。单用户使用浏览器原生登录框，用户名任意，密码使用 APP_PASSWORD。不要将开发服务直接公开。

2核2GB服务器可运行；建议本地构建镜像后上传服务器，降低构建内存需求。`data` 必须持久化，升级不删除它。

备份需使用 SQLite backup API，或停止应用后复制整个 `data` 目录（含图片和可能存在的 WAL 文件）。恢复时停止服务，替换目录，再启动。页面导出 JSON 包含条目元数据，不包含图片二进制。
