# 部署到自己的服务器

从一台空机器到「手机上能用」，大概 10 分钟。

## 需要什么

- 一台 VPS：**1 核 1G 就够**。数据量是纯文本，几百条笔记不到 1MB
- Ubuntu 22.04 / Debian 12（别的发行版把 `apt` 换成对应的包管理器就行）
- **一个域名**（强烈建议）。不是必须有，但没有 HTTPS 的话：
  - PWA 装不到手机主屏（浏览器只在 HTTPS 或 localhost 下允许）
  - 代码块右上角的「复制」会失效（`navigator.clipboard` 要求安全上下文）
  - Service Worker 起不来，断网打不开

## 1. 装 Docker

```bash
curl -fsSL https://get.docker.com | sh
```

## 2. 拿到代码并启动

```bash
git clone https://github.com/HiwwHi/nicenotes.git
cd nicenotes
docker compose up -d --build
```

这时候 `http://服务器IP:8787` 已经能打开了，但先别急着用——下面配 HTTPS。

数据在 Docker 卷 `nicenotes-data` 里，删容器不丢。

## 3. 配 HTTPS

用 Caddy，它会自动申请和续期证书，不用自己折腾 certbot。

先把域名 A 记录指到这台机器的 IP，然后改 `docker-compose.yml`：

```yaml
services:
  nicenotes:
    build: .
    image: nicenotes:latest
    restart: unless-stopped
    # 注意：去掉了 ports，改成只在 Docker 网络内暴露
    environment:
      PORT: '8787'
      DB_PATH: /data/nicenotes.sqlite
    volumes:
      - nicenotes-data:/data

  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports:
      - '80:80'
      - '443:443'
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
      - caddy-config:/config
    depends_on:
      - nicenotes

volumes:
  nicenotes-data:
  caddy-data:
  caddy-config:
```

同目录新建 `Caddyfile`，把 `notes.example.com` 换成你的域名：

```
notes.example.com {
    reverse_proxy nicenotes:8787
}
```

然后：

```bash
docker compose up -d
```

证书几秒内自动签好。打开 `https://notes.example.com` 应该就是你的笔记。

> 服务器在国内的话，80 端口要能对外（Let's Encrypt 验证用），并且域名得备案过。

## 4. 装到手机和电脑上

- **iPhone**：Safari 打开站点 → 分享 → 添加到主屏幕。或者打开 `/nicenotes.mobileconfig` 装描述文件，图标会自己出现
- **Android**：Chrome 打开后会提示「添加到主屏幕」
- **电脑**：Chrome / Edge 地址栏右侧有安装图标，点一下变成独立窗口

装完就是全屏的，没有地址栏。

## 5. 备份

数据就一个 SQLite 文件（外加 `-wal` / `-shm`）。整个 `/data` 一起打包最稳，恢复时一起放回去就行：

```bash
docker run --rm \
  -v nicenotes-data:/data \
  -v "$(pwd)":/backup \
  alpine tar czf /backup/nicenotes-$(date +%F).tar.gz -C /data .
```

放进 crontab，每天凌晨备份一次、保留最近 7 天：

```cron
0 3 * * * cd /root/nicenotes && docker run --rm -v nicenotes-data:/data -v "$(pwd)":/backup alpine tar czf /backup/nicenotes-$(date +\%F).tar.gz -C /data . && ls -t /backup/nicenotes-*.tar.gz | tail -n +8 | xargs -r rm
```

恢复：

```bash
docker compose down
docker run --rm -v nicenotes-data:/data -v "$(pwd)":/backup alpine \
  sh -c "rm -rf /data/* && tar xzf /backup/nicenotes-2026-11-15.tar.gz -C /data"
docker compose up -d
```

## 6. 升级

```bash
git pull
docker compose up -d --build
```

数据库迁移在服务启动时自动跑（加字段这类变更会自己补上），不用手动执行 SQL。

## 常见问题

**打开是 502**

Caddy 起来了但后端没起来。`docker compose logs nicenotes` 看日志。

**手机提示「无法安装」**

多半是 HTTPS 没生效，或者证书还没签下来。浏览器访问一次看有没有证书警告。

**忘记密码了**

没有找回流程（不依赖邮件服务）。直接在数据库里删掉这个用户，重新注册：

```bash
docker run --rm -v nicenotes-data:/data alpine \
  sh -c "apk add --no-cache sqlite && sqlite3 /data/nicenotes.sqlite \"DELETE FROM users WHERE email='you@example.com';\""
```

笔记会跟着用户一起删（外键级联）。所以先导出备份。

**想换机器**

旧机器上做一次备份，新机器按上面的步骤装好，把 `/data` 恢复进去，域名解析改过去就行。

**只想自己用，不开放注册**

启动时加一个环境变量就行，注册接口会返回 403，前端也不会显示注册入口：

```yaml
    environment:
      ALLOW_REGISTER: '0'
```

注意顺序：**先把自己的账号注册好，再关掉**，否则连自己都注册不了。
