---
name: start-covis-dev
description: Start, restart, or restore the COViS Dev component annotation viewer on port 4180. Use for dev 版, 组件标注页, or 展示前端组件; use start-covis-prob for the production viewer on 4173.
---

# 启动 COViS Dev 版（4180）

启动原来的组件标注页面，在正式版界面上显示彩色组件边框、中文名称、组件目录及标注开关。默认地址 **http://localhost:4180/?dataset=sft-e6.0-r30**，用户指定的端口、上游地址优先。

## 本机约定

- 仓库：当前 COViS checkout；否则从本 skill 的真实目录解析 `../../..`，最后检查 `$HOME/COViS`（`$HOME/T2I-Explorer` 是为旧路径保留的指向 `COViS` 的符号链接）。
- 入口：`<repo>/tools/component-map/server.py`，使用 `/usr/bin/python3`；资源在同目录。
- 用户服务：`covis-dev.service`，绑定 `127.0.0.1:4180`。
- 默认上游：`http://127.0.0.1:4173`，即 Prob 正式版。Dev 在每次页面请求时从上游读取 HTML 并加入标注，继续代理 API、图片和前端资源；无需复制构建文件名。

Dev 版对应用户原先的组件标注页。它使用 Prob 版当前已部署的前端和数据；React 源码更新需先构建、重启 Prob。标注脚本和样式修改后刷新 Dev 即可，Python 服务代码修改后重启 Dev。文件已保存在仓库，启动时不依赖 `/tmp`。Playwright 默认使用 4182，避免与 Dev 的 4180 冲突。

## 启动

1. 检查 `systemctl --user status covis-dev.service`、现有 unit 和 `ss -ltnp`。复用已配置的服务及上游。端口被其他项目占用时报告具体冲突。
2. 请求上游 `/api/health`。若默认 4173 未启动，先使用 [start-covis-prob](../start-covis-prob/SKILL.md) 启动上游；用户指定其他上游时按指定服务处理。已有健康的 Prob 无需为启动 Dev 而重新构建或重启。
3. 创建或更新 `$HOME/.config/systemd/user/covis-dev.service`，填写实际绝对路径，保留兼容的自定义设置：

   ```ini
   [Unit]
   Description=COViS dev component annotation viewer (4180)
   After=covis.service
   Wants=covis.service

   [Service]
   Type=simple
   WorkingDirectory=<absolute-repo>
   ExecStart=/usr/bin/python3 <absolute-repo>/tools/component-map/server.py --port 4180 --upstream http://127.0.0.1:4173
   Restart=on-failure
   RestartSec=3

   [Install]
   WantedBy=default.target
   ```

   自定义端口或上游时同步修改命令；上游不是本机 Prob 时移除不适用的 Prob 服务依赖。运行 `systemctl --user daemon-reload`、`systemctl --user enable covis-dev.service` 和 `systemctl --user restart covis-dev.service`。没有用户 systemd 会话时给出环境限制及实际 Python 启动命令。

## 验收

等待启动最多 30 秒，每次请求超时不超过 5 秒；失败时读服务日志，避免无限重启。

```bash
curl --fail --silent --show-error --max-time 5 http://127.0.0.1:4180/api/health
curl --fail --silent --show-error --max-time 5 'http://127.0.0.1:4180/?dataset=sft-e6.0-r30'
```

健康接口应返回上游的 `{"status":"ok"}`；HTML 应包含 `component-toolbar`，JS / CSS 资源应返回正确类型。可用浏览器时检查中文名称和彩色框、显示标注开关、组件目录、添加对比列和图片详情的标注，以及 Prompt 展开／收起。

默认只提供本机访问。远程使用时转发服务器的 4180 端口；用户明确要求公网 Dev 时，再配置单独的域名路由。仅创建或验证 skill 本身，不触发真实服务启动。

最后报告实际访问地址、上游、服务状态和日志命令：`journalctl --user -u covis-dev -n 30`。
