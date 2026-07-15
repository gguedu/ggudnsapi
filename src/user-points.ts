import { DurableObject } from 'cloudflare:workers'
import type { Env, PointLog } from './types'
import { nowIso, randomId } from './http'

export interface PointChangeInput {
  operationId: string
  uid: string
  currentBalance: number
  delta: number
  reason: PointLog['reason']
  recordId?: string
  redemptionCodeId?: string
  message?: string
}

export type PointOperationResult =
  | { ok: true; balance: number; log: PointLog; replayed: boolean }
  | { ok: false; code: 'INVALID_INPUT' | 'INSUFFICIENT_POINTS'; message: string }

export type PointInitializationResult =
  | { ok: true; balance: number; created: boolean }
  | { ok: false; code: 'INVALID_INPUT'; message: string }

interface StoredOperation extends Record<string, SqlStorageValue> {
  operation_id: string
  uid: string
  delta: number
  balance_after: number
  reason: PointLog['reason']
  record_id: string | null
  redemption_code_id: string | null
  message: string | null
  log_id: string
  created_at: string
}

interface BalanceRow extends Record<string, SqlStorageValue> {
  uid: string
  balance: number
}

const operationToLog = (operation: StoredOperation): PointLog => ({
  id: operation.log_id,
  uid: operation.uid,
  delta: operation.delta,
  balanceAfter: operation.balance_after,
  reason: operation.reason,
  recordId: operation.record_id || undefined,
  redemptionCodeId: operation.redemption_code_id || undefined,
  message: operation.message || undefined,
  createdAt: operation.created_at
})

export class UserPointsObject extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS balance (
        uid TEXT PRIMARY KEY,
        value INTEGER NOT NULL CHECK(value >= 0)
      );
      CREATE TABLE IF NOT EXISTS operations (
        operation_id TEXT PRIMARY KEY,
        uid TEXT NOT NULL,
        delta INTEGER NOT NULL,
        balance_after INTEGER NOT NULL,
        reason TEXT NOT NULL,
        record_id TEXT,
        redemption_code_id TEXT,
        message TEXT,
        log_id TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS operations_created_at ON operations(created_at DESC, operation_id DESC);
    `)
  }

  initializeUser(uid: string, balance: number): PointInitializationResult {
    if (!uid || !Number.isSafeInteger(balance) || balance < 0) {
      return { ok: false, code: 'INVALID_INPUT', message: '用户积分不正确' }
    }
    return this.ctx.storage.transactionSync(() => {
      const existing = this.ctx.storage.sql
        .exec<BalanceRow>('SELECT uid, value AS balance FROM balance WHERE uid = ?', uid)
        .toArray()[0]
      if (existing) return { ok: true, balance: Number(existing.balance), created: false }
      this.ctx.storage.sql.exec('INSERT INTO balance (uid, value) VALUES (?, ?)', uid, balance)
      return { ok: true, balance, created: true }
    })
  }

  applyPointChange(input: PointChangeInput): PointOperationResult {
    if (
      !input.operationId
      || !input.uid
      || !Number.isSafeInteger(input.delta)
      || input.delta === 0
      || !Number.isSafeInteger(input.currentBalance)
      || input.currentBalance < 0
    ) {
      return { ok: false, code: 'INVALID_INPUT', message: '积分操作参数不正确' }
    }

    return this.ctx.storage.transactionSync(() => {
      const existing = this.ctx.storage.sql
        .exec<StoredOperation>('SELECT * FROM operations WHERE operation_id = ?', input.operationId)
        .toArray()[0]
      if (existing) {
        const current = this.ctx.storage.sql
          .exec<BalanceRow>('SELECT uid, value AS balance FROM balance WHERE uid = ?', input.uid)
          .one()
        return { ok: true, balance: Number(current.balance), log: operationToLog(existing), replayed: true }
      }

      let balance = this.ctx.storage.sql
        .exec<BalanceRow>('SELECT uid, value AS balance FROM balance WHERE uid = ?', input.uid)
        .toArray()[0]
      if (!balance) {
        this.ctx.storage.sql.exec('INSERT INTO balance (uid, value) VALUES (?, ?)', input.uid, input.currentBalance)
        balance = { uid: input.uid, balance: input.currentBalance }
      }

      const nextBalance = Number(balance.balance) + input.delta
      if (nextBalance < 0) {
        return { ok: false, code: 'INSUFFICIENT_POINTS', message: '积分不足' }
      }

      const stored: StoredOperation = {
        operation_id: input.operationId,
        uid: input.uid,
        delta: input.delta,
        balance_after: nextBalance,
        reason: input.reason,
        record_id: input.recordId || null,
        redemption_code_id: input.redemptionCodeId || null,
        message: input.message || null,
        log_id: randomId(),
        created_at: nowIso()
      }

      this.ctx.storage.sql.exec('UPDATE balance SET value = ? WHERE uid = ?', nextBalance, input.uid)
      this.ctx.storage.sql.exec(
        `INSERT INTO operations (
          operation_id, uid, delta, balance_after, reason, record_id,
          redemption_code_id, message, log_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        stored.operation_id,
        stored.uid,
        stored.delta,
        stored.balance_after,
        stored.reason,
        stored.record_id,
        stored.redemption_code_id,
        stored.message,
        stored.log_id,
        stored.created_at
      )
      return { ok: true, balance: nextBalance, log: operationToLog(stored), replayed: false }
    })
  }

  getBalance(fallbackBalance?: number): number | null {
    const balance = this.ctx.storage.sql.exec<{ value: number }>('SELECT value FROM balance LIMIT 1').toArray()[0]
    if (balance) return Number(balance.value)
    if (fallbackBalance !== undefined && Number.isSafeInteger(fallbackBalance) && fallbackBalance >= 0) {
      return fallbackBalance
    }
    return null
  }

  getOperation(operationId: string): PointLog | null {
    const operation = this.ctx.storage.sql
      .exec<StoredOperation>('SELECT * FROM operations WHERE operation_id = ?', operationId)
      .toArray()[0]
    return operation ? operationToLog(operation) : null
  }

  listPointLogs(limit = 200): PointLog[] {
    const safeLimit = Math.min(500, Math.max(1, Math.trunc(limit)))
    return this.ctx.storage.sql
      .exec<StoredOperation>('SELECT * FROM operations ORDER BY created_at DESC, operation_id DESC LIMIT ?', safeLimit)
      .toArray()
      .map(operationToLog)
  }
}
