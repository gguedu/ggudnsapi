# DNS 记录生命周期

DNS 记录是本平台的核心业务对象。本章描述一条记录从创建到删除的全过程，以及与之联动的域名匹配、校验、黑名单、子域保护、Cloudflare 同步、积分扣退与一致性回滚。实现主要在 `src/records.ts` 与 `src/domain.ts`。

## 记录对象 `DnsRecord`

关键字段（`src/types.ts`）：

| 字段 | 说明 |
|---|---|
| `id` | 本地记录 ID（`crypto.randomUUID`） |
| `uid` | 所属用户 |
| `root` / `zoneId` / `cfAccountId` | 所属根域、CF Zone、CF 账户 |
| `cfRecordId` | Cloudflare 侧记录 ID |
| `secondLevel` | 二级子域（如 `a.example.com` 的 `b.example.com` 中的 `b.example.com`） |
| `fullDomain` / `type` / `content` / `ttl` / `proxied` / `priority` / `comment` | 解析内容 |
| `pointCost` | 创建时扣减的积分（冻结在记录上，删除时据此退还） |
| `enabled` | 本地启停状态 |
| `status` | `active` / `missing`（停用或 CF 侧缺失）/ `error` |
| `createIp` | 创建者 IP（`cf-connecting-ip` 优先） |
| 时间戳 | `createdAt` / `updatedAt` / `lastRefreshAt` |

## 域名匹配

`findManagedDomain(fullDomain, domains)`（`src/domain.ts`）：

1. `normalizeHostname`：小写、去尾点、长度≤253、标签≤63、字符 `[a-z0-9-]`、首尾非 `-`。
2. 在 `enabled:true` 的域名池中，找所有满足 `full === root` 或 `full.endsWith(.root)` 的根域。
3. 按 `root.length` 降序取最长匹配（支持 `a.b.example.com` 命中 `b.example.com` 而非 `example.com`）。
4. `full === root` 抛 400 `不能创建主域名本身`。
5. 无匹配抛 400 `域名不在开放域名池内`。

## 入参校验

`validateRecordInput(input, settings, domain)`：

- `type` 大写后须在 `SUPPORTED_TYPES` 且在 `allowedTypes`（域名级优先于全局）。
- `content` 非空。
- `ttl` 缺省取域名→全局→600，须 ≥60。
- `proxied` 默认 false。
- `comment` 截断 200 字。
- `MX` 必须有 `priority`。

## 创建流程 `createUserRecord`

入口 `POST /api/records`，步骤：

1. `listDomains` + `findManagedDomain` 选根域。
2. `validateRecordInput` 校验入参。
3. `getCfAccount` 取 CF 账户（缺失抛 500）。
4. `getSecondLevel(fullDomain, root)` 算二级子域。
5. `assertBlacklistAllowed`：黑名单命中 user（uid/email）或 domain（fullDomain/secondLevel/root）抛 403。
6. `assertSubdomainAllowed`：见下节“子域保护”。
7. `assertFullDomainTypeAvailable`：查 Cloudflare 是否已存在同名同类型记录，命中抛 409 `该域名已存在`。
8. `pointCost = domain.pointCost || 1`，`user.points < pointCost` 抛 400 `积分不足`。
9. `createDnsRecord` 写 Cloudflare（拿到 `cfRecordId`）。
10. `buildRecord` 组装本地记录。
11. **一致性 try**：
    - `putRecord`（写主键 + 3 索引键）
    - `ensureOwner`（子域保护开启且该二级子域无 owner 时写 `owner:<root>:<secondLevel>`）
    - `spendPoints`（扣分 + `create_record` 流水）
12. **catch 回滚**：
    - `safeDeleteDnsRecord` 删 CF 记录（404 忽略）
    - `deleteRecordIndexes` 删 KV 索引
    - 若本次新建了 owner，`deleteOwner`
    - 重新抛出原错误

返回 `{ record, user }`，前端据此刷新余额。

## 子域保护

`assertSubdomainAllowed(env, account, zoneId, uid, fullDomain, root, settings)`：

- `settings.protectionEnabled === false` → 直接放行，返回 `{ secondLevel, ownerExists:false }`。
- `getOwner(root, secondLevel)`：
  - 存在且 `owner.uid !== uid` → 抛 403 `该域名暂时无法创建`。
  - 存在且属于本人 → 返回 `{ ownerExists:true }`（不重复建 owner）。
- 不存在 owner：调 `listDnsRecords(env, account, zoneId, secondLevel)` 查 Cloudflare 是否已有该二级子域记录，有则抛 403（防止抢占已存在但未登记的子域）。
- 返回 `{ ownerExists:false }`，由 `ensureOwner` 在记录创建成功后写入 owner。

**释放**：`cleanupOwnerIfUnused` 在删除记录时调用，若该用户在同 `root+secondLevel` 下无其他记录，则 `deleteOwner` 释放子域。

## 更新 `updateUserRecord`

入口 `PATCH /api/records/:id`：

1. `getRecord` + `assertRecordOwner`（不存在 404，非本人 403）。
2. 找域名池（缺失 500）。
3. `mutableInputFromRecord` 合并入参（`fullDomain`/`type` 不可改，只更新 `content/ttl/proxied/priority/comment`）。
4. `validateRecordInput` 重新校验。
5. `assertBlacklistAllowed`（黑名单可能更新）。
6. `assertFullDomainTypeAvailable(..., ignoreRecordId=record.cfRecordId)` 排除自身查冲突。
7. **仅 `enabled:true` 时**调 `patchDnsRecord` 同步 Cloudflare，更新 `cfRecordId`。
8. 写回本地记录，`status` 启用态置 `active`。

## 启停 `toggleUserRecord`

入口 `PATCH /api/records/:id/toggle`：

**停用**（`enabled:true → false`）：
- `safeDeleteDnsRecord` 删 CF 记录。
- 本地 `enabled:false, status:'missing'`，写回。

**启用**（`enabled:false → true`）：
- 重新 `validateRecordInput` + `assertBlacklistAllowed` + `assertSubdomainAllowed` + `assertFullDomainTypeAvailable`（防止停用期间环境变化）。
- `createDnsRecord` 重建 CF 记录。
- 本地 `cfRecordId` 更新，`enabled:true, status:'active'`。
- **不扣积分**（创建时已扣）。

## 删除 `deleteUserRecord`

入口 `DELETE /api/records/:id`：

1. `assertRecordOwner`。
2. 找域名与 CF 账户（域名缺失不阻断，跳过 CF 删除）。
3. `safeDeleteDnsRecord` 删 CF 记录。
4. `deleteRecordIndexes` 删 KV 4 个键。
5. `cleanupOwnerIfUnused` 释放子域。
6. 若 `settings.deleteRefundEnabled && record.pointCost > 0`：`refundPoints` 退积分 + `delete_refund` 流水。
7. 返回 `{ record, user }`。

## 积分联动

| 事件 | reason | delta | 触发点 |
|---|---|---|---|
| 首次登录 | `initial_grant` | `+initialPoints` | `auth.ensureDnsUser` 直接写流水 |
| 创建记录 | `create_record` | `-pointCost` | `points.spendPoints` |
| 删除退还 | `delete_refund` | `+pointCost` | `points.refundPoints`（受开关） |
| 后台调整 | `admin_adjust` | `±delta` | `points.adjustPoints` |

`persistPointChange` 在写回前会 `getUser` 取最新余额（避免并发覆盖），`points<0` 抛 400 `积分不足`。

## 列表

- `listUserRecordSummaries`：`listUserRecords(uid)` → 按 `createdAt` 降序。
- `listAllRecordSummaries`：`listRecords` list `record:` 全部 → 降序。
- `recordsMeta`：给前端的开放域名与允许类型视图。

## 状态流转

```
创建 ──► enabled:true, status:active
  │
  ├─ toggle 停用 ──► enabled:false, status:missing  (CF 记录删除)
  │     └─ toggle 启用 ──► enabled:true, status:active  (CF 重建,不扣分)
  │
  ├─ update (启用态) ──► 同步 CF, status:active
  ├─ update (停用态) ──► 仅改本地
  │
  └─ delete ──► 删 CF + 删 KV + 释放 owner + 可选退积分
```

## 边界与注意

- 创建时 `pointCost` 冻结在记录上，后续域名 `pointCost` 改动不影响已建记录的退积分额度。
- 启用重建时若 Cloudflare 已存在同名同类型记录（他人停用期间创建），`assertFullDomainTypeAvailable` 会抛 409，记录保持停用态。
- 更新不校验子域保护（域名与类型不可改，owner 关系不变）。
- 删除记录时若域名已从池中移除（被禁用而非物理删），仍能通过记录自带的 `root`/`zoneId`/`cfAccountId` 找到账户并删 CF 记录。
