# RafaTodo

个人多类型内容管理台。Work / Daily / Life / Glean & Idea 四栏常驻，支持 Todo、文案、链接、图片。WORK 默认占 50% 宽度，右侧依次为 DAILY、LIFE、GLEAN。拖动 WORK 分隔条调整右侧可用宽度时，右侧会在可用宽度不小于 900px 时三栏并排、660–899px 时双栏、小于 660px 时上下堆叠之间自动切换；DAILY、LIFE 的高度分隔线只在上下堆叠时出现，比例保存在当前浏览器。WORK 内部左右两栏的比例完全由你手动拖动决定，窄屏也不会自动切换成上下堆叠；两栏各自在底部新增条目，并分别记忆滚动位置。每栏标题固定，内容独立滚动，背景有淡色领域水印；移动端依次纵向排列。完成或取消的条目显示日期小字（yyyy/mm/dd完成或取消）。悬浮、点击、状态变化、删除和排序使用短暂过渡，系统启用减少动态效果时自动关闭。条目悬浮显示取消和删除操作：取消标记为已移除且可恢复；永久删除前会确认，子条目保留并提升一级，相关依赖与关联清理。编辑任务时隐藏 Markdown 复选框前缀并保留原状态。保存采用乐观更新：界面先落位，接口失败时自动回滚并可一键重试。SQLite 保存最新条目及创建、更新、完成和移除时间，不保存变更历史。

DAILY 是一组每天重复的日常事项，内容严格按输入原文保存，不解析为标签或 Markdown。每天按 `Asia/Shanghai` 自然日 00:00 自动全部恢复为未完成；只有手动勾选才计入累计次数，同一天重复勾选不会重复计数，当天取消勾选会撤回这一次。服务停机跨天后重新打开只显示当天状态，不补造未使用期间的记录。

## 本地运行

需要 Node.js 24。

```sh
npm install
INITIAL_PASSWORD='你的密码' node scripts/set-password.mjs
npm run dev
```

访问 http://localhost:5173 。进入页面需要登录。设置命令可重复运行以修改密码，数据库只保存加盐哈希；改密会立即清除所有旧会话，无需重启服务。登录会话保存在 SQLite，服务重启后仍保持登录。数据在 `data/rafa.sqlite`，图片在 `data/uploads`。点击栏目底部直接开始写，回车或点击空白处提交，Shift + 回车换行，Esc 取消；WORK 左右栏底部都有各自的写入入口。内容使用轻量 Markdown 语法：`%需求` 这类行首前缀会显示为圆角标签，`@负责人`、`#标签`、`!`、`!!`（界面显示为重要、紧急）、`due:2026-10-12`、`plan:日期`、`follow:日期`、`stage:阶段`、`字段::值`；`[[条目标题]]` 建立关联，`after:[[条目标题]]` 建立前置依赖。输入 `@`、`#` 或 `%` 会给出已有值的补全。拖动条目左侧把手可以排序，放到另一条目中部会成为子条目，拖到另一栏即可移动领域；Tab 缩进、Shift + Tab 取消缩进。原有 Glean 和 Idea 条目启动时自动并入 Glean & Idea。

### 维护命令

栏目归档会跳过带有每日（`!loop-day`）或每周（`!loop-week`）循环标记的任务，无论当前是否已完成或已取消；任务和累计完成次数保留在原栏目。有循环子任务的父条目也会保留，避免归档父条目后丢失任务层级。其他符合条件的普通任务仍正常归档。

```sh
# 检查 WORK 分栏归属并按列表重新压紧 position；默认只预览
node scripts/migrate-layout.mjs
node scripts/migrate-layout.mjs --apply

# 查找未被任何条目（含归档）引用的图片；默认不删除
node scripts/cleanup-uploads.mjs
node scripts/cleanup-uploads.mjs --apply
```

正常删除条目时服务端会自动清理不再被引用的图片。`cleanup-uploads.mjs` 用于清理历史遗留或上传后未保存的孤立文件；建议先备份 `data` 再执行 `--apply`。

### 分组与 Markdown

| 输入 | 效果 |
| --- | --- |
| `## 项目标题` | 可折叠分组，显示已完成/总任务数 |
| `%需求 登录页重做` | 标题前的圆角标签，前缀支持中文、字母、数字、`_`、`-`、`/` |
| `## 项目 sig:🚀 tone:sage` | 分组图标与浅底色，也可点击标题右侧图标选择 |
| `---` | 水平分隔线 |
| `- 普通分点` | 无复选框的列表条目，可拖拽形成层级 |
| `> 一段文案` | 无复选框的文字条目 |
| `==高亮==` | 重点高亮 |
| `**粗体**` / `*斜体*` | 文字强调 |
| `~~删除线~~` | 删除线 |
| `` `行内代码` `` | 行内代码 |
| `[名称](https://example.com)` | 链接 |
| `![说明](https://example.com/image.png)` | 图片 |

分组折叠状态、图标和底色保存到数据库；底色可选 `sage`、`sand`、`blue`、`rose`、`none`。计数包含嵌套子任务，不含取消任务和普通文字条目。把已有条目拖到分组标题中部即可纳入分组，也可点击分组末尾“写一条”新增。回车提交，Shift + 回车保留条目内换行。

初始化示例：`node scripts/seed-obsidian.mjs` 会从本机 Obsidian 的 2026-09 和 2026-10 记录导入演示数据。该命令会追加条目，若要重置本地演示数据，可先删除 `data/rafa.sqlite` 和 `data/uploads` 后再运行。

## 阿里云生产部署

下面以 Ubuntu 22.04/24.04、Node.js 24、PM2 和已解析到服务器的域名为例。应用只绑定服务器本机的 `3001` 端口，公网访问交给 Nginx。

### 1. 安装依赖并拉代码

```sh
sudo apt update
sudo apt install -y git ca-certificates curl nginx
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
git clone https://github.com/Rockelbel/RafaTodo.git RafaTodo
cd RafaTodo
```

### 2. 设置登录密码并启动

用一次性环境变量把密码哈希写入 SQLite，不要把密码提交到 Git：

```sh
npm ci
npm run build
INITIAL_PASSWORD='你的密码' node scripts/set-password.mjs
NODE_ENV=production pm2 start server.js --name rafatodo
pm2 save
pm2 startup
curl -I http://127.0.0.1:3001
```

如需启用 AI 录入，在启动 PM2 前配置 DeepSeek 环境变量（只放服务器环境，不要写入仓库）：

```sh
export DEEPSEEK_API_KEY='你的 DeepSeek API Key'
export DEEPSEEK_MODEL='deepseek-flash'
NODE_ENV=production pm2 start server.js --name rafatodo --update-env
```

页面右上角的闪光图标打开 AI 录入。输入一段自然语言后，服务端会识别一条或多条 Todo，先预览标题、领域、标签、截止日期和优先级，再点击“写入 Todo”。

登录校验直接读取 `data/rafa.sqlite` 中的密码哈希。页面先显示密码页，登录状态使用 HttpOnly Cookie 保存在 SQLite 会话表。再次运行设置命令可修改密码，旧会话立即失效，无需重启服务。

### 3. 用 Nginx 暴露域名

将下面内容保存为 `/etc/nginx/sites-available/rafatodo`：

```nginx
server {
    listen 80;
    server_name todo.rafa.love;
    client_max_body_size 12m;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```sh
sudo ln -s /etc/nginx/sites-available/rafatodo /etc/nginx/sites-enabled/rafatodo
sudo nginx -t && sudo systemctl reload nginx
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d todo.rafa.love
```

阿里云安全组只需要放行 `80`、`443` 和 SSH，不需要放行 `3001`。域名 DNS 的 A 记录指向服务器公网 IP。

### 4. 更新版本

```sh
cd RafaTodo
git pull --ff-only
npm ci
npm run build
pm2 restart rafatodo --update-env
pm2 logs rafatodo --lines 100
```

`./data` 是持久化目录，更新代码不会删除任务和图片。

### 5. 备份和恢复

SQLite 使用 WAL，备份前短暂停止服务最稳妥：

```sh
cd RafaTodo
pm2 stop rafatodo
tar -czf "rafatodo-data-$(date +%F).tgz" data
pm2 start rafatodo
```

恢复时停止服务，将备份解压覆盖 `data` 后再启动：

```sh
pm2 stop rafatodo
tar -xzf rafatodo-data-2026-10-09.tgz
pm2 start rafatodo
```

页面中的 JSON 导出只包含条目和元数据，不包含图片二进制；完整备份必须包含整个 `data/uploads` 目录。查看故障时使用 `pm2 logs rafatodo`。
