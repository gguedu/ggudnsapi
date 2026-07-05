# 前后端 API 封装与 Admin UI

dnsserve 的前端有两部分：当前部署的静态后台 `public/admin.html`，以及在建的重构版 `frontend/`（目前为空壳目录，含 `components/sections/lib/types` 子目录但无文件）。本章描述实际运行的前后端通信约定。

## 静态资源服务

`wrangler.toml` 配置：

```toml
[assets]
directory = "./public"
binding = "ASSETS"
not_found_handling = "single-page-application"
```

`src/index.ts` 的 `fetch` 入口：路径不以 `/api/` 开头时 `env.ASSETS.fetch(request)` 交给静态资源。因此 `/admin.html`、`/` 等都由 `public/` 提供，`/api/**` 走业务逻辑。SPA 模式下未命中路径回退到入口 HTML。

## 响应信封（前后端契约）

后端 `src/http.ts`：

- 成功：`ok(data)` → `{ success: true, data }`
- 失败：`fail(message, status)` → `{ success: false, message }`

前端必须按 `body.success` 判断，不能只看 HTTP 状态。HTTP 非 2xx 或 `success===false` 都视为失败。

## Admin UI 的 API 封装

`public/admin.html` 内联 JS 提供统一 `api()` 封装：

```js
const token = () => localStorage.getItem('mail_token') || ''

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      'content-type': 'application/json',
      Authorization: token(),
      ...(options.headers || {})
    }
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || body.success === false) throw new Error(body.message || `HTTP ${res.status}`)
  return body.data
}
```

要点：

- `Authorization` 头直接放裸 `mail_token`（后端 `normalizeToken` 兼容）。
- `content-type` 固定 `application/json`，请求体用 `JSON.stringify`。
- 失败抛 `Error`，调用方 `try/catch` 后用 `setStatus(msg, true)` 展示。
- 成功返回 `body.data`（已解包）。

## 登录与权限校验流程

```
管理员在 /admin.html 输入邮箱密码
  └─ adminLogin()
       └─ POST /api/auth/admin-login  (不带 Authorization)
            返回 { token, mailUser, user, isAdmin }
       └─ localStorage.setItem('mail_token', data.token)
       └─ enterAdmin()
            └─ GET /api/auth/me  (带 token)
                 返回 { mailUser, user, isAdmin }
            └─ 校验 me.isAdmin，否则提示“不在 DNS_ADMIN_EMAILS 中”
            └─ renderTabs() + loadAll()
```

页面加载时 `if (localStorage.getItem('mail_token')) enterAdmin()` 自动尝试恢复会话。退出 `logout()` 清 `mail_token` 与缓存。

`/api/auth/admin-login` 不带 `Authorization` 头（用 `headers:{}` 覆盖），后端用邮箱密码向通行证换 token。其余所有 `/api/admin/**` 都带 token。

## 数据加载与渲染

`loadAll()` 并发拉取六个接口，写入 `cache` 后渲染：

```js
const [users, accounts, domains, blacklist, settings, records] = await Promise.all([
  api('/api/admin/users'),
  api('/api/admin/cf-accounts'),
  api('/api/admin/domains'),
  api('/api/admin/blacklist'),
  api('/api/admin/settings'),
  api('/api/admin/records')
])
cache = { users, accounts, domains, blacklist, settings, records }
```

每个写操作（`addUser`/`addAccount`/`addDomain`/`addBlacklist`/`saveSettingsPatch` 等）成功后都调 `loadAll()` 刷新全量缓存并重渲染，保证 UI 与后端一致。

## 各 Tab 的接口调用

| Tab | 操作 | 接口 |
|---|---|---|
| 用户 | 添加 | `POST /api/admin/users` |
| 用户 | 调积分 | `PATCH /api/admin/users/:uid/points` `{delta,message}` |
| 用户 | 封禁/解封 | `PATCH /api/admin/users/:uid/ban` `{banned,reason}` |
| 用户 | 删除 | `DELETE /api/admin/users/:uid` |
| CF 账户 | 添加 | `POST /api/admin/cf-accounts` `{remark,authType,email?,apiKey?,apiToken?}` |
| CF 账户 | 删除 | `DELETE /api/admin/cf-accounts/:id` |
| 域名池 | 添加 | `POST /api/admin/domains` `{root,cfAccountId,pointCost}` |
| 域名池 | 删除/禁用 | `DELETE /api/admin/domains/:root` |
| 黑名单 | 添加 | `POST /api/admin/blacklist` `{pattern,target,type,reason}` |
| 黑名单 | 删除 | `DELETE /api/admin/blacklist/:id` |
| 设置 | 类型/保护/积分/TTL | `PATCH /api/admin/settings`（分块保存） |
| 记录总览 | 展示 | `GET /api/admin/records`（已在 `loadAll` 拉取） |

## 设置面板的交互约定

- **解析类型权限**：用拖拽 chip 在“允许/拒绝”两区切换，本地改 `cache.settings.allowedTypes`，点保存调 `PATCH /api/admin/settings {allowedTypes}`。
- **子域保护 / 积分 / TTL**：各自独立保存按钮，分别 `PATCH` 对应字段。
- 后端 `patchSettings` 是部分更新，未传字段保留原值。

## GGU Web 前台接入

GGU Web（Nuxt）侧通过环境变量配置 API 基址：

```
NUXT_PUBLIC_DNS_API_BASE_URL=https://<worker域名>/api
```

本地联调：

```powershell
$env:NUXT_PUBLIC_DNS_API_BASE_URL = "http://127.0.0.1:8787/api"
pnpm dev
```

前台用户态调用约定（GGU Web 侧实现，dnsserve 后端兼容）：

- 从 `localStorage.mail_token` 取 token，放 `Authorization` 头。
- `GET /api/records/meta` 获取开放域名与允许类型（无需登录）。
- `GET /api/records` 列我的记录；`POST /api/records` 创建；`PATCH /api/records/:id`、`PATCH /api/records/:id/toggle`、`DELETE /api/records/:id` 管理。
- `GET /api/points` 查余额与流水。
- `GET /api/auth/me` 获取当前用户与 `isAdmin` 标记。

## 凭证回传约定

`/api/admin/cf-accounts` 列表与详情经 `redactAccount` 处理，只返回：

```jsonc
{
  "id": "...",
  "name": "Cloudflare 账户名（CF 回填）",
  "remark": "备注",
  "accountId": "...",
  "authType": "token" | "key_email",
  "email": "...",
  "hasApiToken": true,
  "hasApiKey": false,
  "createdAt": "...",
  "updatedAt": "..."
}
```

前端据此展示是否已配置凭证，不显示凭证本身。`name` 与 `accountId` 由后端在保存时调 Cloudflare `/accounts` 自动回填。

## 在建重构版 `frontend/`

`frontend/src/` 下已建 `components/sections/lib/types` 目录但无文件，是计划中的组件化重构。当前部署仍使用 `public/admin.html` 单文件方案。若启动重构，建议沿用 `api()` 封装与响应信封契约，把 `cache + loadAll` 模式替换为状态管理库，但接口路径与字段保持兼容。
