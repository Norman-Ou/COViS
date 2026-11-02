# Cloudflare Tunnel 代理中继

2026-10-13 排查中，本机两个 panoptic 数据集的 300 张缩略图均正常返回，浏览器首行约半秒显示；公网返回 HTTP 530 / Cloudflare 1033。隧道进程持续 QUIC 超时，直连 TCP/7844 也超时，但本机已有 HTTP 代理可以接通 Cloudflare。

`tunnel-proxy-relay.py` 只监听四个 loopback 端口，通过 HTTP CONNECT 连接固定的 Cloudflare tunnel 目的地。中继不解密 TLS，证书校验仍由 cloudflared 完成。只使用 Python 3.11+ 标准库。

当前用户服务 `~/.config/systemd/user/covis-relay.service`：

```ini
[Unit]
Description=Cloudflare edge connections through the local HTTP proxy
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/home/quruizhe/COViS
ExecStart=/usr/bin/python3 /home/quruizhe/COViS/tools/tunnel-proxy-relay.py --proxy-host 127.0.0.1 --proxy-port 7897
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

保留 `~/.cloudflared/covis.yml` 的 tunnel ID、凭据文件和 ingress，添加：

```yaml
protocol: http2
edge:
- 127.0.0.1:17844
- 127.0.0.1:17845
- 127.0.0.1:17846
- 127.0.0.1:17847
metrics: 127.0.0.1:20241
no-prechecks: true
```

`edge` 是当前 cloudflared 支持的自定义连接地址参数；升级 cloudflared 后需验证。中继只支持 TCP，因此关闭 UDP 连通性预检查，实际连接仍正常执行 TLS 校验和 tunnel 注册。

relay 依赖直接声明在 `~/.config/systemd/user/covis-tunnel.service` 中，不使用 drop-in：

```ini
[Unit]
After=network-online.target covis.service covis-relay.service
Wants=network-online.target covis-relay.service
Requires=covis.service
```

中继必须使用本机已有且可访问 Cloudflare TCP/7844 的代理。代理暂时不可用时，cloudflared 会重连；中继退出时 systemd 会重启它。更换机器需更新绝对路径和代理端口。生产配置及原配置备份留在用户目录，不提交凭据。

部署和验收：

```bash
python3 -m unittest discover -s tests -p 'tunnel_proxy_relay_test.py' -v
cloudflared --config ~/.cloudflared/covis.yml tunnel ingress validate
systemctl --user daemon-reload
systemctl --user enable --now covis-relay.service
systemctl --user restart covis-tunnel.service
curl --fail --max-time 10 http://127.0.0.1:4173/api/health
curl --fail --max-time 10 http://127.0.0.1:20241/ready
curl --fail --max-time 15 https://covis.ouruizhe.top/api/health
journalctl --user -u covis-relay -u covis-tunnel -n 30
```

`/ready` 必须返回 HTTP 200 且 `readyConnections` 大于零；公网健康接口必须返回应用 JSON `{"status":"ok"}`。单看进程 running 不代表已连通。取消中继时先恢复备份的 tunnel 配置，从 `covis-tunnel.service` 中移除 `covis-relay.service` 依赖，执行 daemon-reload，再停止中继并重启 tunnel。
