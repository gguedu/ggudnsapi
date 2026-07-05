# 鉴权流程

dnsserve 不自建账号体系，**复用 GGU 通行证/邮箱系统的 token**。本地只存用户档案与积分，不存密码。鉴权实现集中在 `src/auth.ts`，配合 `src/index.ts` 的路由层。

## Token 来源与格式

- 前端从 GGU Web / 邮箱系统的 `localStorage.mail_token` 取 token。
- 请求头格式：`Authorization: <token>` 或 `Authorization: Bearer <token>`。
- `getMailToken`（`src/auth.ts`）：
  - 头缺失或空 → 抛 401 `未登录`。
  - 以 `Bearer ` 开头则去掉前缀取裸 token。

## 通行证校验

`getCurrentMailUser(request, env)`：

1. `fetch(${MAIL_API_BASE_URL}/my/loginUserInfo)`，带 `Authorization: <token>` 头。
2. 非 2xx → 抛 401 `登录状态已失效`。
3. 解析响应，兼容两种结构：
   - `{ code, message, data: RawMailUser }` 信封
   - 裸 `RawMailUser` 对象
4. 归一化字段：
   - `email`：取 `data.email || data.account?.email`，小写，缺失抛 403。
   - `uid`：取 `userId || uid || id || account.accountId || email`，转字符串。
   - `name`：可选。
5. 返回 `MailUserInfo { uid, email, name, raw }`。

## 本地用户同步

`ensureDnsUser(env, mailUser)`：

- **已存在**（按 uid 查 `user:<uid>`）：更新 `email`、`name`、`lastSeenAt`，写回 KV；若 `banned` 抛 403 并附 `bannedReason`。
- **首次**：读 `Settings`，初始积分取 `settings.initialPoints`（缺失回退 `DEFAULT_INITIAL_POINTS`）；写 `user:<uid>` + `user-email:<email>`；若积分 >0 追加一条 `initial_grant` 流水。

`requireUser(request, env)` = `getCurrentMailUser` + `ensureDnsUser`，返回 `{ mailUser, dnsUser }`。几乎所有用户态接口入口都先调它。

## 管理员校验

`requireAdmin(request, env)`：

1. 先 `requireUser` 完成 token 校验与用户同步。
2. 解析 `DNS_ADMIN_EMAILS`（逗号分隔，trim + 小写）。
3. 当前邮箱不在清单 → 抛 403 `无管理员权限`。

所有 `/api/admin/**` 接口在 `handleAdmin` 入口统一调 `requireAdmin`，因此每次请求都会重新校验通行证 token 与管理员身份，不依赖会话。

## 管理员登录入口

`POST /api/auth/admin-login`（`src/index.ts` 的 `handleAuth`）：

1. 入参 `{ email, password }`。
2. `loginToMail`：`POST ${MAIL_API_BASE_URL}/login` 换 token，解析 `{data:{token}}` 或 `{token}`。
3. 用换到的 token 构造一个内部 `Request`（`makeAuthRequest`），调 `getCurrentMailUser` + `requireUser` 同步本地用户。
4. 校验 `isAdminEmail`，非管理员抛 403。
5. 返回 `{ token, mailUser, user, isAdmin: true }`，前端把 token 存入 `localStorage.mail_token`。

## 用户态接口鉴权

- `/api/records/**`、`/api/points`、`GET /api/auth/me`：调 `requireUser`。
- `GET /api/records/meta`：不强制登录（先返回 meta 再走用户态），实际 `handleRecords` 中 `meta` 分支在 `requireUser` 之前返回。

## 封禁与黑名单

- **封禁**：`DnsUser.banned=true`，在 `ensureDnsUser` 中抛 403，所有需要登录的接口都被挡住。后台 `PATCH /api/admin/users/:uid/ban` 可封禁/解封。
- **黑名单**（`src/domain.ts` 的 `assertBlacklistAllowed`）：在创建/更新/启用记录时检查，命中 `user` 规则（按 uid 或 email）抛 403 `用户暂时无法使用该服务`，命中 `domain` 规则（按 fullDomain / secondLevel / root）抛 403 `该域名暂时无法创建`。黑名单不影响已存在记录的展示。

## CORS

`corsHeaders`（`src/http.ts`）：

- `access-control-allow-origin`：请求 `Origin === ALLOWED_ORIGIN` 时回显 origin，否则回 `ALLOWED_ORIGIN`。
- `access-control-allow-methods`: `GET,POST,PATCH,DELETE,OPTIONS`
- `access-control-allow-headers`: `authorization,content-type`
- `access-control-max-age`: `86400`

`fetch` 入口对 `OPTIONS` 直接返回 204 + CORS 头；对 `/api/**` 响应用 `withCors` 包裹加头；非 `/api/` 交给 `ASSETS` 不加业务 CORS。

## 凭证安全

管理员的 Cloudflare API 凭证（Token / Key）经 `encryptSecret`（AES-GCM）加密后存 KV，详见 [data-model.md](./data-model.md#凭证加密srccloudflarets)。对外接口 `redactAccount` 只返回 `hasApiToken` / `hasApiKey` 布尔，绝不回传密文或明文。运行时调用 Cloudflare API 前才 `decryptSecret` 解密。
