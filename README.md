# RafaTodo

个人多类型内容管理台。Work / Life / Glean & Idea 三栏常驻，支持 Todo、文案、链接、图片。WORK 默认占 50% 宽度，桌面端可拖动左右及右侧上下分隔线，比例保存在当前浏览器；分隔线也支持方向键调整、Home 恢复均分。每栏独立滚动，移动端纵向排列。条目悬浮显示取消和删除操作：取消标记为已移除且可恢复；永久删除前会确认，子条目保留并提升一级，相关依赖与关联清理。编辑任务时隐藏 Markdown 复选框前缀并保留原状态。SQLite 保存最新条目及创建、更新、完成和移除时间，不保存变更历史。

## 本地运行

需要 Node.js 24。

```sh
npm install
INITIAL_PASSWORD='你的密码' node scripts/set-password.mjs
npm run dev
```

访问 http://localhost:5173 。进入页面需要登录。设置命令可重复运行以修改密码，数据库只保存加盐哈希；修改后重启服务，使旧登录会话失效。数据在 `data/rafa.sqlite`，图片在 `data/uploads`。点击栏目底部直接开始写，回车或点击空白处提交，Shift + 回车换行，Esc 取消。内容使用轻量 Markdown 语法：`@负责人`、`#标签`、`!重要`、`!!紧急`、`due:2026-10-12`、`plan:日期`、`follow:日期`、`stage:阶段`、`字段::值`；`[[条目标题]]` 建立关联，`after:[[条目标题]]` 建立前置依赖。输入 `@` 或 `#` 会给出已有值的补全。拖动条目左侧把手可以排序，放到另一条目中部会成为子条目，拖到另一栏即可移动领域；Tab 缩进、Shift + Tab 取消缩进。原有 Glean 和 Idea 条目启动时自动并入 Glean & Idea。

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

登录校验直接读取 `data/rafa.sqlite` 中的密码哈希。页面先显示密码页，登录状态使用 HttpOnly Cookie 保存。再次运行设置命令可修改密码，随后重启服务。

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
