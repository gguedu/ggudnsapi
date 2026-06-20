# ggudnsapi — GGU DNS 分发平台

`ggudnsapi` 是 GGU DNS 分发平台的 Cloudflare Worker 后端项目，负责为 GGU Web 前台和内置管理后台提供 DNS 自助分发 API。

平台目标：

- 用户使用 **GGU 通行证 / cloud-mail 登录态** 登录后，自助创建和管理开放域名池下的 DNS 解析记录。
- 后端统一对接 **Cloudflare API**，支持多个 Cloudflare 账户和多个开放域名。
- 使用 **Cloudflare KV** 存储用户、积分、域名池、CF 账户、解析记录、子域归属和黑名单。
- 支持后台管理：用户管理、积分调整、CF 账户管理、域名池管理、黑名单管理、全局配置、允许解析类型设置和解析总览。

> 登录态机制：本项目使用 `localStorage` token + `Authorization` 请求头，不使用 Cookie。

---

## 技术栈

- Runtime：Cloudflare Workers
- Storage：Cloudflare KV
- Language：TypeScript
- Package manager：pnpm
- Cloudflare CLI：Wrangler
- Test runner：Vitest

> 本项目统一使用 `pnpm`，不要使用 `npm`。

---

## 项目结构

```text
ggudnsapi/
├── public/
│   └── admin.html              # Worker 内置轻量管理后台
├── src/
│   ├── auth.ts                 # 对接 cloud-mail 登录态，创建/同步 DNS 用户
│   ├── cloudflare.ts           # Cloudflare API 统一封装
│   ├── domain.ts               # 域名校验、子域保护、黑名单、允许类型校验
│   ├── http.ts                 # 响应封装、错误类型、CORS、工具函数
│   ├── index.ts                # Worker 入口、路由分发、静态资源 fallback
│   ├── kv.ts                   # KV key 命名与读写封装
│   ├── points.ts               # 积分变更与积分流水
│   ├── records.ts              # 解析记录 CRUD 编排、owner 维护、积分扣减
│   └── types.ts                # 项目类型定义
├── package.json
├── tsconfig.json
├── wrangler.toml
└── README.md
```

---

## 环境变量与绑定

配置见 `wrangler.toml`。

### KV 绑定

```toml
[[kv_namespaces]]
binding = "DNS_KV"
id = "replace-with-production-kv-id"
preview_id = "replace-with-preview-kv-id"
```

### 静态资源绑定

```toml
[assets]
directory = "./public"
binding = "ASSETS"
not_found_handling = "single-page-application"
```

非 `/api/**` 请求会由 `env.ASSETS.fetch(request)` 处理，因此可以访问内置后台：

```text
/admin.html
```

### 变量

| 变量 | 说明 | 示例 / 默认 |
|---|---|---|
| `MAIL_API_BASE_URL` | cloud-mail API 基地址 | `https://mail.ggu.edu.kg/api` |
| `ALLOWED_ORIGIN` | 允许跨域访问的 GGU Web 地址 | `https://ggu.edu.kg` |
| `DNS_ADMIN_EMAILS` | 管理员邮箱，英文逗号分隔 | `admin@ggu.edu.kg` |
| `DEFAULT_INITIAL_POINTS` | 首次登录默认赠送积分 | `1` |
| `DELETE_REFUND_ENABLED` | 删除解析是否退还积分 | `false` |
| `CREDENTIALS_ENCRYPTION_KEY` | 可选，CF 凭证加密密钥 | 建议配置为 secret |

建议生产环境使用 Wrangler secret 配置敏感值：

```powershell
pnpm wrangler secret put CREDENTIALS_ENCRYPTION_KEY
```

---

## 登录态说明

本项目不维护自己的 Cookie session。

前端流程：

1. 用户在 GGU Web / cloud-mail 登录。
2. 前端把 token 存入：

```text
localStorage.mail_token
```

3. 调用 `ggudnsapi` 时携带：

```http
Authorization: <token>
```

4. Worker 调用 cloud-mail：

```text
{MAIL_API_BASE_URL}/my/loginUserInfo
```

5. cloud-mail 返回当前用户信息后，Worker 在 DNS 平台内创建/同步独立 DNS 用户数据。

后端兼容两种 Authorization 写法：

```http
Authorization: token-value
Authorization: Bearer token-value
```

内部会去掉 `Bearer ` 前缀。

---

## KV 数据结构

所有 key 命名集中在 `src/kv.ts` 的 `keys` 对象中。

| Key | 说明 |
|---|---|
| `settings:global` | 全局配置 |
| `cf-account:{id}` | Cloudflare 账户配置 |
| `cf-account-index:{id}` | Cloudflare 账户索引 |
| `domain:{root}` | 开放域名池配置 |
| `domain-index:{root}` | 域名池索引 |
| `user:{uid}` | DNS 用户 |
| `user-email:{email}` | 邮箱到 DNS UID 的索引 |
| `point-log:{uid}:{stamp}:{id}` | 用户积分流水 |
| `owner:{root}:{secondLevel}` | 子域树归属记录 |
| `record:{id}` | DNS 解析记录 |
| `user-record:{uid}:{id}` | 用户解析记录索引 |
| `domain-record:{root}:{id}` | 域名解析记录索引 |
| `cf-record:{cfRecordId}` | Cloudflare record id 到本地记录索引 |
| `blacklist:{id}` | 黑名单规则 |

---

## 核心模型

### DNS 用户

首次通过有效 GGU 通行证 token 访问时自动创建。

字段包括：

- `uid`：DNS 平台 UID，目前取自 cloud-mail 用户标识
- `email`
- `name`
- `points`
- `initialGrantDone`
- `createdAt`
- `lastSeenAt`

### Cloudflare 账户

支持两种鉴权方式：

1. API Token

```http
Authorization: Bearer <token>
```

2. Global API Key + Email

```http
X-Auth-Email: <email>
X-Auth-Key: <key>
```

所有 Cloudflare API 调用必须经过 `src/cloudflare.ts`。

### 开放域名池

每个开放域名绑定一个 Cloudflare 账户和 Zone ID。

主要字段：

- `root`：开放主域名，例如 `example.com`
- `zoneId`：Cloudflare Zone ID
- `cfAccountId`：Cloudflare 账户 ID
- `enabled`：是否开放
- `allowedTypes`：可选，域名级允许解析类型
- `defaultTtl`：可选，域名级默认 TTL
- `proxiedDefault`：可选，默认是否开启 Cloudflare proxy
- `pointCost`：可选，该域名每条解析消耗积分

---

## API 响应格式

成功：

```json
{
  "success": true,
  "data": {}
}
```

失败：

```json
{
  "success": false,
  "message": "错误信息"
}
```

---

## 用户 API

### `GET /api/auth/me`

校验当前 token，同步 DNS 用户并返回用户信息。

需要请求头：

```http
Authorization: <mail_token>
```

响应示例：

```json
{
  "success": true,
  "data": {
    "mailUser": {
      "uid": "1001",
      "email": "user@example.com",
      "name": "User"
    },
    "user": {
      "uid": "1001",
      "email": "user@example.com",
      "points": 1,
      "initialGrantDone": true,
      "createdAt": "2026-06-21T00:00:00.000Z",
      "lastSeenAt": "2026-06-21T00:00:00.000Z"
    },
    "isAdmin": false
  }
}
```

### `POST /api/auth/callback`

登录弹窗成功后调用，作用与 `/api/auth/me` 类似：同步并返回 DNS 用户。

---

### `GET /api/records/meta`

返回用户前台创建解析所需元信息。

响应示例：

```json
{
  "success": true,
  "data": {
    "allowedTypes": ["A", "AAAA"],
    "defaultTtl": 600,
    "protectionEnabled": true,
    "domains": [
      {
        "root": "example.com",
        "enabled": true,
        "allowedTypes": ["A", "AAAA"],
        "defaultTtl": 600,
        "proxiedDefault": false,
        "pointCost": 1
      }
    ]
  }
}
```

---

### `GET /api/records`

返回当前用户的解析记录。

---

### `POST /api/records`

创建解析记录。

请求示例：

```json
{
  "fullDomain": "a.example.com",
  "type": "A",
  "content": "1.2.3.4",
  "ttl": 600,
  "proxied": false,
  "comment": "测试记录"
}
```

MX 记录需要 `priority`：

```json
{
  "fullDomain": "mail.example.com",
  "type": "MX",
  "content": "mx.example.com",
  "ttl": 600,
  "priority": 10
}
```

创建流程：

1. 校验登录态。
2. 匹配开放域名池。
3. 校验解析类型是否开放。
4. 检查用户/域名黑名单。
5. 执行子域保护。
6. 检查 Cloudflare 上 full domain 是否已有同名同类型记录。
7. 检查积分是否足够。
8. 调用 Cloudflare API 创建记录。
9. 写入本地 KV 记录和索引。
10. 首次占用 second-level 时写入 owner。
11. 扣减积分并写积分流水。

---

### `PATCH /api/records/:id`

修改解析记录。

当前允许修改：

- `content`
- `ttl`
- `proxied`
- `priority`
- `comment`

不允许直接修改：

- `fullDomain`
- `type`
- `root`

如需修改域名或类型，建议删除后重新创建。

---

### `PATCH /api/records/:id/toggle`

启用或停用解析。

停用：

- 删除 Cloudflare 记录
- 保留本地记录
- 设置 `enabled = false`
- 设置 `status = "missing"`
- 不退还积分

再次启用：

- 重新执行校验
- 重新创建 Cloudflare 记录
- 设置 `enabled = true`
- 不重复扣积分

---

### `DELETE /api/records/:id`

删除解析记录。

默认行为：

- 删除 Cloudflare 记录
- 删除本地 KV 记录和索引
- 如果同一用户在同一 second-level 下没有剩余记录，则清理 owner
- 默认不退还积分

如果 `settings.deleteRefundEnabled = true`，删除时退还该记录消耗的积分。

---

### `GET /api/points`

返回当前用户积分余额和积分流水。

响应示例：

```json
{
  "success": true,
  "data": {
    "balance": 1,
    "logs": [
      {
        "id": "...",
        "uid": "1001",
        "delta": 1,
        "balanceAfter": 1,
        "reason": "initial_grant",
        "message": "首次登录赠送积分",
        "createdAt": "2026-06-21T00:00:00.000Z"
      }
    ]
  }
}
```

---

## 管理 API

所有 `/api/admin/**` 接口都需要管理员权限。

管理员判断依据：

```text
DNS_ADMIN_EMAILS
```

多个管理员邮箱用英文逗号分隔。

### 用户管理

| Method | Route | 说明 |
|---|---|---|
| `GET` | `/api/admin/users` | 用户列表，含解析数量 |
| `PATCH` | `/api/admin/users/:uid/points` | 手动加减积分 |

积分调整请求：

```json
{
  "delta": 5,
  "message": "活动发放"
}
```

扣减积分：

```json
{
  "delta": -1,
  "message": "人工扣减"
}
```

---

### Cloudflare 账户管理

| Method | Route | 说明 |
|---|---|---|
| `GET` | `/api/admin/cf-accounts` | 列表，密钥字段不返回 |
| `POST` | `/api/admin/cf-accounts` | 新增账户 |
| `PATCH` | `/api/admin/cf-accounts/:id` | 更新账户 |
| `DELETE` | `/api/admin/cf-accounts/:id` | 删除账户 |
| `GET` | `/api/admin/cf-accounts/:id/zones` | 拉取 Cloudflare Zones |

API Token 模式请求示例：

```json
{
  "name": "Main CF Account",
  "authType": "token",
  "apiToken": "cloudflare-api-token"
}
```

Key + Email 模式请求示例：

```json
{
  "name": "Legacy CF Account",
  "authType": "key_email",
  "email": "admin@example.com",
  "apiKey": "cloudflare-global-api-key"
}
```

列表接口不会返回密钥，只返回：

- `hasApiToken`
- `hasApiKey`

---

### 域名池管理

| Method | Route | 说明 |
|---|---|---|
| `GET` | `/api/admin/domains` | 域名池列表 |
| `POST` | `/api/admin/domains` | 新增开放域名 |
| `PATCH` | `/api/admin/domains/:root` | 更新域名配置 |
| `DELETE` | `/api/admin/domains/:root` | 删除或禁用域名 |

新增域名示例：

```json
{
  "root": "example.com",
  "zoneId": "cloudflare-zone-id",
  "cfAccountId": "cf-account-id",
  "enabled": true,
  "allowedTypes": ["A", "AAAA"],
  "defaultTtl": 600,
  "proxiedDefault": false,
  "pointCost": 1
}
```

删除域名时：

- 如果该域名下没有本地解析记录，则删除配置。
- 如果已有解析记录，则自动改为 `enabled = false`，避免破坏已有数据。

---

### 黑名单管理

| Method | Route | 说明 |
|---|---|---|
| `GET` | `/api/admin/blacklist` | 黑名单列表 |
| `POST` | `/api/admin/blacklist` | 新增黑名单 |
| `DELETE` | `/api/admin/blacklist/:id` | 删除黑名单 |

请求示例：

```json
{
  "target": "domain",
  "type": "suffix",
  "pattern": "bad.example.com",
  "reason": "禁止使用"
}
```

字段说明：

- `target`
  - `domain`：域名黑名单
  - `user`：用户黑名单，可匹配 UID 或邮箱
- `type`
  - `exact`：完全匹配
  - `suffix`：后缀匹配
  - `contains`：包含匹配
  - `wildcard`：简单 `*` 通配

---

### 全局配置

| Method | Route | 说明 |
|---|---|---|
| `GET` | `/api/admin/settings` | 获取全局配置 |
| `PATCH` | `/api/admin/settings` | 更新全局配置 |

请求示例：

```json
{
  "protectionEnabled": true,
  "initialPoints": 1,
  "deleteRefundEnabled": false,
  "allowedTypes": ["A", "AAAA"],
  "defaultTtl": 600
}
```

说明：

- `allowedTypes` 是全局允许用户创建的解析类型。
- 域名池里的 `allowedTypes` 可以覆盖全局配置。
- 修改允许类型只影响新建、重新启用或修改的记录，不会删除已有记录。

---

### 解析总览

| Method | Route | 说明 |
|---|---|---|
| `GET` | `/api/admin/records` | 查看全平台所有本地解析记录 |

---

## 子域保护机制

子域保护用于避免用户通过多个账号白嫖同一子域树。

假设开放主域名为：

```text
example.com
```

对于：

```text
c.b.a.example.com
```

其 second-level 是：

```text
a.example.com
```

开启 `settings.protectionEnabled` 时，创建解析按以下规则判断：

1. 命中用户黑名单或域名黑名单，拒绝。
2. 记录类型不在允许列表内，拒绝。
3. 查询 `owner:{root}:{secondLevel}`。
4. 如果 owner 存在且不是当前用户，拒绝。
5. 如果 owner 存在且是当前用户，允许继续。
6. 如果 owner 不存在，则查询 Cloudflare 上 second-level 本身是否已有记录。
7. 如果 Cloudflare 上 second-level 已有记录，说明可能是管理员手动创建，占用该树，拒绝并提示：

```text
该域名暂时无法创建
```

8. 如果 full domain 自身已有同名同类型记录，拒绝。
9. 积分足够才允许创建。
10. 创建成功后，如果 owner 不存在，写入 owner。

### 自测案例

开放主域名：`example.com`

| 场景 | 预期 |
|---|---|
| 用户 1001 创建 `a.example.com` | 成功，owner 写入 1001 |
| 用户 1002 创建 `b.a.example.com` | 拒绝 |
| 用户 1001 创建 `c.a.example.com` | 允许 |
| CF 上已有管理员手动创建的 `y.example.com`，用户创建 `z.y.example.com` | 拒绝 |
| 用户 1004 创建全新 `m.example.com` | 成功，owner 写入 1004 |

---

## 积分机制

当前规则：

- 新用户首次登录赠送 `settings.initialPoints`，默认 1。
- 创建 1 条解析默认扣 1 积分。
- 域名池可通过 `pointCost` 覆盖成本。
- 删除解析默认不退积分。
- `settings.deleteRefundEnabled = true` 时，删除会退还该记录消耗的积分。
- 管理员可以手动调整用户积分。
- 所有积分变更写入 `point-log:*`。

注意：Cloudflare KV 不是强事务存储，当前积分扣减是最佳努力实现。如果后续需要严格防止并发双花，建议迁移积分账户到 D1 或 Durable Object。

---

## 内置管理后台

本项目提供一个轻量管理页：

```text
/admin.html
```

本地开发时通常是：

```text
http://127.0.0.1:8787/admin.html
```

使用方式：

1. 先在 GGU Web / cloud-mail 登录。
2. 从浏览器控制台获取：

```js
localStorage.getItem('mail_token')
```

3. 打开 `/admin.html`。
4. 粘贴 token。
5. 点击刷新。

管理页支持：

- 用户管理
- 手动加减积分
- CF 账户管理
- 域名池管理
- 黑名单管理
- 解析类型 / 全局配置
- 解析总览

静态管理页本身是公开资源，但所有管理操作都必须通过 `/api/admin/**`，后端会校验管理员权限。

---

## 本地开发

### 安装依赖

```powershell
pnpm install
```

### 类型检查

```powershell
pnpm typecheck
```

### 启动 Worker

```powershell
pnpm dev
```

默认由 Wrangler 输出本地地址，通常是：

```text
http://127.0.0.1:8787
```

### 部署

```powershell
pnpm deploy
```

---

## 本地联调流程

### 1. 启动 ggudnsapi

```powershell
pnpm --dir "E:\GithubDev\GGU\ggudnsapi" dev
```

### 2. 启动 GGU Web

在 `ggu-web` 中设置 DNS API 地址：

```powershell
$env:NUXT_PUBLIC_DNS_API_BASE_URL = "http://127.0.0.1:8787/api"
pnpm --dir "E:\GithubDev\GGU\ggu-web" dev
```

### 3. 打开服务页

```text
/services
```

### 4. 登录并测试 DNS 前台

- 未登录时应弹出悬浮登录窗口。
- 登录后应显示 DNS 用户信息、积分、解析列表。
- 新建解析类型下拉框应只显示后台允许的类型。

---

## 测试建议

### 1. 静态检查

```powershell
pnpm typecheck
```

当前已知结果：TypeScript 类型检查可通过。

### 2. Vitest

```powershell
pnpm test
```

当前项目如果没有测试文件，Vitest 会输出：

```text
No test files found, exiting with code 1
```

这表示还没有写自动化测试，不代表业务逻辑测试失败。

建议后续补充：

- `test/domain.test.ts`
- `test/records.test.ts`
- `test/points.test.ts`

至少覆盖：

- `getSecondLevel()`
- `validateRecordInput()`
- 允许解析类型校验
- 黑名单匹配
- 子域保护 5 个案例
- 积分扣减和删除不退还

### 3. 手动 API 测试

准备：

```powershell
$base = "http://127.0.0.1:8787/api"
$token = "你的 mail_token"
```

#### 校验登录态

```powershell
Invoke-RestMethod "$base/auth/me" -Headers @{
  Authorization = $token
}
```

#### 查看 meta

```powershell
Invoke-RestMethod "$base/records/meta" -Headers @{
  Authorization = $token
}
```

#### 查看积分

```powershell
Invoke-RestMethod "$base/points" -Headers @{
  Authorization = $token
}
```

#### 创建 A 记录

```powershell
$body = @{
  fullDomain = "test.example.com"
  type = "A"
  content = "1.2.3.4"
  ttl = 600
  proxied = $false
} | ConvertTo-Json

Invoke-RestMethod "$base/records" -Method Post -Headers @{
  Authorization = $token
  "Content-Type" = "application/json"
} -Body $body
```

#### 停用 / 启用记录

```powershell
Invoke-RestMethod "$base/records/<recordId>/toggle" -Method Patch -Headers @{
  Authorization = $token
}
```

#### 删除记录

```powershell
Invoke-RestMethod "$base/records/<recordId>" -Method Delete -Headers @{
  Authorization = $token
}
```

---

## 真实端到端测试清单

上线或接入真实 Cloudflare 前，建议按顺序检查：

1. `pnpm typecheck` 通过。
2. `wrangler.toml` 中 KV namespace 已配置。
3. `MAIL_API_BASE_URL` 可以访问真实 cloud-mail。
4. `ALLOWED_ORIGIN` 与 GGU Web 域名一致。
5. `DNS_ADMIN_EMAILS` 包含测试管理员邮箱。
6. 管理员 token 能访问 `/api/admin/settings`。
7. 能添加 Cloudflare 账户。
8. 能通过 `/api/admin/cf-accounts/:id/zones` 拉取 Zone。
9. 能添加开放域名池。
10. `/api/records/meta` 能返回开放域名。
11. 首次登录用户获得初始积分。
12. 创建解析成功后：
    - Cloudflare 上有记录
    - KV 中有 `record:*`
    - KV 中有 `owner:*`
    - 积分扣减
    - 有 `point-log:*`
13. 未开放类型会被拒绝。
14. 积分不足会被拒绝。
15. 子域保护 5 个案例符合预期。
16. 删除记录默认不退积分。
17. 启停记录不重复扣积分。

---

## 已知限制

- KV 非事务型存储，积分扣减和记录写入是最佳努力实现。
- 当前自动化测试文件尚未补齐。
- 管理后台是轻量静态页，适合初期管理和联调；后续可替换为更完整的前端应用。
- 目前修改解析不支持直接修改域名和记录类型，建议删除后重新创建。

---

## 相关项目

- `ggu-web`：GGU 官网和服务中心前台。
- `cloud-mail`：GGU 通行证 / 邮箱 API，提供登录态校验。
- `dnsmgr`：参考项目，主要参考 Cloudflare 鉴权与 DNS 管理思路。
