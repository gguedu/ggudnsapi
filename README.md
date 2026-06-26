# ggudnsapi 接入说明

GGU DNS 分发平台后端，部署到 Cloudflare Worker。

主要用途：

- 给 GGU Web 的 DNS 服务页提供 API
- 使用 GGU 通行证 token 鉴权
- 管理用户积分和解析记录
- 调用 Cloudflare API 创建/删除 DNS 记录
- 提供后台管理页 `/admin.html`

---

## 1. Worker 需要配置哪些东西

### 1.1 KV 绑定

必须创建一个 Cloudflare KV，然后在 `wrangler.toml` 填：

```toml
[[kv_namespaces]]
binding = "DNS_KV"
id = "你的生产 KV ID"
preview_id = "你的预览 KV ID"
```

`binding` 必须叫：

```text
DNS_KV
```

代码里就是读 `env.DNS_KV`。

---

### 1.2 Worker 变量

`wrangler.toml` 里需要这些：

```toml
[vars]
MAIL_API_BASE_URL = "https://mail.ggu.edu.kg/api"
ALLOWED_ORIGIN = "https://ggu.edu.kg"
DNS_ADMIN_EMAILS = "admin@ggu.edu.kg"
DEFAULT_INITIAL_POINTS = "1"
DELETE_REFUND_ENABLED = "false"
```

说明：

| 变量 | 必须 | 说明 |
|---|---:|---|
| `MAIL_API_BASE_URL` | 是 | GGU 通行证 / 邮箱 Worker 的 API 地址，用来校验 token |
| `ALLOWED_ORIGIN` | 是 | 允许跨域访问 DNS API 的 GGU Web 地址 |
| `DNS_ADMIN_EMAILS` | 是 | DNS 后台管理员邮箱，多个用英文逗号分隔 |
| `DEFAULT_INITIAL_POINTS` | 是 | 新用户首次登录送多少积分 |
| `DELETE_REFUND_ENABLED` | 是 | 删除解析是否退积分，建议先用 `false` |

示例：

```toml
MAIL_API_BASE_URL = "https://mail.ggu.edu.kg/api"
ALLOWED_ORIGIN = "https://ggu.edu.kg"
DNS_ADMIN_EMAILS = "you@ggu.edu.kg,admin@ggu.edu.kg"
DEFAULT_INITIAL_POINTS = "1"
DELETE_REFUND_ENABLED = "false"
```

---

### 1.3 推荐配置 Secret

建议配置这个 secret，用来加密保存 Cloudflare Token / API Key：

```powershell
pnpm wrangler secret put CREDENTIALS_ENCRYPTION_KEY
```

输入一串随机字符串即可，建议 32 位以上。

不配置也能运行，但 Cloudflare 凭证会明文进 KV，不建议生产这样用。

---

### 1.4 静态后台资源

`wrangler.toml` 里已经有：

```toml
[assets]
directory = "./public"
binding = "ASSETS"
not_found_handling = "single-page-application"
```

这个不用改。

后台地址：

```text
https://你的-worker域名/admin.html
```

---

## 2. GGU Web 要配置什么

GGU Web 需要配置 DNS API 地址。

如果 DNS Worker 地址是：

```text
https://dns-api.ggu.edu.kg
```

那么 GGU Web 配：

```text
NUXT_PUBLIC_DNS_API_BASE_URL=https://dns-api.ggu.edu.kg/api
```

本地联调：

```powershell
$env:NUXT_PUBLIC_DNS_API_BASE_URL = "http://127.0.0.1:8787/api"
pnpm dev
```

---

## 3. 登录和后台鉴权怎么走

DNS 平台复用 GGU 通行证 token。

前端请求带：

```http
Authorization: <mail_token>
```

GGU Web 里 token 存在：

```text
localStorage.mail_token
```

后台 `/admin.html` 进入流程：

1. 管理员先在 GGU Web / 邮箱系统登录。
2. 浏览器控制台取 token：

```js
localStorage.getItem('mail_token')
```

3. 打开：

```text
https://你的-worker域名/admin.html
```

4. 粘贴 token。
5. 后台会先请求：

```http
GET /api/auth/me
Authorization: <mail_token>
```

6. Worker 会去 `MAIL_API_BASE_URL` 对应的通行证 Worker 校验这个 token。
7. 校验通过后，再检查邮箱是否在 `DNS_ADMIN_EMAILS`。
8. 只有管理员才能进入后台。

同时，所有 `/api/admin/**` 接口也会再次校验管理员权限。

---

## 4. Cloudflare Token 要什么权限

后台添加 CF 账户时推荐用 API Token。

Cloudflare Token 至少需要：

```text
Zone:Zone:Read
Zone:DNS:Edit
```

用途：

| 权限 | 用途 |
|---|---|
| `Zone:Zone:Read` | 查询账户下有没有这个域名，自动获取 Zone ID |
| `Zone:DNS:Edit` | 创建、修改、删除 DNS 解析 |

建议 Token 范围只限制到你要开放的 Zone，不要给全账户权限。

---

## 5. 后台第一次怎么配置

打开：

```text
/admin.html
```

通过管理员 token 验证后，按顺序配置。

### 5.1 设置

进入“设置”。

这里分几块：

1. **解析类型权限**
   - 上面是允许
   - 下面是拒绝
   - 默认全部在拒绝
   - 把要开放的类型拖到允许区
   - 保存

建议一开始只开放：

```text
A
AAAA
```

如果要开放 CNAME，再把 `CNAME` 拖到允许。

2. **子域保护**
   - 建议开启

3. **积分设置**
   - 新用户初始积分：建议 `1`
   - 删除是否退积分：建议先关闭

4. **TTL 设置**
   - 默认可以填 `600`

---

### 5.2 添加 Cloudflare 账户

进入“CF 账户”。

现在不需要用户自己写 Cloudflare 账户名称。

你只填：

- 备注名称，例如：`主账号`
- 鉴权方式
- 凭证

如果选择 **API Token**：

- 只显示 API Token 输入框

如果选择 **API Key + Email**：

- 显示 Email
- 显示 Global API Key

保存后，系统会自动请求 Cloudflare，读取真实 Cloudflare 账户名称和 Account ID。

---

### 5.3 接入域名

进入“域名池”。

现在只需要：

- 填域名，例如：`example.com`
- 下拉选择 Cloudflare 账户
- 填积分成本，例如：`1`

后台会自动去这个 Cloudflare 账户里查：

```text
这个账户下有没有 example.com 这个 Zone
```

如果有，会自动拿 Zone ID 并接入。

如果没有，会报错：

```text
该 Cloudflare 账户下没有这个域名
```

这样就不需要手填 Zone ID 了。

---

## 6. 黑名单规则怎么写

黑名单分两种目标：

| 目标 | 说明 |
|---|---|
| `domain` | 匹配域名 |
| `user` | 匹配用户 UID 或邮箱 |

匹配方式有四种：

### 6.1 exact：完全匹配

规则：

```text
bad.example.com
```

只会命中：

```text
bad.example.com
```

不会命中：

```text
a.bad.example.com
```

---

### 6.2 suffix：后缀匹配

规则：

```text
bad.example.com
```

会命中：

```text
bad.example.com
a.bad.example.com
x.y.bad.example.com
```

适合封禁一整棵域名树。

---

### 6.3 contains：包含匹配

规则：

```text
bad
```

会命中：

```text
bad.example.com
my-bad-site.example.com
abc.badge.example.com
```

这个比较宽，慎用。

---

### 6.4 wildcard：通配符匹配

支持一个 `*`。

规则：

```text
*.bad.example.com
```

会命中类似：

```text
a.bad.example.com
x.bad.example.com
```

规则：

```text
test-*.example.com
```

会命中：

```text
test-1.example.com
test-abc.example.com
```

---

### 6.5 用户黑名单

目标选 `user`。

可以写 UID：

```text
1001
```

也可以写邮箱：

```text
user@example.com
```

匹配方式也可以用：

- exact
- suffix
- contains
- wildcard

例如封禁某个邮箱域：

```text
@example.com
```

匹配方式选：

```text
suffix
```

---

## 7. 用户管理能做什么

后台“用户管理”支持：

- 添加用户
- 删除用户
- 封禁 / 解封用户
- 手动加减积分

说明：

- 删除用户只允许删除没有解析记录的用户。
- 如果用户已经有解析记录，建议封禁，不建议直接删。
- 封禁后用户再调用 DNS API 会被拒绝。

---

## 8. 本地开发命令

进入项目：

```powershell
cd E:\GithubDev\GGU\ggudnsapi
```

安装依赖：

```powershell
pnpm install
```

类型检查：

```powershell
pnpm typecheck
```

本地启动：

```powershell
pnpm dev
```

部署：

```powershell
pnpm deploy
```

---

## 9. 上线后怎么测试

### 9.1 测后台能否进入

打开：

```text
https://你的-worker域名/admin.html
```

粘贴管理员 token。

预期：

- 能进入后台
- 显示管理员邮箱和 UID

如果不能进：

- 检查 token 是否有效
- 检查 `MAIL_API_BASE_URL`
- 检查 `DNS_ADMIN_EMAILS` 是否包含这个邮箱

---

### 9.2 测 CF 账户

在后台添加 CF 账户。

预期：

- 保存成功
- 自动显示 Cloudflare 账户名
- 自动显示 Account ID

失败的话，通常是：

- Token 权限不够
- Token 无效
- API Key + Email 填错

---

### 9.3 测域名接入

在“域名池”填写：

```text
example.com
```

选择刚添加的 CF 账户。

预期：

- 如果这个账户下有该域名，接入成功
- 如果没有，提示：`该 Cloudflare 账户下没有这个域名`

---

### 9.4 测 GGU Web 前台

打开：

```text
https://ggu.edu.kg/services
```

进入 DNS 分发平台。

检查：

- 未登录时要求 GGU 通行证登录
- 登录后显示邮箱、UID、积分
- 解析类型只显示后台允许的类型

---

### 9.5 测创建解析

创建测试解析：

```text
test.example.com A 1.2.3.4
```

预期：

- 创建成功
- Cloudflare DNS 里能看到记录
- 用户积分减少 1
- 我的解析里能看到记录

---

### 9.6 测子域保护

假设用户 A 创建：

```text
a.example.com
```

用户 B 再创建：

```text
b.a.example.com
```

应该失败：

```text
该域名暂时无法创建
```

用户 A 自己创建：

```text
c.a.example.com
```

应该成功。

---

### 9.7 测启停和删除

停用：

- Cloudflare 记录删除
- 平台记录保留
- 不退积分

再启用：

- Cloudflare 记录重新创建
- 不重复扣积分

删除：

- Cloudflare 记录删除
- 平台记录删除
- 默认不退积分

---

## 10. 你推上线后让我帮你测，需要给我什么

给我这些就行：

1. DNS Worker 地址

```text
https://xxx.workers.dev
```

2. GGU Web 地址

```text
https://ggu.edu.kg
```

3. 管理员邮箱

```text
admin@xxx.com
```

4. 测试域名

```text
example.com
```

5. 允许的解析类型

```text
A,AAAA
```

6. 一个可以用来测的子域名前缀

```text
claude-test.example.com
```

7. 如果你要我直接进后台测，需要提供一个临时管理员 `mail_token`。如果不想给 token，你可以自己打开后台，我一步步告诉你点哪里。

---

## 11. 最简检查表

上线前确认：

```text
[ ] DNS_KV 已绑定
[ ] MAIL_API_BASE_URL 正确
[ ] ALLOWED_ORIGIN 是 GGU Web 域名
[ ] DNS_ADMIN_EMAILS 包含管理员邮箱
[ ] CREDENTIALS_ENCRYPTION_KEY 已设置 secret
[ ] GGU Web 配了 NUXT_PUBLIC_DNS_API_BASE_URL
[ ] CF Token 有 Zone:Zone:Read 和 Zone:DNS:Edit
[ ] /admin.html 能进入
[ ] CF 账户能自动读到账户名称
[ ] 域名池只填域名 + 选账户能接入成功
[ ] /services 能打开 DNS 前台
[ ] 能创建测试解析
```
