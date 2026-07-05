# 数据处理与 KV 数据库通信

dnsserve 把 Cloudflare KV（绑定名 `DNS_KV`）当作唯一数据库。KV 是一个最终一致的键值存储，**不支持二级索引与跨键事务**，因此本项目采用“主键 + 标记/索引键双写”的模式来支持多种列表访问路径。所有键命名与读写集中在 `src/kv.ts`。

## 环境变量（`wrangler.toml` / Secret）

| 变量 | 来源 | 用途 |
|---|---|---|
| `DNS_KV` | KV 绑定 | 全部持久化存储 |
| `ASSETS` | 静态资源绑定 | 服务 `public/` 静态页 |
| `MAIL_API_BASE_URL` | `[vars]` | GGU 通行证 API 基址，校验 token |
| `ALLOWED_ORIGIN` | `[vars]` | CORS 允许源（GGU Web 域名） |
| `DNS_ADMIN_EMAILS` | `[vars]` | 管理员邮箱逗号分隔清单 |
| `DEFAULT_INITIAL_POINTS` | `[vars]` | 首次登录赠送积分（settings 缺失时种子） |
| `DELETE_REFUND_ENABLED` | `[vars]` | 删除是否退积分（settings 缺失时种子） |
| `CREDENTIALS_ENCRYPTION_KEY` | `wrangler secret` | 加密 CF 凭证（推荐，未设则明文） |

`getSettings` 在 `settings:global` 不存在时会用 `DEFAULT_INITIAL_POINTS` / `DELETE_REFUND_ENABLED` 种子化并写回 KV，因此首次运行后全局设置以 KV 为准。

## 读写原语

```ts
kvGet<T>(env, key)              // env.DNS_KV.get<T>(key, 'json')
kvPut(env, key, value)          // env.DNS_KV.put(key, JSON.stringify(value))
kvDelete(env, key)              // env.DNS_KV.delete(key)
listValues<T>(env, prefix)      // 分页 list({prefix, cursor}) + 逐条 kvGet
```

`listValues` 会循环翻页直到 `list_complete`，对每个 key 再做一次 `kvGet` 取完整对象。这是 KV 无索引环境下列表的通用做法，代价是 N+1 读。

## 键命名表（`keys` 对象）

| 前缀/格式 | 存储内容 | 写入者 | 说明 |
|---|---|---|---|
| `settings:global` | `Settings` | `getSettings`/`putSettings` | 全局唯一 |
| `cf-account:<id>` | `CfAccount` | `putCfAccount` | 主键，含加密凭证 |
| `cf-account-index:<id>` | `{id}` | `putCfAccount` | 标记键，用于 list |
| `domain:<root>` | `ManagedDomain` | `putDomain` | 主键 |
| `domain-index:<root>` | `{root}` | `putDomain` | 标记键 |
| `user:<uid>` | `DnsUser` | `putUser` | 主键 |
| `user-email:<email小写>` | `{uid}` | `putUser` | 邮箱→uid 反查 |
| `point-log:<uid>:<stamp>:<id>` | `PointLog` | `putPointLog` | 时间戳入键便于排序 |
| `owner:<root>:<secondLevel>` | `OwnerRecord` | `putOwner` | 子域占用者 |
| `record:<id>` | `DnsRecord` | `putRecord` | 主键 |
| `user-record:<uid>:<id>` | `{id}` | `putRecord` | 用户维度列表标记 |
| `domain-record:<root>:<id>` | `{id}` | `putRecord` | 域名维度列表标记 |
| `cf-record:<cfRecordId>` | `{id}` | `putRecord` | CF 记录 ID→本地 ID 反查 |
| `blacklist:<id>` | `BlacklistRule` | `putBlacklist` | 主键 |

> **规则**：新增持久化实体或新列表访问路径时，必须回到 `src/kv.ts` 的 `keys` 对象登记前缀，并补对应的 `put*`/`delete*` 双写逻辑，否则列表会漏数据。

## 各实体读写封装

### Settings
- `getSettings`：缺失时种子化（`protectionEnabled:true`、`allowedTypes:[]`、`defaultTtl:600`、`initialPoints` 取 `DEFAULT_INITIAL_POINTS`、`deleteRefundEnabled` 取 `DELETE_REFUND_ENABLED==='true'`）并写回。
- `putSettings`：覆盖写。

### Cloudflare 账户
- `listCfAccounts`：list 前缀 `cf-account:`（注意：主键本身就带 `cf-account:` 前缀，list 时会同时命中主键与 `cf-account-index:`，但 `listValues` 只取能 `kvGet` 成功的 JSON，索引键 `{id}` 也能被解析为对象——实际依赖主键返回的完整对象；主键与索引键内容不同，list 会把它们都当 `CfAccount` 尝试解析，索引键缺字段会被业务层忽略。**实现细节**：当前 `listValues<CfAccount>` 会把索引键 `{id}` 也 push 进数组，调用方实际依赖主键，需注意此点）。
- `putCfAccount`：主键 + 索引键双写。
- `deleteCfAccount`：删主键 + 索引键（删除前由路由层校验未被域名池引用）。

### 域名池
- `listDomains` / `getDomain` / `putDomain` / `deleteDomain`，结构与 CF 账户一致。
- 路由层 `handleAdminDomains` 删除时：若仍有解析记录，改为置 `enabled:false` 而非物理删除。

### 用户
- `getUser(uid)` / `getUserByEmail(email)`（经 `user-email:` 反查）/ `putUser`（主键 + 邮箱反查双写）/ `deleteUser`（双删）/ `listUsers`。
- `ensureDnsUser`（auth.ts）在首次创建时写 `initial_grant` 流水。

### 积分流水
- `putPointLog`：键含 `<createdAt>`，`listUserPointLogs` 按 `point-log:<uid>:` 前缀 list 后按 `createdAt` 降序排序。
- 流水只追加，不修改。

### 子域 Owner
- `getOwner(root, secondLevel)` / `putOwner` / `deleteOwner` / `listOwners(root?)`。
- 由 `records.ts` 在创建时 `ensureOwner`、删除时 `cleanupOwnerIfUnused`（该用户在同 root+secondLevel 下无其他记录则释放）。

### DNS 记录
- `putRecord`：一次写 4 个键——主键 `record:<id>` + `user-record:<uid>:<id>` + `domain-record:<root>:<id>` + `cf-record:<cfRecordId>`，均为标记键 `{id}`。
- `deleteRecordIndexes`：删除上述 4 个键。
- `listRecords`：list `record:` 取全部主键。
- `listUserRecords(uid)`：list `user-record:<uid>:` 标记 → 逐条 `getRecord`。
- `listDomainRecords(root)`：list `domain-record:<root>:` 标记 → 逐条 `getRecord`。

### 黑名单
- `listBlacklist` / `putBlacklist` / `deleteBlacklist`，单键无索引。

## 一致性约束

KV 无事务，本项目通过显式顺序与补偿维持一致：

1. **创建记录**（`createUserRecord`）：
   - 先写 Cloudflare（外部副作用）。
   - 成功后写 KV 主键+索引+owner，再扣积分。
   - 任一步失败 → 回滚：删 CF 记录、删 KV 索引、删 owner（若本次新建）。
   - 积分不足在写 CF 之前检查，避免无谓外部调用。

2. **删除记录**（`deleteUserRecord`）：
   - 先删 Cloudflare，再删 KV 索引，再清理 owner，最后视设置退积分。
   - `safeDeleteDnsRecord` 把 CF 404 视为已删，幂等。

3. **启停**（`toggleUserRecord`）：
   - 停用：删 CF 记录，本地置 `enabled:false, status:'missing'`。
   - 启用：重新校验黑名单/子域/冲突，重建 CF 记录，本地置 `enabled:true, status:'active'`，**不重复扣积分**。

4. **删除域名**：有记录则改 `enabled:false`，无记录才物理删，避免记录变孤儿。

5. **删除 CF 账户**：被域名池引用时拒绝，避免域名指向不存在的账户。

## 凭证加密（`src/cloudflare.ts`）

- `encryptSecret(env, value)`：未设 `CREDENTIALS_ENCRYPTION_KEY` 直接返回原文；否则 SHA-256 派生 AES-GCM key，随机 12 字节 IV，密文 `base64(iv).base64(ciphertext)`。
- `decryptSecret`：逆操作；密文不含 `.` 视为明文（兼容旧数据）。
- `authHeaders`：按 `authType` 解密后生成 `Bearer` 或 `X-Auth-Email`+`X-Auth-Key`。
- 对外暴露经 `redactAccount`：只回 `hasApiToken`/`hasApiKey` 布尔，绝不回传密文。

## KV 使用注意

- KV 为最终一致，写入后短时间内不同边缘节点可能读到旧值；强一致读需求应避免基于 KV 做即时校验链。
- `list` 单次最多 1000 key，`listValues` 已做翻页。
- 大量记录场景下 `listValues` 的 N+1 读会成为瓶颈，未来若量级增长需考虑改用 D1 或 Durable Objects。
