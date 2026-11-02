---
name: start-covis-prob
description: Start, restart, or restore the COViS Prob production viewer (T2I-Explorer and Scoring modes) on port 4173 and its existing covis.ouruizhe.top tunnel. Use for 正式版, prob 版, 启动实验浏览器, or 恢复代理访问; use start-covis-dev for the component annotation viewer on 4180.
---

# 启动 COViS Prob 版（4173）

应用名为 COViS，包含 T2I-Explorer（`/`）与 Scoring（`/scoring`）两个模式，规范公网地址为 `https://covis.ouruizhe.top`。旧域名 `dive.ouruizhe.top` 仍在 tunnel ingress 中，由应用通过 `COVIS_REDIRECT_HOSTS` 与 `COVIS_CANONICAL_ORIGIN` 以 302 跳到规范域名下的相同路径和查询；跳转先于 Host 白名单检查，因此它不在 `T2I_ALLOWED_HOSTS` 中。`explorer.ouruizhe.top` 仍直接提供应用，保留在白名单中。Scoring 数据根目录用 `T2I_SCORING_ROOT`（默认 `<repo>/data/scoring`）。

`prob` 是用户对正式版的命名。构建当前代码，使用 systemd 用户服务常驻运行，并通过已有 Cloudflare Tunnel 提供访问。默认本地端口 **4173**，公网地址 **https://covis.ouruizhe.top**；用户指定的域名、端口、数据根目录优先。组件标注版使用另一个 skill [start-covis-dev](../start-covis-dev/SKILL.md)，默认 4180。

## 本机约定

| 项目 | 默认值 |
| --- | --- |
| 仓库 | 当前 COViS checkout；否则取本 skill 目录真实路径的 `../../..`；最后检查 `$HOME/COViS`（`$HOME/T2I-Explorer` 是为旧路径保留的指向 `COViS` 的符号链接） |
| Origin | `http://127.0.0.1:4173` |
| 数据 | `<repo>/data/datasets`，或用户指定的 `T2I_DATA_ROOT`；Scoring 数据 `<repo>/data/scoring`（`T2I_SCORING_ROOT`） |
| Node | `.node-version`；本机安装在 `$HOME/.local/opt/node-v24.21.0-linux-x64/bin` |
| Tunnel 配置 | `$HOME/.cloudflared/covis.yml` |
| 用户服务 | `covis.service`、`covis-tunnel.service`；代理中继为 `covis-relay.service` |
| Tunnel readiness | `http://127.0.0.1:20241/ready`，使用现有配置中的 metrics 地址 |
| 日志 | `journalctl --user -u covis -u covis-tunnel -u covis-relay` |

仓库 `package.json` 名称应为 `t2i-explorer`。本机默认 Node 可能来自 Anaconda；先把正确 Node 的 bin 目录加入 PATH，确认 `node --version`、`pnpm --version` 与 `package.json` 一致。以下变量由实际检查结果赋值，不把占位符写进配置。

## 启动流程

1. 用 `systemctl --user status`、`systemctl --user cat` 和 `ss -ltnp` 确认服务、端口和 checkout。读取 tunnel 配置的 `tunnel`、`credentials-file`、ingress，确认凭据文件存在，不输出凭据内容。保留既有数据目录和认证配置。端口若被其他项目占用，报告冲突，不按端口批量杀进程。
2. 在选定仓库执行 `pnpm install --frozen-lockfile && pnpm build`，成功后再重启。构建后必须重启应用：静态资源路由在启动时注册，仅更新 dist 会导致新文件名无法匹配原进程的路由。生产入口为 `dist-server/server/index.js`。
3. 检查或创建 `$HOME/.config/systemd/user/covis.service`，使用实际绝对路径并保留已有兼容设置。规范域名和仍直接提供本应用的旧 ingress 域名（`explorer.ouruizhe.top`）保留在 Host 白名单中；配置为跳转的旧域名（`dive.ouruizhe.top`）只放在 `COVIS_REDIRECT_HOSTS`。即使绑定 loopback，也需 `T2I_ALLOW_NETWORK=true` 才能启用自定义白名单。

   ```ini
   [Unit]
   Description=COViS web service
   After=network-online.target
   Wants=network-online.target

   [Service]
   Type=simple
   WorkingDirectory=<absolute-repo>
   Environment="HOST=127.0.0.1"
   Environment="PORT=4173"
   Environment="T2I_DATA_ROOT=<absolute-repo>/data/datasets"
   Environment="T2I_SCORING_ROOT=<absolute-repo>/data/scoring"
   Environment="T2I_ALLOW_NETWORK=true"
   Environment="T2I_ALLOWED_HOSTS=covis.ouruizhe.top,explorer.ouruizhe.top,127.0.0.1,localhost"
   Environment="COVIS_REDIRECT_HOSTS=dive.ouruizhe.top"
   Environment="COVIS_CANONICAL_ORIGIN=https://covis.ouruizhe.top"
   ExecStart=<absolute-node> <absolute-repo>/dist-server/server/index.js
   Restart=on-failure
   RestartSec=5

   [Install]
   WantedBy=default.target
   ```

   当前部署中 `<absolute-repo>` 为 `/home/quruizhe/COViS`，`<absolute-node>` 为 `/home/quruizhe/.local/opt/node-v24.21.0-linux-x64/bin/node`。

4. 在原位置备份 tunnel 配置，保留 tunnel ID、凭据路径、原 ingress、originRequest 及 `protocol`、`edge`、`metrics`、`no-prechecks` 设置。当前机器通过本机代理连接 Cloudflare，不能删除 loopback edge 配置或 tunnel 的 relay 服务依赖。需要修复中继时阅读 [部署说明](../../../tools/tunnel-proxy-relay.md)。在末尾 catch-all **之前**添加或更新目标 hostname，避免重复规则。默认 ingress：

   ```yaml
   - hostname: covis.ouruizhe.top
     service: http://127.0.0.1:4173
   - hostname: dive.ouruizhe.top
     service: http://127.0.0.1:4173
   - hostname: explorer.ouruizhe.top
     service: http://127.0.0.1:4173
   ```

   `dive.ouruizhe.top` 是保留的旧域名，请求到达应用后被 302 跳到 `https://covis.ouruizhe.top`，因此必须保留其 ingress 规则。

   保留末尾的原 catch-all（通常为 `- service: http_status:404`）。自定义端口时同步修改 origin、服务 PORT，以及所有仍代理本应用的旧域名规则的 service；其他应用的规则保持原值。配置和凭据留在 `$HOME/.cloudflared`，不提交到 Git。验证规则命中目标 origin：

   ```bash
   cloudflared --config "$tunnel_config" tunnel ingress validate
   cloudflared --config "$tunnel_config" tunnel ingress rule "https://$domain/"
   ```

   现有公网地址能返回应用内容时，无需重写 DNS。需要新增或修复 DNS 时，使用配置中的真实 tunnel ID：

   ```bash
   env -u TUNNEL_FORCE_PROVISIONING_DNS cloudflared tunnel route dns "$tunnel_id" "$domain"
   ```

   相同路由可重复执行；域名已指向其他目标时报告冲突，不加 `--overwrite-dns`。缺少配置、凭据或 DNS 管理授权时明确报告缺项，不改用随机 trycloudflare 域名。已有域名仅 DNS 管理检查超时、但本地与公网验证正常时，报告该检查限制即可。
5. 复用 `covis-tunnel.service`。不存在时创建用户 unit，设置 `After=network-online.target covis.service covis-relay.service`、`Wants=network-online.target covis-relay.service`、`Requires=covis.service`、`Restart=on-failure`、`RestartSec=5`、`WantedBy=default.target`，并填写实际路径：

   ```ini
   ExecStart=<absolute-cloudflared> --no-autoupdate --config <absolute-tunnel-config> tunnel run
   ```

   relay 依赖直接写在 `covis-tunnel.service` 中，不使用 drop-in。执行 `systemctl --user daemon-reload`，启用应用、relay 及 tunnel unit。重启应用并通过下述本地检查后，再重启 tunnel。已有同一 tunnel 的进程应复用其服务管理器，不另启携带旧 ingress 的重复 connector。没有用户 systemd 会话时，报告环境限制和具体启动命令。

## 验收与排错

等待应用健康最多 60 秒，每次 curl 超时 10 秒；失败时查看日志，不无限重启。检查：

```bash
curl --fail --silent --show-error --max-time 10 "$origin/api/health"
curl --fail --silent --show-error --max-time 10 -H "Host: $domain" "$origin/api/health"
curl --fail --silent --show-error --max-time 10 -H "Host: $domain" "$origin/api/catalog"
curl --fail --silent --show-error --max-time 10 http://127.0.0.1:20241/ready
curl --silent --show-error --max-time 15 -D - "https://$domain/api/health"
curl --silent --show-error --max-time 15 -o /dev/null -w '%{http_code} %{redirect_url}\n' "https://dive.ouruizhe.top/scoring?x=1"
```

`$domain` 默认为 `covis.ouruizhe.top`。

前两个响应应为 `{"status":"ok"}`；catalog 应返回 JSON；旧域名应返回 `302 https://covis.ouruizhe.top/scoring?x=1`。metrics 地址以现有 tunnel 配置为准，`/ready` 应为 HTTP 200 且 `readyConnections > 0`；systemd 的 running 不能替代连通性检查。公网检查状态码、Content-Type 和正文，不能把 Cloudflare 错误页或 Access 登录页当作应用健康。已有 Access 认证时保留策略并说明需要登录；分别报告本地健康与公网验证结果。530 / 1033 先检查 tunnel readiness 与连接日志；502 核对 origin；403 区分 Host 拒绝与 Access。

最后给出公网地址、本地地址、服务状态和日志命令。仅编写或离线验证本 skill 时，不修改 DNS 或重启真实服务；可用临时配置检查 ingress，用独立测试端口验证 Host 白名单。
