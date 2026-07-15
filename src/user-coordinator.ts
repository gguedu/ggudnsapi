import { DurableObject } from 'cloudflare:workers'
import type { BanEvent, DnsRecord, DnsUser, Env, MailUserInfo, Settings } from './types'
import { ResponseError, nowIso, randomId } from './http'
import {
  deleteUser,
  getSettings,
  getUser,
  listRecords,
  putBanEvent,
  putPointLog,
  putUser
} from './kv'
import { adjustPoints } from './points'
import {
  requestDomainCoordinator,
  type DomainCoordinatorAction
} from './domain-coordinator-client'
import type { UserCoordinatorAction } from './user-coordinator-client'

interface UserCoordinatorRequest {
  action: UserCoordinatorAction
  uid: string
  payload: unknown
}

interface RecordPayload {
  root: string
  settings: Settings
  id?: string
  body?: Record<string, unknown>
  clientIp?: string
}

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'content-type': 'application/json; charset=utf-8' } })

export class UserCoordinator extends DurableObject<Env> {
  private tail: Promise<void> = Promise.resolve()

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS records (
          id TEXT PRIMARY KEY
        );
      `)
    })
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') return json({ success: false, message: '接口不存在', status: 404 }, 404)

    let input: UserCoordinatorRequest
    try {
      input = await request.json<UserCoordinatorRequest>()
    } catch {
      return json({ success: false, message: '请求体格式不正确', status: 400 }, 400)
    }

    return this.enqueue(async () => {
      try {
        await this.ensureInitialized(input.uid)
        const data = await this.dispatch(input)
        return json({ success: true, data })
      } catch (error) {
        const status = error instanceof ResponseError ? error.status : 500
        const message = error instanceof Error ? error.message : '用户操作失败'
        const data = error instanceof ResponseError ? error.data : undefined
        return json({ success: false, message, status, data }, status)
      }
    })
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation)
    this.tail = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  private async ensureInitialized(uid: string) {
    const initialized = this.ctx.storage.sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = 'uid'").toArray()[0]
    if (initialized) {
      if (initialized.value !== uid) throw new ResponseError('用户协调器标识不一致', 500)
      return
    }

    const records = (await listRecords(this.env)).filter(record => record.uid === uid)
    for (const record of records) {
      this.ctx.storage.sql.exec('INSERT OR IGNORE INTO records (id) VALUES (?)', record.id)
    }
    this.ctx.storage.sql.exec("INSERT INTO meta (key, value) VALUES ('uid', ?)", uid)
  }

  private recordCount() {
    return this.ctx.storage.sql.exec<{ count: number }>('SELECT COUNT(*) AS count FROM records').one().count
  }

  private async currentUser(uid: string) {
    const user = await getUser(this.env, uid)
    if (!user) throw new ResponseError('用户不存在', 404)
    const [balance, access] = await Promise.all([
      this.env.USER_POINTS.getByName(uid).getBalance(user.points),
      this.env.USER_ACCESS.getByName(uid).getState()
    ])
    return {
      ...user,
      points: balance ?? user.points,
      banned: access?.banned ?? user.banned,
      bannedReason: access ? access.reason : user.bannedReason,
      bannedAt: access ? access.bannedAt : user.bannedAt,
      bannedByUid: access ? access.bannedByUid : user.bannedByUid,
      bannedByEmail: access ? access.bannedByEmail : user.bannedByEmail
    }
  }

  private async dispatch(input: UserCoordinatorRequest) {
    if (input.action === 'ensure-user') {
      return this.ensureUser(input.uid, input.payload as { mailUser: MailUserInfo; enforceBan?: boolean })
    }
    if (input.action === 'create-user') return this.createUser(input.uid, input.payload as { user: DnsUser })
    if (input.action === 'adjust-points') {
      return this.adjustPoints(
        input.uid,
        input.payload as { delta: number; message?: string; operationId?: string }
      )
    }
    if (input.action === 'set-ban') {
      return this.setBan(
        input.uid,
        input.payload as {
          banned: boolean
          reason?: string
          presetId?: string
          actorUid: string
          actorEmail: string
          operationId?: string
        }
      )
    }
    if (input.action === 'delete-user') return this.deleteUser(input.uid)
    if (input.action === 'create-record') return this.mutateRecord(input.uid, 'create-record', input.payload as RecordPayload)
    if (input.action === 'update-record') return this.mutateRecord(input.uid, 'update-record', input.payload as RecordPayload)
    if (input.action === 'toggle-record') return this.mutateRecord(input.uid, 'toggle-record', input.payload as RecordPayload)
    if (input.action === 'delete-record') return this.mutateRecord(input.uid, 'delete-record', input.payload as RecordPayload)
    throw new ResponseError('接口不存在', 404)
  }

  private async ensureUser(uid: string, payload: { mailUser: MailUserInfo; enforceBan?: boolean }) {
    const existing = await getUser(this.env, uid)
    const access = await this.env.USER_ACCESS.getByName(uid).getState()
    const now = nowIso()
    if (existing) {
      const authoritativeBalance = await this.env.USER_POINTS.getByName(uid).getBalance(existing.points)
      const next: DnsUser = {
        ...existing,
        email: payload.mailUser.email,
        name: payload.mailUser.name || existing.name,
        points: authoritativeBalance ?? existing.points,
        banned: access?.banned ?? existing.banned,
        bannedReason: access ? access.reason : existing.bannedReason,
        bannedAt: access ? access.bannedAt : existing.bannedAt,
        bannedByUid: access ? access.bannedByUid : existing.bannedByUid,
        bannedByEmail: access ? access.bannedByEmail : existing.bannedByEmail,
        lastSeenAt: now
      }
      await putUser(this.env, next)
      if ((payload.enforceBan ?? true) && next.banned) {
        throw new ResponseError('该账号已被限制使用 DNS 服务', 403, {
          code: 'DNS_USER_BANNED',
          reason: next.bannedReason || '未提供封禁原因',
          bannedAt: next.bannedAt
        })
      }
      return next
    }

    const settings = await getSettings(this.env)
    if ((payload.enforceBan ?? true) && access?.banned) {
      throw new ResponseError('该账号已被限制使用 DNS 服务', 403, {
        code: 'DNS_USER_BANNED',
        reason: access.reason || '未提供封禁原因',
        bannedAt: access.bannedAt
      })
    }
    const initialPoints = Number.isSafeInteger(settings.initialPoints)
      ? settings.initialPoints
      : Number(this.env.DEFAULT_INITIAL_POINTS || 1)
    if (!Number.isSafeInteger(initialPoints) || initialPoints < 0) {
      throw new ResponseError('初始积分配置不正确', 500)
    }
    const user: DnsUser = {
      uid,
      email: payload.mailUser.email,
      name: payload.mailUser.name,
      points: initialPoints,
      initialGrantDone: true,
      banned: access?.banned,
      bannedReason: access?.reason,
      bannedAt: access?.bannedAt,
      bannedByUid: access?.bannedByUid,
      bannedByEmail: access?.bannedByEmail,
      createdAt: now,
      lastSeenAt: now
    }
    const initialization = await this.env.USER_POINTS.getByName(uid).initializeUser(uid, initialPoints)
    if (!initialization.ok) throw new ResponseError(initialization.message, 500)
    user.points = initialization.balance
    await putUser(this.env, user)
    if (initialPoints > 0 && initialization.created) {
      await putPointLog(this.env, {
        id: randomId(),
        uid,
        delta: initialPoints,
        balanceAfter: initialPoints,
        reason: 'initial_grant',
        message: '首次登录赠送积分',
        createdAt: now
      })
    }
    return user
  }

  private async createUser(uid: string, payload: { user: DnsUser }) {
    if (payload.user.uid !== uid) throw new ResponseError('用户标识不一致', 400)
    if (await getUser(this.env, uid)) throw new ResponseError('UID 已存在', 400)
    const initialization = await this.env.USER_POINTS.getByName(uid).initializeUser(uid, payload.user.points)
    if (!initialization.ok) throw new ResponseError(initialization.message, 500)
    if (!initialization.created) throw new ResponseError('该 UID 已存在积分账本，不能重复创建', 409)
    await putUser(this.env, payload.user)
    return payload.user
  }

  private async adjustPoints(
    uid: string,
    payload: { delta: number; message?: string; operationId?: string }
  ) {
    return adjustPoints(this.env, await this.currentUser(uid), payload.delta, payload.message, payload.operationId)
  }

  private async setBan(
    uid: string,
    payload: {
      banned: boolean
      reason?: string
      presetId?: string
      actorUid: string
      actorEmail: string
      operationId?: string
    }
  ) {
    const user = await this.currentUser(uid)
    const result = await this.env.USER_ACCESS.getByName(uid).mutate({
      uid,
      ...payload,
      operationId: payload.operationId || randomId()
    })
    const next: DnsUser = {
      ...user,
      banned: result.banned,
      bannedReason: result.reason,
      bannedAt: result.bannedAt,
      bannedByUid: result.bannedByUid,
      bannedByEmail: result.bannedByEmail,
      lastSeenAt: nowIso()
    }
    await putUser(this.env, next)
    await putBanEvent(this.env, result.event).catch(() => undefined)
    return { user: next, event: result.event as BanEvent }
  }

  private async deleteUser(uid: string) {
    const user = await this.currentUser(uid)
    if (this.recordCount() > 0) {
      throw new ResponseError('该用户仍有解析记录，请先删除解析或封禁用户', 400)
    }
    await deleteUser(this.env, user)
    return { uid }
  }

  private async mutateRecord(uid: string, action: DomainCoordinatorAction, payload: RecordPayload) {
    const user = await this.currentUser(uid)
    if (user.banned) throw new ResponseError(user.bannedReason || '用户已被封禁', 403)
    const result = await requestDomainCoordinator<DnsRecord | { record: DnsRecord; user: DnsUser }>(
      this.env,
      payload.root,
      action,
      {
        user,
        settings: payload.settings,
        id: payload.id,
        body: payload.body,
        clientIp: payload.clientIp
      }
    )
    const record = 'record' in result ? result.record : result
    if (action === 'create-record') {
      this.ctx.storage.sql.exec('INSERT OR IGNORE INTO records (id) VALUES (?)', record.id)
    } else if (action === 'delete-record') {
      this.ctx.storage.sql.exec('DELETE FROM records WHERE id = ?', record.id)
    }
    return result
  }
}
