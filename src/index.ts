import type {
  BanReasonPreset,
  BlacklistRule,
  CfAccount,
  CfAuthType,
  DnsRecordType,
  DnsUser,
  Env,
  ManagedDomain,
  Settings
} from './types'
import { getCurrentMailUser, requireAdmin, requireUser } from './auth'
import { encryptSecret, listCloudflareAccounts, listZones } from './cloudflare'
import { findManagedDomain, normalizeHostname } from './domain'
import { ResponseError, corsHeaders, fail, nowIso, ok, randomId, readJson } from './http'
import {
  deleteBlacklist,
  deleteCfAccount,
  getBanReasonPreset,
  getCfAccount,
  getRedemptionCodeIndex,
  getRedemptionCodeIndexByHash,
  getRecord,
  getSettings,
  getUser,
  getUserByEmail,
  listBanReasonPresets,
  listBlacklist,
  listCfAccounts,
  listDomains,
  listRedemptionCodeIndexes,
  listUserPointLogs,
  listUsers,
  putBanReasonPreset,
  putBlacklist,
  putCfAccount,
  putRedemptionCodeIndex,
  putSettings
} from './kv'
import { redeemPoints } from './points'
export { DomainCoordinator } from './domain-coordinator'
export { RedemptionCodeObject } from './redemption'
export { UserAccessObject } from './user-access'
export { UserCoordinator } from './user-coordinator'
export { UserPointsObject } from './user-points'
import {
  listAllRecordSummaries,
  listUserRecordSummaries,
  recordsMeta
} from './records'
import {
  deleteCoordinatedDomain,
  getCoordinatedDomain,
  putCoordinatedDomain
} from './domain-coordinator-client'
import {
  adjustCoordinatedPoints,
  createCoordinatedUser,
  createUserCoordinatedRecord,
  deleteCoordinatedUser,
  deleteUserCoordinatedRecord,
  setCoordinatedBan,
  toggleUserCoordinatedRecord,
  updateUserCoordinatedRecord
} from './user-coordinator-client'

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

const normalizeRedemptionCode = (value: unknown) => String(value || '').trim().toUpperCase().replace(/\s+/g, '')

const hashRedemptionCode = async (value: string) => {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

const generateRedemptionCode = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  const body = Array.from(bytes, byte => alphabet[byte % alphabet.length]).join('')
  return `GGU-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}-${body.slice(12)}`
}

const validateCustomRedemptionCode = (value: string) => {
  if (value.length < 12 || value.length > 64) throw new ResponseError('自定义兑换码长度应为 12 至 64 位', 400)
  if (!/^[A-Z0-9][A-Z0-9_-]+$/.test(value)) throw new ResponseError('兑换码只能包含字母、数字、下划线或连字符', 400)
  if (!/[A-Z]/.test(value) || !/\d/.test(value)) throw new ResponseError('自定义兑换码必须同时包含字母和数字', 400)
}

const maskRedemptionCode = (value: string) => {
  const compact = value.replace(/-/g, '')
  return `${compact.slice(0, 4)}••••${compact.slice(-4)}`
}

const redemptionErrorMessage = (reason?: string) => {
  if (reason === 'already_redeemed') return '你已经使用过这个兑换码'
  if (reason === 'inactive') return '该兑换码已停用'
  if (reason === 'expired') return '该兑换码已过期'
  if (reason === 'exhausted') return '该兑换码已达到使用次数上限'
  return '兑换码无效'
}

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
  if (!Number.isSafeInteger(next.initialPoints) || next.initialPoints < 0) throw new ResponseError('初始积分配置不正确', 400)
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
    if (!isAdminEmail(env, mailUser.email)) throw new ResponseError('当前账号不是 DNS 管理员', 403)
    const dnsUser = await requireAdmin(makeAuthRequest(token), env).then(ctx => ctx.dnsUser)
    return ok({ token, mailUser, user: dnsUser, isAdmin: true })
  }
  if (request.method === 'GET' && segments[2] === 'me') {
    const mailUser = await getCurrentMailUser(request, env)
    if (isAdminEmail(env, mailUser.email)) {
      const { dnsUser } = await requireAdmin(request, env)
      return ok({ mailUser, user: dnsUser, isAdmin: true })
    }
    const { dnsUser } = await requireUser(request, env)
    return ok({ mailUser, user: dnsUser, isAdmin: false })
  }
  if (request.method === 'POST' && segments[2] === 'callback') {
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
    const domain = findManagedDomain(String(body.fullDomain || ''), await listDomains(env))
    return ok(await createUserCoordinatedRecord(env, dnsUser.uid, domain.root, request, settings, body))
  }
  const id = segments[2]
  if (!id) throw new ResponseError('接口不存在', 404)
  if (request.method === 'PATCH' && segments[3] === 'toggle') {
    const record = await getRecord(env, id)
    if (!record) throw new ResponseError('解析记录不存在', 404)
    return ok(await toggleUserCoordinatedRecord(env, dnsUser.uid, record.root, settings, id))
  }
  if (request.method === 'PATCH' && segments.length === 3) {
    const record = await getRecord(env, id)
    if (!record) throw new ResponseError('解析记录不存在', 404)
    const body = await requireBody(request)
    return ok(await updateUserCoordinatedRecord(env, dnsUser.uid, record.root, settings, id, body))
  }
  if (request.method === 'DELETE' && segments.length === 3) {
    const record = await getRecord(env, id)
    if (!record) throw new ResponseError('解析记录不存在', 404)
    return ok(await deleteUserCoordinatedRecord(env, dnsUser.uid, record.root, settings, id))
  }
  throw new ResponseError('接口不存在', 404)
}

const handlePoints = async (request: Request, env: Env, segments: string[]) => {
  const { dnsUser } = await requireUser(request, env)
  if (request.method === 'GET' && segments.length === 2) {
    const balance = await env.USER_POINTS.getByName(dnsUser.uid).getBalance(dnsUser.points)
    const durableLogs = await env.USER_POINTS.getByName(dnsUser.uid).listPointLogs()
    const legacyLogs = await listUserPointLogs(env, dnsUser.uid)
    const logs = Array.from(new Map([...durableLogs, ...legacyLogs].map(log => [log.id, log])).values())
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    return ok({ balance: balance ?? dnsUser.points, logs })
  }
  if (request.method === 'POST' && segments[2] === 'redeem') {
    const body = await requireBody(request)
    const plainCode = normalizeRedemptionCode(body.code)
    if (!plainCode) throw new ResponseError('请输入兑换码', 400)
    if (plainCode.length < 8 || plainCode.length > 64 || !/^[A-Z0-9_-]+$/.test(plainCode)) {
      throw new ResponseError('兑换码格式不正确', 400)
    }
    const secretHash = await hashRedemptionCode(plainCode)
    const codeIndex = await getRedemptionCodeIndexByHash(env, secretHash)
    if (!codeIndex) throw new ResponseError('兑换码无效', 404)
    const stub = env.REDEMPTION_CODES.getByName(codeIndex.objectName)
    const code = await stub.getCode()
    if (!code || code.secretHash !== secretHash) throw new ResponseError('兑换码无效', 404)
    const prior = await stub.getUse(dnsUser.uid)
    if (prior?.status === 'pending') {
      const priorLog = await env.USER_POINTS.getByName(dnsUser.uid).getOperation(`redemption:${prior.id}`)
      if (priorLog) {
        const completedUse = await stub.complete(prior.id, priorLog.id)
        throw new ResponseError('你已经使用过这个兑换码', 409, {
          code: 'REDEMPTION_ALREADY_COMPLETED',
          use: completedUse
        })
      }
    }
    const reservation = await stub.reserve(dnsUser.uid, dnsUser.email)
    if (!reservation.ok || !reservation.use) {
      throw new ResponseError(redemptionErrorMessage(reservation.reason), 409)
    }
    try {
      const result = await redeemPoints(env, dnsUser, reservation.use.points, code.id, reservation.use.id)
      const use = await stub.complete(reservation.use.id, result.log.id)
      return ok({ user: result.user, log: result.log, use })
    } catch (error) {
      const committed = await env.USER_POINTS.getByName(dnsUser.uid).getOperation(`redemption:${reservation.use.id}`)
      if (!committed) await stub.cancel(reservation.use.id)
      throw error
    }
  }
  throw new ResponseError('接口不存在', 404)
}

const makeManualUser = async (env: Env, body: Record<string, unknown>, existing?: DnsUser): Promise<DnsUser> => {
  const now = nowIso()
  const email = String(body.email || existing?.email || '').trim().toLowerCase()
  if (!email || !email.includes('@')) throw new ResponseError('邮箱不正确', 400)
  const uid = String(body.uid || existing?.uid || email).trim()
  if (!uid) throw new ResponseError('UID 不能为空', 400)
  const points = body.points === undefined ? existing?.points ?? 0 : Number(body.points)
  if (!Number.isSafeInteger(points) || points < 0) throw new ResponseError('积分不正确', 400)
  return {
    uid,
    email,
    name: body.name === undefined ? existing?.name : String(body.name || '').trim(),
    points,
    initialGrantDone: true,
    banned: body.banned === undefined ? existing?.banned : Boolean(body.banned),
    bannedReason: body.bannedReason === undefined ? existing?.bannedReason : String(body.bannedReason || '').trim(),
    bannedAt: body.bannedAt === undefined ? existing?.bannedAt : String(body.bannedAt || '').trim() || undefined,
    bannedByUid: existing?.bannedByUid,
    bannedByEmail: existing?.bannedByEmail,
    createdAt: existing?.createdAt || now,
    lastSeenAt: existing?.lastSeenAt || now
  }
}

const handleAdminUsers = async (
  request: Request,
  env: Env,
  segments: string[],
  admin: Awaited<ReturnType<typeof requireAdmin>>
) => {
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
    return ok(await createCoordinatedUser(env, user))
  }
  if (request.method === 'PATCH' && segments[4] === 'points') {
    const uid = decodeURIComponent(segments[3])
    const body = await requireBody(request)
    return ok(
      await adjustCoordinatedPoints(
        env,
        uid,
        Number(body.delta),
        typeof body.message === 'string' ? body.message : undefined,
        typeof body.operationId === 'string' && body.operationId ? body.operationId : randomId()
      )
    )
  }
  if (request.method === 'GET' && segments[4] === 'ban-events') {
    const uid = segments[3]
    const user = await getUser(env, uid)
    if (!user) throw new ResponseError('用户不存在', 404)
    return ok(await env.USER_ACCESS.getByName(uid).listEvents())
  }
  if (request.method === 'PATCH' && segments[4] === 'ban') {
    const uid = decodeURIComponent(segments[3])
    const user = await getUser(env, uid)
    if (!user) throw new ResponseError('用户不存在', 404)
    const body = await requireBody(request)
    const banned = body.banned === undefined ? true : Boolean(body.banned)
    const presetId = typeof body.presetId === 'string' ? body.presetId.trim() : ''
    const preset = presetId ? await getBanReasonPreset(env, presetId) : null
    if (presetId && (!preset || !preset.active)) throw new ResponseError('封禁理由预设不存在或已停用', 400)
    const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : preset?.reason
    if (banned && !reason) throw new ResponseError('请选择或填写封禁理由', 400)
    return ok(
      await setCoordinatedBan(env, uid, {
        banned,
        reason: banned ? reason : typeof body.reason === 'string' ? body.reason.trim() || undefined : undefined,
        presetId: banned && preset ? preset.id : undefined,
        actorUid: admin.mailUser.uid,
        actorEmail: admin.mailUser.email,
        operationId: typeof body.operationId === 'string' && body.operationId ? body.operationId : randomId()
      })
    )
  }
  if (request.method === 'DELETE' && segments.length === 4) {
    return ok(await deleteCoordinatedUser(env, decodeURIComponent(segments[3])))
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
    return ok(await putCoordinatedDomain(env, domain, 'create'))
  }
  const root = segments[3] ? normalizeHostname(decodeURIComponent(segments[3])) : ''
  const existing = root ? await getCoordinatedDomain(env, root) : null
  if (!existing) throw new ResponseError('域名不存在', 404)
  if (request.method === 'PATCH' && segments.length === 4) {
    const body = await requireBody(request)
    if (body.root !== undefined && normalizeHostname(String(body.root)) !== existing.root) {
      throw new ResponseError('域名不可修改', 400)
    }
    const domain = await domainFromBody(env, { ...body, root: existing.root }, settings, existing)
    return ok(await putCoordinatedDomain(env, domain, 'update'))
  }
  if (request.method === 'DELETE' && segments.length === 4) {
    return ok(await deleteCoordinatedDomain(env, existing.root))
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

const handleAdminBanReasonPresets = async (
  request: Request,
  env: Env,
  segments: string[],
  admin: Awaited<ReturnType<typeof requireAdmin>>
) => {
  if (request.method === 'GET' && segments.length === 3) return ok(await listBanReasonPresets(env))
  if (request.method === 'POST' && segments.length === 3) {
    const body = await requireBody(request)
    const reason = String(body.reason || '').trim()
    if (reason.length < 2 || reason.length > 200) throw new ResponseError('封禁理由长度应为 2 至 200 位', 400)
    const now = nowIso()
    const preset: BanReasonPreset = {
      id: randomId(),
      reason,
      active: true,
      createdAt: now,
      updatedAt: now,
      createdByUid: admin.mailUser.uid,
      createdByEmail: admin.mailUser.email
    }
    await putBanReasonPreset(env, preset)
    return ok(preset)
  }
  const id = segments[3]
  if (!id) throw new ResponseError('接口不存在', 404)
  const existing = await getBanReasonPreset(env, id)
  if (!existing) throw new ResponseError('封禁理由预设不存在', 404)
  if (request.method === 'PATCH' && segments.length === 4) {
    const body = await requireBody(request)
    const reason = body.reason === undefined ? existing.reason : String(body.reason || '').trim()
    if (reason.length < 2 || reason.length > 200) throw new ResponseError('封禁理由长度应为 2 至 200 位', 400)
    const next: BanReasonPreset = {
      ...existing,
      reason,
      active: body.active === undefined ? existing.active : Boolean(body.active),
      updatedAt: nowIso()
    }
    await putBanReasonPreset(env, next)
    return ok(next)
  }
  if (request.method === 'DELETE' && segments.length === 4) {
    const next = { ...existing, active: false, updatedAt: nowIso() }
    await putBanReasonPreset(env, next)
    return ok(next)
  }
  throw new ResponseError('接口不存在', 404)
}

const handleAdminRedemptionCodes = async (
  request: Request,
  env: Env,
  segments: string[],
  admin: Awaited<ReturnType<typeof requireAdmin>>
) => {
  if (request.method === 'GET' && segments.length === 3) {
    const codes = await Promise.all(
      (await listRedemptionCodeIndexes(env)).map(index => env.REDEMPTION_CODES.getByName(index.objectName).getCode())
    )
    const summaries = codes.flatMap(code => {
      if (!code) return []
      const { secretHash: _secretHash, ...summary } = code
      return [summary]
    })
    return ok(summaries)
  }
  if (request.method === 'POST' && segments.length === 3) {
    const body = await requireBody(request)
    const mode = body.mode === 'custom' ? 'custom' : 'generated'
    const plainCode = mode === 'custom' ? normalizeRedemptionCode(body.code) : generateRedemptionCode()
    if (mode === 'custom') validateCustomRedemptionCode(plainCode)
    const points = Number(body.points)
    const maxUses = Number(body.maxUses)
    if (!Number.isSafeInteger(points) || points <= 0 || points > 1_000_000) {
      throw new ResponseError('每次兑换积分应为 1 至 1000000 的整数', 400)
    }
    if (!Number.isSafeInteger(maxUses) || maxUses <= 0 || maxUses > 1_000_000) {
      throw new ResponseError('总兑换次数应为 1 至 1000000 的整数', 400)
    }
    const expiresAt = typeof body.expiresAt === 'string' && body.expiresAt ? new Date(body.expiresAt).toISOString() : undefined
    if (expiresAt && Date.parse(expiresAt) <= Date.now()) throw new ResponseError('过期时间必须晚于当前时间', 400)
    const secretHash = await hashRedemptionCode(plainCode)
    if (await getRedemptionCodeIndexByHash(env, secretHash)) throw new ResponseError('该兑换码已存在', 409)
    const id = randomId()
    const createdAt = nowIso()
    const stub = env.REDEMPTION_CODES.getByName(secretHash)
    const result = await stub.create({
      id,
      label: String(body.label || '').trim() || `兑换 ${points} 积分`,
      secretHash,
      maskedCode: maskRedemptionCode(plainCode),
      points,
      maxUses,
      expiresAt,
      createdAt,
      createdByUid: admin.mailUser.uid,
      createdByEmail: admin.mailUser.email
    })
    if (!result.created) {
      await putRedemptionCodeIndex(env, result.code.id, secretHash)
      throw new ResponseError('该兑换码已存在，索引已修复', 409)
    }
    try {
      await putRedemptionCodeIndex(env, id, secretHash)
    } catch (error) {
      await stub.setActive(false)
      throw error
    }
    return ok({ code: result.code, plainCode })
  }
  const id = segments[3]
  if (!id) throw new ResponseError('接口不存在', 404)
  const index = await getRedemptionCodeIndex(env, id)
  if (!index) throw new ResponseError('兑换码不存在', 404)
  const stub = env.REDEMPTION_CODES.getByName(index.objectName)
  if (request.method === 'GET' && segments[4] === 'uses') {
    const url = new URL(request.url)
    return ok(await stub.listUses(Number(url.searchParams.get('page') || 1), Number(url.searchParams.get('pageSize') || 50)))
  }
  if (request.method === 'PATCH' && segments.length === 4) {
    const body = await requireBody(request)
    const code = await stub.setActive(Boolean(body.active))
    if (!code) throw new ResponseError('兑换码不存在', 404)
    return ok(code)
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
  const admin = await requireAdmin(request, env)
  if (segments[2] === 'users') return handleAdminUsers(request, env, segments, admin)
  if (segments[2] === 'cf-accounts') return handleAdminAccounts(request, env, segments)
  if (segments[2] === 'domains') return handleAdminDomains(request, env, segments)
  if (segments[2] === 'blacklist') return handleAdminBlacklist(request, env, segments)
  if (segments[2] === 'ban-reason-presets') return handleAdminBanReasonPresets(request, env, segments, admin)
  if (segments[2] === 'redemption-codes') return handleAdminRedemptionCodes(request, env, segments, admin)
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
  if (segments[1] === 'points') return handlePoints(request, env, segments)
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
      if (error instanceof ResponseError) return withCors(request, env, fail(error.message, error.status, {}, error.data))
      console.error(error)
      return withCors(request, env, fail('服务器内部错误', 500))
    }
  }
}
