import type { BlacklistRule, CfAccount, CfAuthType, DnsRecordType, DnsUser, Env, ManagedDomain, Settings } from './types'
import { getCurrentMailUser, requireAdmin, requireUser } from './auth'
import { encryptSecret, listCloudflareAccounts, listZones } from './cloudflare'
import { findManagedDomain, normalizeHostname } from './domain'
import { ResponseError, corsHeaders, fail, nowIso, ok, randomId, readJson } from './http'
import {
  deleteBlacklist,
  deleteCfAccount,
  deleteDomain,
  deleteUser,
  getCfAccount,
  getSettings,
  getUser,
  getUserByEmail,
  listBlacklist,
  listCfAccounts,
  listDomains,
  listDomainRecords,
  listUserPointLogs,
  listUsers,
  putBlacklist,
  putCfAccount,
  putDomain,
  putSettings,
  putUser
} from './kv'
import { adjustPoints } from './points'
import {
  createUserRecord,
  deleteUserRecord,
  listAllRecordSummaries,
  listUserRecordSummaries,
  recordsMeta,
  toggleUserRecord,
  updateUserRecord
} from './records'

const SUPPORTED_TYPES: DnsRecordType[] = [
  'A',
  'AAAA',
  'CNAME',
  'HTTPS',
  'TXT',
  'SRV',
  'LOC',
  'MX',
  'NS',
  'CERT',
  'DNSKEY',
  'DS',
  'NAPTR',
  'SMIMEA',
  'SSHFP',
  'SVCB',
  'TLSA',
  'URI',
  'CAA'
]

const withCors = (request: Request, env: Env, response: Response) => {
  const headers = new Headers(response.headers)
  for (const [key, value] of Object.entries(corsHeaders(request, env))) headers.set(key, value)
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

const segmentsOf = (url: URL) => url.pathname.split('/').filter(Boolean)

const adminEmails = (env: Env) =>
  env.DNS_ADMIN_EMAILS.split(',')
    .map(item => item.trim().toLowerCase())
    .filter(Boolean)

const isAdminEmail = (env: Env, email: string) => adminEmails(env).includes(email.toLowerCase())

const requireBody = <T = Record<string, unknown>>(request: Request) => readJson<T>(request)

const redactAccount = (account: CfAccount) => ({
  id: account.id,
  name: account.name,
  remark: account.remark,
  accountId: account.accountId,
  authType: account.authType,
  email: account.email,
  hasApiToken: Boolean(account.apiTokenEncrypted),
  hasApiKey: Boolean(account.apiKeyEncrypted),
  createdAt: account.createdAt,
  updatedAt: account.updatedAt
})

const parseAllowedTypes = (value: unknown, fallback: DnsRecordType[]) => {
  if (value === undefined) return fallback
  if (!Array.isArray(value)) throw new ResponseError('解析类型配置不正确', 400)
  const next = value.map(item => String(item).toUpperCase() as DnsRecordType)
  if (next.some(item => !SUPPORTED_TYPES.includes(item))) {
    throw new ResponseError('解析类型配置不正确', 400)
  }
  return next
}

const patchSettings = (settings: Settings, body: Record<string, unknown>): Settings => {
  const next: Settings = {
    ...settings,
    protectionEnabled:
      body.protectionEnabled === undefined ? settings.protectionEnabled : Boolean(body.protectionEnabled),
    initialPoints: body.initialPoints === undefined ? settings.initialPoints : Number(body.initialPoints),
    deleteRefundEnabled:
      body.deleteRefundEnabled === undefined ? settings.deleteRefundEnabled : Boolean(body.deleteRefundEnabled),
    allowedTypes: parseAllowedTypes(body.allowedTypes, settings.allowedTypes),
    defaultTtl: body.defaultTtl === undefined ? settings.defaultTtl : Number(body.defaultTtl),
    updatedAt: nowIso()
  }
  if (!Number.isFinite(next.initialPoints) || next.initialPoints < 0) throw new ResponseError('初始积分配置不正确', 400)
  if (!Number.isFinite(next.defaultTtl) || next.defaultTtl < 60) throw new ResponseError('默认 TTL 不正确', 400)
  return next
}

const accountFromBody = async (env: Env, body: Record<string, unknown>, existing?: CfAccount): Promise<CfAccount> => {
  const now = nowIso()
  const authType = String(body.authType || existing?.authType || 'token') as CfAuthType
  if (authType !== 'token' && authType !== 'key_email') throw new ResponseError('Cloudflare 鉴权类型不正确', 400)
  const account: CfAccount = {
    id: existing?.id || randomId(),
    name: existing?.name || 'Cloudflare Account',
    remark: body.remark === undefined ? existing?.remark : String(body.remark || '').trim(),
    accountId: existing?.accountId,
    authType,
    email: body.email === undefined ? existing?.email : String(body.email || '').trim(),
    apiTokenEncrypted: existing?.apiTokenEncrypted,
    apiKeyEncrypted: existing?.apiKeyEncrypted,
    createdAt: existing?.createdAt || now,
    updatedAt: now
  }
  if (body.apiToken) account.apiTokenEncrypted = await encryptSecret(env, String(body.apiToken))
  if (body.apiKey) account.apiKeyEncrypted = await encryptSecret(env, String(body.apiKey))
  if (authType === 'token' && !account.apiTokenEncrypted) throw new ResponseError('API Token 不能为空', 400)
  if (authType === 'key_email' && (!account.email || !account.apiKeyEncrypted)) {
    throw new ResponseError('邮箱和 API Key 不能为空', 400)
  }

  try {
    const accounts = await listCloudflareAccounts(env, account)
    const first = accounts[0]
    if (first) {
      account.name = first.name || account.name
      account.accountId = first.id || account.accountId
    }
  } catch (error) {
    if (!existing) throw error
  }

  return account
}

const resolveDomainZone = async (env: Env, account: CfAccount, root: string) => {
  const zones = await listZones(env, account)
  const zone = zones.find(item => item.name.toLowerCase() === root.toLowerCase())
  if (!zone) throw new ResponseError('该 Cloudflare 账户下没有这个域名', 400)
  return zone
}

const domainFromBody = async (
  env: Env,
  body: Record<string, unknown>,
  settings: Settings,
  existing?: ManagedDomain
): Promise<ManagedDomain> => {
  const now = nowIso()
  const root = normalizeHostname(String(body.root || existing?.root || ''))
  const cfAccountId = String(body.cfAccountId || existing?.cfAccountId || '').trim()
  if (!cfAccountId) throw new ResponseError('Cloudflare 账户不能为空', 400)
  const account = await getCfAccount(env, cfAccountId)
  if (!account) throw new ResponseError('Cloudflare 账户不存在', 400)
  const zone = await resolveDomainZone(env, account, root)
  return {
    root,
    zoneId: zone.id,
    cfAccountId,
    enabled: body.enabled === undefined ? existing?.enabled ?? true : Boolean(body.enabled),
    allowedTypes: body.allowedTypes === undefined ? existing?.allowedTypes : parseAllowedTypes(body.allowedTypes, settings.allowedTypes),
    defaultTtl: body.defaultTtl === undefined ? existing?.defaultTtl : Number(body.defaultTtl),
    proxiedDefault: body.proxiedDefault === undefined ? existing?.proxiedDefault : Boolean(body.proxiedDefault),
    pointCost: body.pointCost === undefined ? existing?.pointCost : Number(body.pointCost),
    createdAt: existing?.createdAt || now,
    updatedAt: now
  }
}

const loginToMail = async (env: Env, email: string, password: string) => {
  const res = await fetch(`${env.MAIL_API_BASE_URL.replace(/\/$/, '')}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password })
  })
  const payload = await res.json<{ code?: number; message?: string; data?: { token?: string }; token?: string }>().catch(() => null)
  if (!res.ok || !payload) throw new ResponseError('通行证登录失败', 401)
  const token = payload.data?.token || payload.token
  if (!token) throw new ResponseError(payload.message || '通行证登录失败', 401)
  return token
}

const makeAuthRequest = (token: string) =>
  new Request('https://ggudnsapi.local/api/auth/me', {
    headers: { Authorization: token }
  })

const handleAuth = async (request: Request, env: Env, segments: string[]) => {
  if (request.method === 'POST' && segments[2] === 'admin-login') {
    const body = await requireBody(request)
    const email = String(body.email || '').trim()
    const password = String(body.password || '')
    if (!email || !password) throw new ResponseError('请输入邮箱和密码', 400)
    const token = await loginToMail(env, email, password)
    const mailUser = await getCurrentMailUser(makeAuthRequest(token), env)
    const dnsUser = await requireUser(makeAuthRequest(token), env).then(ctx => ctx.dnsUser)
    if (!isAdminEmail(env, mailUser.email)) throw new ResponseError('当前账号不是 DNS 管理员', 403)
    return ok({ token, mailUser, user: dnsUser, isAdmin: true })
  }
  if ((request.method === 'GET' && segments[2] === 'me') || (request.method === 'POST' && segments[2] === 'callback')) {
    const { mailUser, dnsUser } = await requireUser(request, env)
    return ok({ mailUser, user: dnsUser, isAdmin: isAdminEmail(env, mailUser.email) })
  }
  throw new ResponseError('接口不存在', 404)
}

const handleRecords = async (request: Request, env: Env, segments: string[]) => {
  const settings = await getSettings(env)
  if (request.method === 'GET' && segments[2] === 'meta') {
    return ok(await recordsMeta(env, settings))
  }
  const { dnsUser } = await requireUser(request, env)
  if (request.method === 'GET' && segments.length === 2) return ok(await listUserRecordSummaries(env, dnsUser))
  if (request.method === 'POST' && segments.length === 2) {
    const body = await requireBody(request)
    return ok(await createUserRecord(env, request, dnsUser, settings, body))
  }
  const id = segments[2]
  if (!id) throw new ResponseError('接口不存在', 404)
  if (request.method === 'PATCH' && segments[3] === 'toggle') return ok(await toggleUserRecord(env, dnsUser, settings, id))
  if (request.method === 'PATCH' && segments.length === 3) {
    const body = await requireBody(request)
    return ok(await updateUserRecord(env, dnsUser, settings, id, body))
  }
  if (request.method === 'DELETE' && segments.length === 3) return ok(await deleteUserRecord(env, dnsUser, settings, id))
  throw new ResponseError('接口不存在', 404)
}

const handlePoints = async (request: Request, env: Env) => {
  if (request.method !== 'GET') throw new ResponseError('接口不存在', 404)
  const { dnsUser } = await requireUser(request, env)
  return ok({ balance: dnsUser.points, logs: await listUserPointLogs(env, dnsUser.uid) })
}

const makeManualUser = async (env: Env, body: Record<string, unknown>, existing?: DnsUser): Promise<DnsUser> => {
  const now = nowIso()
  const email = String(body.email || existing?.email || '').trim().toLowerCase()
  if (!email || !email.includes('@')) throw new ResponseError('邮箱不正确', 400)
  const uid = String(body.uid || existing?.uid || email).trim()
  if (!uid) throw new ResponseError('UID 不能为空', 400)
  const points = body.points === undefined ? existing?.points ?? 0 : Number(body.points)
  if (!Number.isFinite(points) || points < 0) throw new ResponseError('积分不正确', 400)
  return {
    uid,
    email,
    name: body.name === undefined ? existing?.name : String(body.name || '').trim(),
    points,
    initialGrantDone: true,
    banned: body.banned === undefined ? existing?.banned : Boolean(body.banned),
    bannedReason: body.bannedReason === undefined ? existing?.bannedReason : String(body.bannedReason || '').trim(),
    createdAt: existing?.createdAt || now,
    lastSeenAt: existing?.lastSeenAt || now
  }
}

const handleAdminUsers = async (request: Request, env: Env, segments: string[]) => {
  if (request.method === 'GET' && segments.length === 3) {
    const records = await listAllRecordSummaries(env)
    const users = await listUsers(env)
    return ok(
      users.map(user => ({
        ...user,
        recordCount: records.filter(record => record.uid === user.uid).length
      }))
    )
  }
  if (request.method === 'POST' && segments.length === 3) {
    const body = await requireBody(request)
    const existing = await getUserByEmail(env, String(body.email || '').trim().toLowerCase())
    if (existing) throw new ResponseError('该邮箱用户已存在', 400)
    const user = await makeManualUser(env, body)
    await putUser(env, user)
    return ok(user)
  }
  if (request.method === 'PATCH' && segments[4] === 'points') {
    const uid = segments[3]
    const user = await getUser(env, uid)
    if (!user) throw new ResponseError('用户不存在', 404)
    const body = await requireBody(request)
    const delta = Number(body.delta)
    const result = await adjustPoints(env, user, delta, typeof body.message === 'string' ? body.message : undefined)
    return ok(result)
  }
  if (request.method === 'PATCH' && segments[4] === 'ban') {
    const uid = segments[3]
    const user = await getUser(env, uid)
    if (!user) throw new ResponseError('用户不存在', 404)
    const body = await requireBody(request)
    const next: DnsUser = {
      ...user,
      banned: body.banned === undefined ? true : Boolean(body.banned),
      bannedReason: typeof body.reason === 'string' ? body.reason : user.bannedReason,
      lastSeenAt: nowIso()
    }
    await putUser(env, next)
    return ok(next)
  }
  if (request.method === 'DELETE' && segments.length === 4) {
    const uid = segments[3]
    const user = await getUser(env, uid)
    if (!user) throw new ResponseError('用户不存在', 404)
    const records = await listUserRecordSummaries(env, user)
    if (records.length > 0) throw new ResponseError('该用户仍有解析记录，请先删除解析或封禁用户', 400)
    await deleteUser(env, user)
    return ok({ uid })
  }
  throw new ResponseError('接口不存在', 404)
}

const handleAdminAccounts = async (request: Request, env: Env, segments: string[]) => {
  if (request.method === 'GET' && segments.length === 3) return ok((await listCfAccounts(env)).map(redactAccount))
  if (request.method === 'POST' && segments.length === 3) {
    const account = await accountFromBody(env, await requireBody(request))
    await putCfAccount(env, account)
    return ok(redactAccount(account))
  }
  const id = segments[3]
  const existing = id ? await getCfAccount(env, id) : null
  if (!existing) throw new ResponseError('Cloudflare 账户不存在', 404)
  if (request.method === 'GET' && segments[4] === 'zones') return ok(await listZones(env, existing))
  if (request.method === 'PATCH' && segments.length === 4) {
    const account = await accountFromBody(env, await requireBody(request), existing)
    await putCfAccount(env, account)
    return ok(redactAccount(account))
  }
  if (request.method === 'DELETE' && segments.length === 4) {
    const used = (await listDomains(env)).some(domain => domain.cfAccountId === id)
    if (used) throw new ResponseError('该账户仍被域名池引用，不能删除', 400)
    await deleteCfAccount(env, id)
    return ok({ id })
  }
  throw new ResponseError('接口不存在', 404)
}

const handleAdminDomains = async (request: Request, env: Env, segments: string[]) => {
  const settings = await getSettings(env)
  if (request.method === 'GET' && segments.length === 3) return ok(await listDomains(env))
  if (request.method === 'POST' && segments.length === 3) {
    const domain = await domainFromBody(env, await requireBody(request), settings)
    await putDomain(env, domain)
    return ok(domain)
  }
  const root = segments[3] ? decodeURIComponent(segments[3]) : ''
  const existing = (await listDomains(env)).find(item => item.root === root)
  if (!existing) throw new ResponseError('域名不存在', 404)
  if (request.method === 'PATCH' && segments.length === 4) {
    const domain = await domainFromBody(env, await requireBody(request), settings, existing)
    await putDomain(env, domain)
    return ok(domain)
  }
  if (request.method === 'DELETE' && segments.length === 4) {
    const records = await listDomainRecords(env, existing.root)
    if (records.length > 0) {
      const next = { ...existing, enabled: false, updatedAt: nowIso() }
      await putDomain(env, next)
      return ok(next)
    }
    await deleteDomain(env, existing.root)
    return ok({ root: existing.root })
  }
  throw new ResponseError('接口不存在', 404)
}

const handleAdminBlacklist = async (request: Request, env: Env, segments: string[]) => {
  if (request.method === 'GET' && segments.length === 3) return ok(await listBlacklist(env))
  if (request.method === 'POST' && segments.length === 3) {
    const body = await requireBody(request)
    const rule: BlacklistRule = {
      id: randomId(),
      pattern: String(body.pattern || '').trim().toLowerCase(),
      type: String(body.type || 'exact') as BlacklistRule['type'],
      target: String(body.target || 'domain') as BlacklistRule['target'],
      reason: typeof body.reason === 'string' ? body.reason : undefined,
      createdAt: nowIso()
    }
    if (!rule.pattern) throw new ResponseError('黑名单规则不能为空', 400)
    if (!['exact', 'suffix', 'contains', 'wildcard'].includes(rule.type)) throw new ResponseError('黑名单匹配类型不正确', 400)
    if (!['domain', 'user'].includes(rule.target)) throw new ResponseError('黑名单目标不正确', 400)
    await putBlacklist(env, rule)
    return ok(rule)
  }
  if (request.method === 'DELETE' && segments[3]) {
    await deleteBlacklist(env, segments[3])
    return ok({ id: segments[3] })
  }
  throw new ResponseError('接口不存在', 404)
}

const handleAdminSettings = async (request: Request, env: Env) => {
  const settings = await getSettings(env)
  if (request.method === 'GET') return ok(settings)
  if (request.method === 'PATCH') {
    const next = patchSettings(settings, await requireBody(request))
    await putSettings(env, next)
    return ok(next)
  }
  throw new ResponseError('接口不存在', 404)
}

const handleAdmin = async (request: Request, env: Env, segments: string[]) => {
  await requireAdmin(request, env)
  if (segments[2] === 'users') return handleAdminUsers(request, env, segments)
  if (segments[2] === 'cf-accounts') return handleAdminAccounts(request, env, segments)
  if (segments[2] === 'domains') return handleAdminDomains(request, env, segments)
  if (segments[2] === 'blacklist') return handleAdminBlacklist(request, env, segments)
  if (segments[2] === 'settings') return handleAdminSettings(request, env)
  if (segments[2] === 'records' && request.method === 'GET') return ok(await listAllRecordSummaries(env))
  throw new ResponseError('接口不存在', 404)
}

const handleApi = async (request: Request, env: Env) => {
  const url = new URL(request.url)
  const segments = segmentsOf(url)
  if (segments[0] !== 'api') throw new ResponseError('接口不存在', 404)
  if (segments[1] === 'auth') return handleAuth(request, env, segments)
  if (segments[1] === 'records') return handleRecords(request, env, segments)
  if (segments[1] === 'points') return handlePoints(request, env)
  if (segments[1] === 'admin') return handleAdmin(request, env, segments)
  throw new ResponseError('接口不存在', 404)
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env) })
    const url = new URL(request.url)
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request)

    try {
      return withCors(request, env, await handleApi(request, env))
    } catch (error) {
      if (error instanceof ResponseError) return withCors(request, env, fail(error.message, error.status))
      console.error(error)
      return withCors(request, env, fail('服务器内部错误', 500))
    }
  }
}
