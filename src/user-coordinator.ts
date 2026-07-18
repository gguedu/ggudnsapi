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
import { adjustPoints, redeemPoints } from './points'
import { assertDnsServiceAllowed, readDnsUserSnapshot } from './user-state'
import {
  hasCoordinatedRecord,
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
  mailUser?: Pick<MailUserInfo, 'uid' | 'email' | 'name'>
  id?: string
  body?: Record<string, unknown>
  clientIp?: string
}

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'content-type': 'application/json; charset=utf-8' } })

export class UserCoordinator extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS records (
          id TEXT PRIMARY KEY,
          root TEXT NOT NULL,
          state TEXT NOT NULL CHECK(state IN ('pending-create', 'active', 'pending-delete'))
        );
      `)
      const columns = this.ctx.storage.sql.exec<{ name: string }>('PRAGMA table_info(records)').toArray()
      if (!columns.some(column => column.name === 'root')) {
        this.ctx.storage.sql.exec(`
          ALTER TABLE records RENAME TO records_legacy;
          CREATE TABLE records (
            id TEXT PRIMARY KEY,
            root TEXT NOT NULL,
            state TEXT NOT NULL CHECK(state IN ('pending-create', 'active', 'pending-delete'))
          );
          DROP TABLE records_legacy;
        `)
      }
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

    return this.ctx.blockConcurrencyWhile(async () => {
      try {
        this.ensureIdentity(input.uid)
        if (input.action === 'delete-user') await this.ensureRecordRegistry(input.uid)
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

  private ensureIdentity(uid: string) {
    const initialized = this.ctx.storage.sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = 'uid'").toArray()[0]
    if (initialized) {
      if (initialized.value !== uid) throw new ResponseError('用户协调器标识不一致', 500)
      return
    }
    this.ctx.storage.sql.exec("INSERT INTO meta (key, value) VALUES ('uid', ?)", uid)
  }

  private async ensureRecordRegistry(uid: string) {
    const initialized = this.ctx.storage.sql
      .exec<{ value: string }>("SELECT value FROM meta WHERE key = 'records-initialized'")
      .toArray()[0]
    if (initialized) return

    const records = (await listRecords(this.env)).filter(record => record.uid === uid)
    for (const record of records) {
      this.ctx.storage.sql.exec(
        "INSERT OR IGNORE INTO records (id, root, state) VALUES (?, ?, 'active')",
        record.id,
        record.root
      )
    }
    this.ctx.storage.sql.exec("INSERT INTO meta (key, value) VALUES ('records-initialized', 'true')")
  }

  private async reconcileRecords(uid: string) {
    const rows = this.ctx.storage.sql
      .exec<{ id: string; root: string; state: string }>('SELECT id, root, state FROM records')
      .toArray()
    for (const row of rows) {
      const exists = await hasCoordinatedRecord(this.env, row.root, row.id, uid)
      if (exists) {
        this.ctx.storage.sql.exec("UPDATE records SET state = 'active' WHERE id = ?", row.id)
      } else if (row.state !== 'pending-create') {
        this.ctx.storage.sql.exec('DELETE FROM records WHERE id = ?', row.id)
      }
    }
  }

  private recordCount() {
    return this.ctx.storage.sql.exec<{ count: number }>('SELECT COUNT(*) AS count FROM records').one().count
  }

  private async currentUser(uid: string) {
    const snapshot = await readDnsUserSnapshot(this.env, uid)
    if (!snapshot.user) throw new ResponseError('用户不存在', 404)
    return snapshot.user
  }

  private async dispatch(input: UserCoordinatorRequest) {
    if (input.action === 'ensure-user') {
      return this.ensureUser(
        input.uid,
        input.payload as { mailUser: Pick<MailUserInfo, 'uid' | 'email' | 'name'>; enforceBan?: boolean }
      )
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
    if (input.action === 'redeem-code') {
      return this.redeemCode(
        input.uid,
        input.payload as {
          objectName: string
          secretHash: string
          mailUser: Pick<MailUserInfo, 'uid' | 'email' | 'name'>
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

  private async ensureUser(uid: string, payload: { mailUser: Pick<MailUserInfo, 'uid' | 'email' | 'name'>; enforceBan?: boolean }) {
    if (payload.mailUser.uid !== uid) throw new ResponseError('用户标识不一致', 400)
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

  private async redeemCode(
    uid: string,
    payload: {
      objectName: string
      secretHash: string
      mailUser: Pick<MailUserInfo, 'uid' | 'email' | 'name'>
    }
  ) {
    const user = await this.ensureUser(uid, { mailUser: payload.mailUser })
    assertDnsServiceAllowed({ user, access: null })

    if (!payload.objectName) throw new ResponseError('兑换码无效', 404)
    const stub = this.env.REDEMPTION_CODES.getByName(payload.objectName)
    const code = await stub.getCode()
    if (!code || code.secretHash !== payload.secretHash) throw new ResponseError('兑换码无效', 404)

    const prior = await stub.getUse(uid)
    if (prior?.status === 'pending') {
      const priorLog = await this.env.USER_POINTS.getByName(uid).getOperation(`redemption:${prior.id}`)
      if (priorLog) {
        const use = await stub.complete(prior.id, priorLog.id)
        throw new ResponseError('你已经使用过这个兑换码', 409, {
          code: 'REDEMPTION_ALREADY_COMPLETED',
          use
        })
      }
    }

    const reservation = await stub.reserve(uid, user.email)
    if (!reservation.ok || !reservation.use) {
      const message = reservation.reason === 'already_redeemed'
        ? '你已经使用过这个兑换码'
        : reservation.reason === 'inactive'
          ? '该兑换码已停用'
          : reservation.reason === 'expired'
            ? '该兑换码已过期'
            : reservation.reason === 'exhausted'
              ? '该兑换码已达到使用次数上限'
              : '兑换码无效'
      throw new ResponseError(message, 409)
    }

    try {
      const result = await redeemPoints(this.env, user, reservation.use.points, code.id, reservation.use.id)
      const use = await stub.complete(reservation.use.id, result.log.id)
      if (!use) throw new ResponseError('兑换记录完成失败', 500)
      return { user: result.user, log: result.log, use }
    } catch (error) {
      const committed = await this.env.USER_POINTS.getByName(uid).getOperation(`redemption:${reservation.use.id}`)
      if (!committed) await stub.cancel(reservation.use.id)
      throw error
    }
  }

  private async deleteUser(uid: string) {
    const user = await this.currentUser(uid)
    await this.reconcileRecords(uid)
    if (this.recordCount() > 0) {
      throw new ResponseError('该用户仍有解析记录，请先删除解析或封禁用户', 400)
    }
    await deleteUser(this.env, user)
    return { uid }
  }

  private async mutateRecord(uid: string, action: DomainCoordinatorAction, payload: RecordPayload) {
    let user: DnsUser
    if (action === 'create-record') {
      if (!payload.mailUser) throw new ResponseError('缺少用户身份信息', 400)
      user = await this.ensureUser(uid, { mailUser: payload.mailUser })
    } else {
      user = await this.currentUser(uid)
    }
    assertDnsServiceAllowed({ user, access: null })

    const operationId = action === 'create-record'
      ? typeof payload.body?.operationId === 'string' && payload.body.operationId.trim()
        ? payload.body.operationId.trim()
        : randomId()
      : payload.id
    if (!operationId) throw new ResponseError('记录操作标识不能为空', 400)
    if (action === 'create-record') {
      payload.body = { ...payload.body, operationId }
      this.ctx.storage.sql.exec(
        "INSERT INTO records (id, root, state) VALUES (?, ?, 'pending-create') ON CONFLICT(id) DO UPDATE SET root = excluded.root",
        operationId,
        payload.root
      )
    } else if (action === 'delete-record') {
      this.ctx.storage.sql.exec(
        "INSERT INTO records (id, root, state) VALUES (?, ?, 'pending-delete') ON CONFLICT(id) DO UPDATE SET root = excluded.root, state = 'pending-delete'",
        operationId,
        payload.root
      )
    }

    try {
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
        this.ctx.storage.sql.exec("UPDATE records SET state = 'active' WHERE id = ?", record.id)
      } else if (action === 'delete-record') {
        this.ctx.storage.sql.exec('DELETE FROM records WHERE id = ?', record.id)
      }
      return result
    } catch (error) {
      if (action === 'create-record') {
        const exists = await hasCoordinatedRecord(this.env, payload.root, operationId, uid).catch(() => null)
        if (exists === true) {
          this.ctx.storage.sql.exec("UPDATE records SET state = 'active' WHERE id = ?", operationId)
        } else if (exists === false) {
          this.ctx.storage.sql.exec('DELETE FROM records WHERE id = ?', operationId)
        }
      } else if (action === 'delete-record') {
        const exists = await hasCoordinatedRecord(this.env, payload.root, operationId, uid).catch(() => null)
        if (exists === false) {
          this.ctx.storage.sql.exec('DELETE FROM records WHERE id = ?', operationId)
        } else if (exists === true) {
          this.ctx.storage.sql.exec("UPDATE records SET state = 'active' WHERE id = ?", operationId)
        }
      }
      throw error
    }
  }
}
