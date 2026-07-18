import { reset } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, it } from 'vitest'
import type { CfAccount, DnsUser, ManagedDomain, Settings } from '../src/types'
import { getUser, listUserPointLogs, putCfAccount, putDomain, putRedemptionCodeIndex, putSettings, putUser } from '../src/kv'
import { requestUserCoordinator } from '../src/user-coordinator-client'

const now = () => new Date().toISOString()
const uid = 'cross-root-user'
const roots = ['example.com', 'example.net']

const account: CfAccount = {
  id: 'account-1',
  name: 'test',
  authType: 'token',
  apiTokenEncrypted: 'token',
  createdAt: now(),
  updatedAt: now()
}

const settings: Settings = {
  protectionEnabled: true,
  initialPoints: 1,
  deleteRefundEnabled: true,
  allowedTypes: ['A'],
  defaultTtl: 600,
  updatedAt: now()
}

const user = (points = 1): DnsUser => ({
  uid,
  email: 'cross-root@example.net',
  points,
  initialGrantDone: true,
  createdAt: now(),
  lastSeenAt: now()
})

const domain = (root: string): ManagedDomain => ({
  root,
  zoneId: `zone-${root}`,
  cfAccountId: account.id,
  enabled: true,
  pointCost: 1,
  createdAt: now(),
  updatedAt: now()
})

beforeEach(async () => {
  await reset()
  await Promise.all([
    putSettings(env, settings),
    putCfAccount(env, account),
    putUser(env, user()),
    ...roots.map(root => putDomain(env, domain(root)))
  ])
})

describe('UserCoordinator', () => {
  it('serializes same-user creates across different domain coordinators', async () => {
    const stub = env.USER_COORDINATOR.getByName(uid)
    const results = await Promise.allSettled(
      roots.map((root, index) =>
        requestUserCoordinator(
          env,
          uid,
          'create-record',
          {
            root,
            settings,
            mailUser: { uid, email: 'cross-root@example.net' },
            body: { fullDomain: `host${index}.${root}`, type: 'A', content: `192.0.2.${index + 1}`, ttl: 600 },
            clientIp: ''
          },
          stub
        )
      )
    )

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    expect((await getUser(env, uid))?.points).toBe(0)
    const logs = await listUserPointLogs(env, uid)
    expect(logs.filter(log => log.reason === 'create_record')).toHaveLength(1)
  })

  it('keeps retryable record identity stable across the user and domain coordinators', async () => {
    const stub = env.USER_COORDINATOR.getByName(uid)
    const operationId = 'stable-create-operation'
    const payload = {
      root: roots[0],
      settings,
      mailUser: { uid, email: 'cross-root@example.net' },
      body: {
        operationId,
        fullDomain: `stable.${roots[0]}`,
        type: 'A',
        content: '192.0.2.20',
        ttl: 600
      },
      clientIp: ''
    }

    const first = await requestUserCoordinator<{ record: { id: string }; user: DnsUser }>(
      env,
      uid,
      'create-record',
      payload,
      stub
    )
    const replay = await requestUserCoordinator<{ record: { id: string }; user: DnsUser }>(
      env,
      uid,
      'create-record',
      payload,
      stub
    )

    expect(first.record.id).toBe(operationId)
    expect(replay.record.id).toBe(operationId)
    expect((await getUser(env, uid))?.points).toBe(0)
    const logs = await listUserPointLogs(env, uid)
    expect(logs.filter(log => log.reason === 'create_record')).toHaveLength(1)
  })

  it('blocks user deletion after a coordinated record create', async () => {
    const stub = env.USER_COORDINATOR.getByName(uid)
    await requestUserCoordinator(env, uid, 'create-record', {
      root: roots[0],
      settings,
      mailUser: { uid, email: 'cross-root@example.net' },
      body: { fullDomain: `kept.${roots[0]}`, type: 'A', content: '192.0.2.10', ttl: 600 },
      clientIp: ''
    }, stub)

    await expect(requestUserCoordinator(env, uid, 'delete-user', null, stub)).rejects.toMatchObject({ status: 400 })
    expect(await getUser(env, uid)).not.toBeNull()
  })

  it('serializes concurrent first-login grants', async () => {
    await reset()
    await putSettings(env, settings)
    const mailUser = { uid: 'new-user', email: 'new-user@example.net', name: 'New User' }
    const stub = env.USER_COORDINATOR.getByName(mailUser.uid)

    const [first, second] = await Promise.all([
      requestUserCoordinator<DnsUser>(env, mailUser.uid, 'ensure-user', { mailUser }, stub),
      requestUserCoordinator<DnsUser>(env, mailUser.uid, 'ensure-user', { mailUser }, stub)
    ])

    expect(first.points).toBe(1)
    expect(second.points).toBe(1)
    const logs = await listUserPointLogs(env, mailUser.uid)
    expect(logs.filter(log => log.reason === 'initial_grant')).toHaveLength(1)
  })

  it('serializes redemption with other writes and credits a code only once', async () => {
    const secretHash = 'redemption-hash'
    const codeId = 'redemption-code'
    const code = env.REDEMPTION_CODES.getByName(secretHash)
    const createdAt = now()
    await code.create({
      id: codeId,
      label: 'Test code',
      secretHash,
      maskedCode: 'TEST••••CODE',
      points: 2,
      maxUses: 1,
      createdAt,
      createdByUid: 'admin',
      createdByEmail: 'admin@example.net'
    })
    await putRedemptionCodeIndex(env, codeId, secretHash)

    const stub = env.USER_COORDINATOR.getByName(uid)
    const first = await requestUserCoordinator<{ user: DnsUser; log: { id: string }; use: { status: string } }>(
      env,
      uid,
      'redeem-code',
      { objectName: secretHash, secretHash, mailUser: { uid, email: 'cross-root@example.net' } },
      stub
    )
    await expect(
      requestUserCoordinator(
        env,
        uid,
        'redeem-code',
        { objectName: secretHash, secretHash, mailUser: { uid, email: 'cross-root@example.net' } },
        stub
      )
    ).rejects.toMatchObject({ status: 409 })

    expect(first.user.points).toBe(3)
    expect(first.use.status).toBe('completed')
    expect(await env.USER_POINTS.getByName(uid).getBalance()).toBe(3)
    const logs = await env.USER_POINTS.getByName(uid).listPointLogs()
    expect(logs.filter(log => log.reason === 'redeem_code')).toHaveLength(1)
  })

  it('provisions a first-time user inside the serialized redemption write', async () => {
    const newUid = 'first-redemption-user'
    const secretHash = 'first-redemption-hash'
    const code = env.REDEMPTION_CODES.getByName(secretHash)
    await code.create({
      id: 'first-redemption-code',
      label: 'First redemption',
      secretHash,
      maskedCode: 'FIRST••••CODE',
      points: 2,
      maxUses: 1,
      createdAt: now(),
      createdByUid: 'admin',
      createdByEmail: 'admin@example.net'
    })

    const result = await requestUserCoordinator<{ user: DnsUser }>(env, newUid, 'redeem-code', {
      objectName: secretHash,
      secretHash,
      mailUser: { uid: newUid, email: 'first@example.net', name: 'First' }
    })

    expect(result.user.points).toBe(3)
    expect(await getUser(env, newUid)).toMatchObject({ uid: newUid, points: 3 })
    const logs = await listUserPointLogs(env, newUid)
    expect(logs.filter(log => log.reason === 'initial_grant')).toHaveLength(1)
    expect(logs.filter(log => log.reason === 'redeem_code')).toHaveLength(1)
  })

  it('serializes point adjustment and ban without restoring stale fields', async () => {
    const stub = env.USER_COORDINATOR.getByName(uid)
    await Promise.all([
      requestUserCoordinator(env, uid, 'adjust-points', { delta: 2, message: 'test' }, stub),
      requestUserCoordinator(
        env,
        uid,
        'set-ban',
        { banned: true, reason: 'blocked', actorUid: 'admin', actorEmail: 'admin@example.net', operationId: 'ban-test' },
        stub
      )
    ])

    expect(await getUser(env, uid)).toMatchObject({ points: 3, banned: true, bannedReason: 'blocked' })
  })
})
