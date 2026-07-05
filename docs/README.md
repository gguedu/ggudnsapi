# dnsserve 文档总览

dnsserve（Worker 名 `ggudnsapi`）是 GGU DNS 分发平台后端，部署在 Cloudflare Worker 上。它为 GGU Web 的 DNS 服务页提供 API，复用 GGU 通行证 token 鉴权，管理用户积分与解析记录，并调用 Cloudflare API 创建/删除 DNS 记录，同时提供后台管理页 `/admin.html`。

本目录按主题拆分多份文档，便于快速定位实现细节。

## 文档索引

| 文档 | 内容 |
|---|---|
| [architecture.md](./architecture.md) | 项目工作原理、整体架构、模块职责、请求流转链路 |
| [data-model.md](./data-model.md) | 数据处理与 KV 数据库通信：键命名、读写封装、索引/标记键模式、一致性约束 |
| [api-reference.md](./api-reference.md) | 全部 HTTP API 接口清单：路径、方法、入参、响应、错误 |
| [authentication.md](./authentication.md) | 鉴权流程：通行证 token 校验、用户同步、管理员校验、CORS |
| [records-lifecycle.md](./records-lifecycle.md) | DNS 记录核心业务：创建/更新/启停/删除、子域保护、黑名单、积分扣退、回滚 |
| [frontend.md](./frontend.md) | 前后端 API 封装：`admin.html` 调用约定、GGU Web 接入、响应信封 |

## 相关源码文件

```
src/
├── index.ts       # API 路由与编排层（入口）
├── auth.ts        # 鉴权：通行证 token 校验、用户同步、管理员校验
├── records.ts     # DNS 记录生命周期
├── domain.ts      # 域名归一化、域名池匹配、校验、黑名单、子域保护
├── cloudflare.ts  # Cloudflare API 封装 + 凭证加解密
├── kv.ts          # KV 键命名与持久化封装
├── points.ts      # 积分变更与流水
├── http.ts        # 响应信封、CORS、JSON 解析、工具函数
└── types.ts       # 共享 TypeScript 类型
public/
└── admin.html     # 自包含静态后台页
frontend/          # 在建的重构版前端（目前为空壳目录）
```

## 快速命令

```bash
pnpm install          # 安装依赖
pnpm dev              # wrangler dev 本地运行
pnpm deploy           # wrangler deploy 部署
pnpm typecheck        # tsc --noEmit 类型检查
pnpm test             # vitest run 测试
pnpm exec vitest run path/to/file.test.ts   # 单文件测试
```
