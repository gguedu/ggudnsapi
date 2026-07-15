import type { DnsUser, Env, PointLog } from './types'
import { ResponseError, nowIso, randomId } from './http'
import { getUser, putPointLog, putUser } from './kv'

export const persistPointChange = async (
  env: Env,
  user: DnsUser,
  delta: number,
  reason: PointLog['reason'],
  options: {
    operationId?: string
    recordId?: string
    redemptionCodeId?: string
    message?: string
  } = {}
) => {
  if (!Number.isSafeInteger(delta) || delta === 0) throw new ResponseError('积分变更数量不正确', 400)
  const stub = env.USER_POINTS.getByName(user.uid)
  const result = await stub.applyPointChange({
    operationId: options.operationId || randomId(),
    uid: user.uid,
    currentBalance: user.points,
    delta,
    reason,
    recordId: options.recordId,
    redemptionCodeId: options.redemptionCodeId,
    message: options.message
  })
  if (!result.ok) {
    throw new ResponseError(result.message, result.code === 'INSUFFICIENT_POINTS' ? 400 : 500)
  }

  let latest = user
  try {
    latest = (await getUser(env, user.uid)) || user
  } catch {
    // The durable ledger already committed. A failed cache read must not report
    // the operation as failed or trigger compensation in the caller.
  }
  const next: DnsUser = { ...latest, points: result.balance, lastSeenAt: nowIso() }
  // The DO operation is authoritative. Mirror writes are retried here, but a
  // transient KV failure must not turn a committed debit/credit into a false rollback.
  await Promise.allSettled([putUser(env, next), putPointLog(env, result.log)])
  return { user: next, log: result.log }
}

export const spendPoints = (env: Env, user: DnsUser, amount: number, recordId: string) => {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new ResponseError('积分配置不正确', 500)
  return persistPointChange(env, user, -amount, 'create_record', {
    operationId: `record:create:${recordId}`,
    recordId,
    message: `创建解析扣减 ${amount} 积分`
  })
}

export const refundPoints = (env: Env, user: DnsUser, amount: number, recordId: string) => {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new ResponseError('积分配置不正确', 500)
  return persistPointChange(env, user, amount, 'delete_refund', {
    operationId: `record:refund:${recordId}`,
    recordId,
    message: `删除解析退还 ${amount} 积分`
  })
}

export const adjustPoints = (env: Env, user: DnsUser, delta: number, message?: string, operationId?: string) => {
  if (!Number.isSafeInteger(delta) || delta === 0) throw new ResponseError('积分变更数量不正确', 400)
  return persistPointChange(env, user, delta, 'admin_adjust', { operationId, message })
}

export const redeemPoints = (env: Env, user: DnsUser, points: number, codeId: string, useId: string) => {
  if (!Number.isSafeInteger(points) || points <= 0) throw new ResponseError('兑换码积分配置不正确', 500)
  return persistPointChange(env, user, points, 'redeem_code', {
    operationId: `redemption:${useId}`,
    redemptionCodeId: codeId,
    message: `兑换码入账 ${points} 积分`
  })
}
