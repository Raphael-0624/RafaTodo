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

## 阿里云生产部署

下面以 Ubuntu 22.04/24.04、Docker Compose 和一个已经解析到服务器的域名为例。2 核 2 GB 可以运行；应用只绑定服务器本机的 `3001` 端口，公网访问交给 Nginx。

### 1. 安装依赖并拉代码

```sh
sudo apt update
sudo apt install -y git ca-certificates curl nginx
curl -fsSL https://get.docker.com | sudo sh
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
```

重新登录 SSH 后确认 Docker 可用：

```sh
docker --version
docker compose version
git clone <你的仓库地址> RafaTodo
cd RafaTodo
```

如果仓库是私有仓库，先在服务器配置 SSH key，再使用 SSH 地址 clone。

### 2. 设置登录密码并启动

密码通过 `.env` 注入容器，不要把它提交到 Git：

```sh
printf 'APP_PASSWORD=%s\n' "$(openssl rand -hex 24)" > .env
chmod 600 .env
docker compose up -d --build
docker compose ps
curl -I http://127.0.0.1:3001
```

打开 `http://服务器IP:3001` 只能用于本机排查；正式使用应继续配置 HTTPS。浏览器弹出原生登录框时，用户名可以填写任意值，密码就是 `.env` 中的 `APP_PASSWORD`。

### 3. 用 Nginx 暴露域名

将下面内容保存为 `/etc/nginx/sites-available/rafatodo`，把域名替换成自己的域名：

```nginx
server {
    listen 80;
    server_name todo.example.com;
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

启用配置并申请 HTTPS 证书：

```sh
sudo ln -s /etc/nginx/sites-available/rafatodo /etc/nginx/sites-enabled/rafatodo
sudo nginx -t && sudo systemctl reload nginx
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d todo.example.com
```

阿里云安全组只需要放行 `80`、`443` 和 SSH；不需要放行 `3001`。域名 DNS 的 A 记录指向服务器公网 IP。

### 4. 更新版本

```sh
cd RafaTodo
git pull --ff-only
docker compose up -d --build
docker compose logs --tail=100 rafatodo
```

`./data` 是宿主机目录，会挂载到容器的 `/data`，重建容器不会删除任务和图片。不要使用 `docker compose down -v`，否则会删除挂载卷。

### 5. 备份和恢复

SQLite 使用 WAL，备份前短暂停止服务最稳妥：

```sh
cd RafaTodo
docker compose stop
tar -czf "rafatodo-data-$(date +%F).tgz" data
docker compose start
```

恢复时停止服务，将备份解压覆盖 `data` 后再启动：

```sh
docker compose stop
tar -xzf rafatodo-data-2026-10-09.tgz
docker compose start
```

页面中的 JSON 导出只包含条目和元数据，不包含图片二进制；完整备份必须包含整个 `data/uploads` 目录。查看故障时使用 `docker compose logs -f rafatodo`。
