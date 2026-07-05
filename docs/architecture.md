# 项目工作原理与整体架构

## 运行环境

dnsserve 是一个 Cloudflare Worker 项目，入口为 `src/index.ts`，Worker 名 `ggudnsapi`。

- **计算层**：Cloudflare Worker（无状态、按请求执行）。
- **存储层**：Cloudflare KV（绑定名 `DNS_KV`），所有持久化状态唯一存放地。
- **静态资源**：`public/` 目录通过 `ASSETS` 绑定以 SPA 方式提供（`not_found_handling = "single-page-application"`）。
- **外部依赖**：GGU 通行证/邮箱 API（`MAIL_API_BASE_URL`）、Cloudflare API（`https://api.cloudflare.com/client/v4`）。

配置见 `wrangler.toml`，变量含义见 [data-model.md](./data-model.md) 的环境变量一节。

## 请求入口与分流

`src/index.ts` 导出的 `fetch` 处理器是唯一入口，按以下顺序分流：

```
请求进入 fetch(request, env)
  │
  ├─ OPTIONS  ──────────────────────► 直接返回 204 + CORS 头
  │
  ├─ 路径不以 /api/ 开头  ──────────► env.ASSETS.fetch(request) 交给静态资源
  │                                    （主要服务 public/admin.html）
  │
  └─ /api/**  ──► handleApi(request, env)
                    │
                    ├─ /api/auth/**     ─► handleAuth
                    ├─ /api/records/**  ─► handleRecords
                    ├─ /api/points      ─► handlePoints
                    └─ /api/admin/**    ─► handleAdmin（先 requireAdmin）
                                          ├─ users
                                          ├─ cf-accounts
                                          ├─ domains
                                          ├─ blacklist
                                          ├─ settings
                                          └─ records
```

所有 `/api/**` 响应都会被 `withCors` 包裹统一加 CORS 头；异常通过 `try/catch` 捕获，`ResponseError` 转为业务错误信封，其他异常转为 500。

## 模块职责

### `src/index.ts` —— 路由与编排层

- 路径分段解析 `segmentsOf`，按 `segments[1]` 分发到子处理器。
- 公共工具：`withCors`（包裹 CORS）、`adminEmails`/`isAdminEmail`（解析 `DNS_ADMIN_EMAILS`）、`requireBody`（读取 JSON）、`redactAccount`（CF 账户脱敏，不回传凭证密文）。
- 设置部分合并 `patchSettings`、`parseAllowedTypes`：校验解析类型必须在 `SUPPORTED_TYPES` 内。
- CF 账户构建 `accountFromBody`：写入时自动调用 `listCloudflareAccounts` 拉取真实账户名与 Account ID 回填。
- 域名接入 `domainFromBody` + `resolveDomainZone`：填域名 + 选 CF 账户后，自动在账户下查 Zone，命中即接入，无需手填 Zone ID。
- 管理员登录 `loginToMail`：用邮箱密码向 `${MAIL_API_BASE_URL}/login` 换 token，再走 `requireUser` 同步本地用户。

### `src/auth.ts` —— 鉴权与用户同步

- `getMailToken`：从 `Authorization` 头取 token，兼容 `Bearer <token>` 与裸 token。
- `getCurrentMailUser`：fetch `${MAIL_API_BASE_URL}/my/loginUserInfo`，兼容 `{data: {...}}` 信封与裸对象，归一化出 `uid`/`email`/`name`。
- `ensureDnsUser`：按 uid 查本地用户；存在则更新邮箱/姓名/最后登录时间并检查封禁；不存在则按设置发初始积分并写 `initial_grant` 流水。
- `requireUser`：组合上面两步，返回 `{ mailUser, dnsUser }`。
- `requireAdmin`：在 `requireUser` 之后，检查邮箱是否在 `DNS_ADMIN_EMAILS`（小写比对）。

### `src/records.ts` —— DNS 记录生命周期

详见 [records-lifecycle.md](./records-lifecycle.md)。核心函数：

- `createUserRecord`：创建记录，含 Cloudflare + KV + 积分的一致性回滚。
- `updateUserRecord`：更新内容/TTL/proxied 等（仅启用态会同步 Cloudflare）。
- `toggleUserRecord`：启停切换，停用删 CF 记录保留本地，启用重建 CF 记录不重复扣分。
- `deleteUserRecord`：删 CF 记录 + 清 KV 索引 + 清理 owner + 可选退积分。
- `recordsMeta` / `publicDomain`：给前端展示开放域名与允许类型。

### `src/domain.ts` —— 域名校验与规则

- `normalizeHostname`：小写、去尾点、长度/标签/字符校验。
- `findManagedDomain`：在启用域名池中找最长匹配根域（`full === root` 或 `full.endsWith(.root)`），主域名本身禁止创建。
- `getSecondLevel`：取相对根域的第一段拼回根域（如 `a.b.example.com` → `b.example.com`），用于子域保护。
- `validateRecordInput`：类型须在全局/域名允许列表，TTL≥60，MX 需 priority。
- `matchesBlacklist` / `assertBlacklistAllowed`：四种匹配模式（exact/suffix/contains/wildcard）作用于 domain 或 user。
- `assertSubdomainAllowed`：开启保护时，二级子域已被他人占用则拒绝；未被占用时再查 Cloudflare 是否已存在该二级记录。
- `assertFullDomainTypeAvailable`：查 Cloudflare 是否已存在同名同类型记录（冲突返回 409）。

### `src/cloudflare.ts` —— Cloudflare API 封装

- `cfRequest`：统一请求 `https://api.cloudflare.com/client/v4`，自动注入鉴权头与 `content-type`，解析 `{success, result, errors}` 信封，失败抛 `ResponseError`。
- `authHeaders`：按 `authType` 生成 `Authorization: Bearer` 或 `X-Auth-Email` + `X-Auth-Key`，凭证先 `decryptSecret` 解密。
- 凭证加解密 `encryptSecret`/`decryptSecret`：用 `CREDENTIALS_ENCRYPTION_KEY` 做 SHA-256 派生 AES-GCM 密钥，IV 随机，密文格式 `base64(iv).base64(data)`；未配置密钥时明文存（仅开发用）。
- 业务方法：`listCloudflareAccounts`、`listZones`、`listDnsRecords`、`getDnsRecord`、`createDnsRecord`、`patchDnsRecord`、`deleteDnsRecord`、`safeDeleteDnsRecord`（404 视为已删）。

### `src/kv.ts` —— KV 数据库通信

详见 [data-model.md](./data-model.md)。集中所有键命名与读写，对外暴露强类型 getter/setter，内部维护主键 + 标记/索引键双写。

### `src/points.ts` —— 积分变更

- `persistPointChange`：读取最新用户、扣/加 delta、`points<0` 抛“积分不足”、写回用户、写流水。
- `spendPoints`（创建扣减）、`refundPoints`（删除退还）、`adjustPoints`（后台手动调整）。
- 首次登录赠送由 `auth.ts` 的 `ensureDnsUser` 直接写 `initial_grant` 流水，不走 `persistPointChange`。

### `src/http.ts` —— 响应与工具

- `ResponseError`：带 `status` 的业务异常。
- `ok` / `fail` / `json`：统一信封 `{success, data}` / `{success, message}`。
- `corsHeaders`：`ALLOWED_ORIGIN` 匹配时回显请求 origin，否则回固定值；方法 `GET,POST,PATCH,DELETE,OPTIONS`，头 `authorization,content-type`。
- `readJson`、`getClientIp`（`cf-connecting-ip` 优先）、`nowIso`、`randomId`（`crypto.randomUUID`）。

### `src/types.ts` —— 共享类型

定义 `Env`、`DnsUser`、`Settings`、`CfAccount`、`ManagedDomain`、`DnsRecord`、`DnsRecordInput`、`PointLog`、`OwnerRecord`、`BlacklistRule`、`CfZone`、`CfDnsRecord` 等。

## 跨模块数据流：创建一条解析

以 `POST /api/records` 为例，串联多个模块：

```
index.handleRecords
  └─ records.createUserRecord
       ├─ kv.listDomains → domain.findManagedDomain          选根域
       ├─ domain.validateRecordInput                          校验入参/类型/TTL
       ├─ kv.getCfAccount → cloudflare.ensureAccount          取 CF 账户
       ├─ domain.getSecondLevel + assertBlacklistAllowed      黑名单
       ├─ domain.assertSubdomainAllowed                       子域保护(owner / CF 已存)
       ├─ domain.assertFullDomainTypeAvailable                同名同类型冲突
       ├─ points: user.points < pointCost ? 报错              积分校验
       ├─ cloudflare.createDnsRecord                          写 Cloudflare
       ├─ try:
       │    ├─ kv.putRecord (主键 + 3 个索引键)
       │    ├─ kv.putOwner (若该二级子域尚无 owner)
       │    └─ points.spendPoints (扣分 + 流水)
       └─ catch: 回滚 cloudflare 记录 + KV 索引 + owner       一致性补偿
```

## 设计要点

1. **无状态计算 + KV 单一存储**：Worker 不持有状态，所有数据落在 `DNS_KV`，水平扩展无需会话粘连。
2. **主键 + 标记键双写**：KV 不支持二级查询，通过额外写轻量 `{id}` 标记键实现按用户/域名/CF记录ID列表，列表时先 list 标记再逐条取主键。
3. **一致性靠显式回滚**：`createUserRecord` 在 Cloudflare 写成功后若 KV/积分失败，会反向删 CF 记录与索引键，避免脏数据。
4. **凭证加密落库**：CF Token/Key 经 AES-GCM 加密后存 KV，运行时按需解密，列表/详情接口经 `redactAccount` 只回布尔标记。
5. **子域保护防抢占**：首个在某二级子域创建记录的用户成为 owner，他人无法在该子域树下创建；owner 删除全部相关记录后自动释放。
6. **启停不重复计费**：停用仅删 CF 记录保留本地，启用重建 CF 记录但不扣积分；删除才可能退积分（受 `deleteRefundEnabled` 控制）。
