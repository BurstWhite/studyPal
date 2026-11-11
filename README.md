# studyPal

给学生用的桌面学习助手：日程表、作业截止提醒、可读写日程的 LLM 对话、学习计划进度。

## 结构

- `src/index.ts`：Bun 服务入口，提供 API 和 React 界面。所有业务逻辑都在这里。
- `src/server/`：数据库（`bun:sqlite`）、鉴权、日历（重复规则、写入系统日历）、浙大数据同步、路由。
- `src/app/`：前端页面。
- `src-tauri/eventkit/`：Swift 辅助程序，用 EventKit 把日程和带提醒的作业截止时间写进系统日历。
- `src-tauri/`：Tauri 桌面壳。发布版启动时拉起编译好的 Bun 服务并打开窗口，退出时关闭它。

## 开发

```bash
bun install
bun dev            # 只起服务，浏览器打开 http://127.0.0.1:47822
bun run app:dev    # 起服务并打开桌面窗口
bun test
bun check
```

开发时数据存在仓库下的 `.studypal-data/`，不会碰正式数据。

## 打包

```bash
bun run app:build
```

产物在 `src-tauri/target/release/bundle/macos/studyPal.app`。正式数据存在
`~/Library/Application Support/app.studypal.desktop/`。

## 端口

服务只监听 `127.0.0.1`：开发用 47822，发布版用 47821。
