# API 接口清单

所有接口位于 `/api/**` 下，由 `src/index.ts` 路由分发。非 `/api/` 路径交给 `ASSETS` 静态资源。

## 通用约定

### 响应信封

```jsonc
// 成功
{ "success": true, "data": <T> }

// 失败
{ "success": false, "message": "<错误描述>" }
```

### 鉴权头

```
Authorization: <mail_token>
Authorization: Bearer <mail_token>
```

两种格式都接受（`normalizeToken` 兼容）。管理员接口需 token 对应邮箱在 `DNS_ADMIN_EMAILS` 中。

### CORS

- 允许方法：`GET, POST, PATCH, DELETE, OPTIONS`
- 允许头：`authorization, content-type`
- 允许源：请求 `Origin` 等于 `ALLOWED_ORIGIN` 时回显，否则回 `ALLOWED_ORIGIN` 固定值
- `OPTIONS` 预检直接返回 204

### 错误状态码

| 码 | 含义 |
|---|---|
| 400 | 参数校验失败 |
| 401 | 未登录 / token 失效 |
| 403 | 无权限 / 被封禁 / 黑名单 / 子域保护 |
| 404 | 接口或资源不存在 |
| 409 | 同名同类型记录冲突 |
| 500 | 服务器内部错误 |
| 502 | Cloudflare API 失败 |

## 鉴权 `/api/auth`

### `POST /api/auth/admin-login`
管理员邮箱密码登录。

- 入参：`{ email: string, password: string }`
- 流程：向 `${MAIL_API_BASE_URL}/login` 换 token → `requireUser` 同步本地用户 → 校验 `DNS_ADMIN_EMAILS`。
- 响应：`{ token, mailUser, user: DnsUser, isAdmin: true }`
- 错误：401 登录失败；403 非管理员。

### `GET /api/auth/me`
获取当前登录用户。也接受 `POST /api/auth/callback`（同处理）。

- 头：`Authorization: <token>`
- 响应：`{ mailUser: MailUserInfo, user: DnsUser, isAdmin: boolean }`

## 解析记录 `/api/records`

> 除 `meta` 外，均需 `requireUser`。

### `GET /api/records/meta`
- 响应：`{ allowedTypes, defaultTtl, protectionEnabled, domains: PublicDomain[] }`
- `domains` 仅含 `enabled:true` 的根域，字段经 `publicDomain` 裁剪：`root, enabled, allowedTypes, defaultTtl, proxiedDefault, pointCost`。

### `GET /api/records`
- 列出当前用户的全部记录，按 `createdAt` 降序。

### `POST /api/records`
创建记录。

- 入参：
  ```jsonc
  {
    "fullDomain": "a.example.com",
    "type": "A",
    "content": "1.2.3.4",
    "ttl": 600,           // 可选，默认域名/全局 defaultTtl
    "proxied": false,     // 可选
    "comment": "备注",    // 可选，≤200 字
    "priority": 10        // MX 必填
  }
  ```
- 响应：`{ record: DnsRecord, user: DnsUser }`（返回扣分后新余额）
- 失败回滚：CF 记录已建但 KV/积分失败时自动删 CF 记录与索引。

### `GET /api/records/:id`
（路由未单独实现，列表已含详情字段）

### `PATCH /api/records/:id`
更新记录内容/TTL/proxied/priority/comment（不可改域名与类型）。

- 入参：`{ content?, ttl?, proxied?, priority?, comment? }`
- 仅 `enabled:true` 时同步 Cloudflare；禁用态只更新本地。

### `PATCH /api/records/:id/toggle`
启停切换。

- 停用：删 CF 记录，本地 `enabled:false, status:'missing'`。
- 启用：重校验黑名单/子域/冲突，重建 CF 记录，`enabled:true, status:'active'`，不扣积分。

### `DELETE /api/records/:id`
删除记录。

- 删 CF 记录 → 删 KV 索引 → 清理 owner → 按 `deleteRefundEnabled` 退积分。
- 响应：`{ record: DnsRecord, user: DnsUser }`

## 积分 `/api/points`

### `GET /api/points`
- 响应：`{ balance: number, logs: PointLog[] }`（logs 按 `createdAt` 降序）

## 管理后台 `/api/admin/**`

> 全部需 `requireAdmin`（先 `requireUser` 再校验邮箱）。

### 用户管理 `/api/admin/users`

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/admin/users` | 列全部用户，附 `recordCount` |
| POST | `/api/admin/users` | 手动建用户 `{email, uid?, name?, points?}`，邮箱重复报 400 |
| PATCH | `/api/admin/users/:uid/points` | 调积分 `{delta: number, message?: string}` |
| PATCH | `/api/admin/users/:uid/ban` | 封禁/解封 `{banned?: boolean, reason?: string}` |
| DELETE | `/api/admin/users/:uid` | 删用户（有解析记录时 400，建议先封禁） |

### CF 账户 `/api/admin/cf-accounts`

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/admin/cf-accounts` | 列账户（经 `redactAccount` 脱敏） |
| POST | `/api/admin/cf-accounts` | 新建 `{remark?, authType: 'token'\|'key_email', email?, apiToken?, apiKey?}`，自动回填账户名/Account ID |
| GET | `/api/admin/cf-accounts/:id/zones` | 列该账户下 Zone |
| PATCH | `/api/admin/cf-accounts/:id` | 更新（同入参，凭证可选） |
| DELETE | `/api/admin/cf-accounts/:id` | 删除（被域名池引用时 400） |

### 域名池 `/api/admin/domains`

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/admin/domains` | 列全部域名 |
| POST | `/api/admin/domains` | 接入 `{root, cfAccountId, pointCost?, allowedTypes?, defaultTtl?, proxiedDefault?, enabled?}`，自动查 Zone |
| PATCH | `/api/admin/domains/:root` | 更新（root 路径段需 URL 编码） |
| DELETE | `/api/admin/domains/:root` | 有记录则禁用，无记录才删 |

### 黑名单 `/api/admin/blacklist`

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/admin/blacklist` | 列规则 |
| POST | `/api/admin/blacklist` | 新建 `{pattern, type: 'exact'\|'suffix'\|'contains'\|'wildcard', target: 'domain'\|'user', reason?}` |
| DELETE | `/api/admin/blacklist/:id` | 删除 |

### 设置 `/api/admin/settings`

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/admin/settings` | 取全局设置 |
| PATCH | `/api/admin/settings` | 更新 `{protectionEnabled?, initialPoints?, deleteRefundEnabled?, allowedTypes?, defaultTtl?}` |

### 记录总览 `/api/admin/records`

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/admin/records` | 列全部记录（管理员视角） |

## 支持的解析类型

`SUPPORTED_TYPES`（`src/index.ts` 与 `src/domain.ts` 各定义一份，需保持一致）：

```
A, AAAA, CNAME, HTTPS, TXT, SRV, LOC, MX, NS, CERT, DNSKEY,
DS, NAPTR, SMIMEA, SSHFP, SVCB, TLSA, URI, CAA
```

> 全局默认 `allowedTypes: []`，必须先在后台设置中把类型加入允许列表，用户才能创建。

## 路径分段约定

`segmentsOf(url)` 按 `/` 切分去空。路由判断基于下标：

- `/api/records/:id/toggle` → `segments = ['api','records',id,'toggle']`，`segments[3]==='toggle'`
- `/api/admin/users/:uid/points` → `segments = ['api','admin','users',uid,'points']`，`segments[4]==='points'`

新增接口时注意下标与 `segments.length` 的组合判断，避免误命中 404。
