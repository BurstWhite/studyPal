# studyPal

给学生用的桌面学习助手：日程表、作业截止提醒、可读写日程的 LLM 对话、学习计划进度。

## 结构

Bun workspace，Mac 版在根目录，iPhone 版在 `apps/mobile`，两者共用 `packages/` 里的代码。

- `packages/core/`：与平台无关的业务逻辑和 API 路由：数据库结构、日历（重复规则、写入系统日历）、浙大数据同步、LLM 对话。它不依赖 Bun 或 React Native，平台能力（数据库、钥匙串、系统日历、HTTP）由各端在启动时通过 `configurePlatform` 提供。
- `packages/client/`：两端共用的前端数据层：`api()`、对话流式读取、日历排布、作业截止描述。
- `src/index.ts`：Mac 版的 Bun 服务入口，挂载 core 的路由并提供 React 界面。
- `src/server/`：Mac 端专有部分：鉴权、`bun:sqlite`、钥匙串、EventKit 辅助程序、用量统计。
- `src/app/`：Mac 版前端页面。
- `apps/mobile/`：iPhone 版（Expo / React Native）。没有服务器，界面直接在进程内调用 core 的路由。
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

## 分发（Mac）

```bash
STUDYPAL_BUN_RUNTIME=~/.bun/bin/bun bun run app:dist
```

产物在 `src-tauri/target/release/bundle/dmg/`。App 是 ad-hoc 签名、未经公证的，只支持 Apple Silicon、macOS 14 及以上；别人第一次打开时要在「系统设置 → 隐私与安全性」里点「仍要打开」。

`STUDYPAL_BUN_RUNTIME` 要指向和 `.bun-version` 同版本的官方 Bun（`bun.sh/install` 装的那个）。Homebrew 的 Bun 是为本机系统编译的，打进去的服务端只能在同版本或更新的 macOS 上运行；`app:dist` 发现任何程序要求高于 macOS 14 时会直接失败。

## iPhone 版

```bash
cd apps/mobile
bun run typecheck
bun run ios        # 需要 Xcode 和 iOS 模拟器运行时
```

数据只存在手机上，不和 Mac 版互通。手机写入的系统日历名为「studyPal（iPhone）」，默认关闭，以免和 Mac 版写进 iCloud 的日程重复。

## 端口

服务只监听 `127.0.0.1`：开发用 47822，发布版用 47821。
