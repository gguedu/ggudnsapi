import { reset } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, it } from 'vitest'
import type { CfAccount, DnsRecord, DnsUser, ManagedDomain, Settings } from '../src/types'
import { keys, getOwner, getRecord, getUser, putCfAccount, putDomain, putOwner, putRecord, putUser } from '../src/kv'
import { getCoordinatedDomain, requestDomainCoordinator } from '../src/domain-coordinator-client'

const root = 'example.com'
const zoneId = 'zone-1'
const accountId = 'account-1'
const coordinator = () => env.DOMAIN_COORDINATOR.getByName(root)

const now = () => new Date().toISOString()

const domain = (overrides: Partial<ManagedDomain> = {}): ManagedDomain => ({
  root,
  zoneId,
  cfAccountId: accountId,
  enabled: true,
  pointCost: 1,
  createdAt: now(),
  updatedAt: now(),
  ...overrides
})

const user = (uid: string, points = 2): DnsUser => ({
  uid,
  email: `${uid}@example.net`,
  points,
  initialGrantDone: true,
  createdAt: now(),
  lastSeenAt: now()
})

const settings = (overrides: Partial<Settings> = {}): Settings => ({
  protectionEnabled: true,
  initialPoints: 1,
  deleteRefundEnabled: true,
  allowedTypes: ['A'],
  defaultTtl: 600,
  updatedAt: now(),
  ...overrides
})

const account: CfAccount = {
  id: accountId,
  name: 'test',
  authType: 'token',
  apiTokenEncrypted: 'token',
  createdAt: now(),
  updatedAt: now()
}

const record = (uid: string): DnsRecord => ({
  id: `record-${uid}`,
  uid,
  root,
  zoneId,
  cfAccountId: accountId,
  cfRecordId: `cf-${uid}`,
  secondLevel: `owned.${root}`,
  fullDomain: `www.owned.${root}`,
  type: 'A',
  content: '192.0.2.1',
  ttl: 600,
  proxied: false,
  pointCost: 1,
  enabled: true,
  status: 'active',
  createdAt: now(),
  updatedAt: now()
})

beforeEach(async () => {
  await reset()
  await Promise.all([putDomain(env, domain()), putCfAccount(env, account)])
})

describe('DomainCoordinator lifecycle', () => {
  it('serializes a create that starts before domain deletion', async () => {
    const owner = user('owner')
    await putUser(env, owner)
    const stub = coordinator()

    const creating = requestDomainCoordinator<{ record: DnsRecord; user: DnsUser }>(
      env,
      root,
      'create-record',
      {
        user: owner,
        settings: settings(),
        body: { fullDomain: `www.owned.${root}`, type: 'A', content: '192.0.2.1', ttl: 600 },
        clientIp: '192.0.2.10'
      },
      stub
    )
    const deleting = requestDomainCoordinator<ManagedDomain>(env, root, 'delete-domain', null, stub)

    const created = await creating
    const deleted = await deleting
    expect(created.record.fullDomain).toBe(`www.owned.${root}`)
    expect(deleted.enabled).toBe(false)
    expect((await getCoordinatedDomain(env, root, stub))?.enabled).toBe(false)
  })

  it('rejects a queued create after an empty domain is deleted without a Cloudflare POST', async () => {
    const owner = user('owner')
    await putUser(env, owner)
    const stub = env.DOMAIN_COORDINATOR.getByName('deleted.example.com')
    const deletedRoot = 'deleted.example.com'
    await putDomain(env, domain({ root: deletedRoot }))
    const deleted = await requestDomainCoordinator<{ root: string }>(env, deletedRoot, 'delete-domain', null, stub)
    expect(deleted).toEqual({ root: deletedRoot })
    await expect(
      requestDomainCoordinator(env, deletedRoot, 'create-record', {
        user: owner,
        settings: settings(),
        body: { fullDomain: `www.owned.${deletedRoot}`, type: 'A', content: '192.0.2.1', ttl: 600 },
        clientIp: ''
      }, stub)
    ).rejects.toMatchObject({ status: 400 })
    expect(await env.DNS_KV.get(keys.domain(deletedRoot))).toBeNull()
  })

  it('uses primary records when bootstrapping domain deletion', async () => {
    const existing = record('owner')
    await putRecord(env, existing)
    await env.DNS_KV.delete(keys.domainRecord(root, existing.id))

    const deleted = await requestDomainCoordinator<ManagedDomain>(env, root, 'delete-domain', null, coordinator())
    expect(deleted.enabled).toBe(false)
    expect(await getRecord(env, existing.id)).toEqual(existing)
  })
})

describe('owner state', () => {
  it('allows only one user to claim a protected second-level namespace', async () => {
    const first = user('first')
    const second = user('second')
    await Promise.all([putUser(env, first), putUser(env, second)])

    const results = await Promise.allSettled([
      requestDomainCoordinator<{ record: DnsRecord; user: DnsUser }>(env, root, 'create-record', {
        user: first,
        settings: settings(),
        body: { fullDomain: `one.owned.${root}`, type: 'A', content: '192.0.2.1', ttl: 600 },
        clientIp: ''
      }, coordinator()),
      requestDomainCoordinator<{ record: DnsRecord; user: DnsUser }>(env, root, 'create-record', {
        user: second,
        settings: settings(),
        body: { fullDomain: `two.owned.${root}`, type: 'A', content: '192.0.2.2', ttl: 600 },
        clientIp: ''
      }, coordinator())
    ])

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    const winner = results.find(result => result.status === 'fulfilled') as PromiseFulfilledResult<{
      record: DnsRecord
      user: DnsUser
    }>
    expect((await getOwner(env, root, `owned.${root}`))?.uid).toBe(winner.value.record.uid)
  })

  it('cleans a failed first claim without blocking the next claimant', async () => {
    const first = user('first')
    const second = user('second')
    await Promise.all([putUser(env, first), putUser(env, second)])

    await expect(
      requestDomainCoordinator(env, root, 'create-record', {
        user: first,
        settings: settings(),
        body: { fullDomain: `one.owned.${root}`, type: 'A', content: 'fail-create', ttl: 600 },
        clientIp: ''
      }, coordinator())
    ).rejects.toMatchObject({ status: 500 })
    expect(await getOwner(env, root, `owned.${root}`)).toBeNull()

    const created = await requestDomainCoordinator<{ record: DnsRecord; user: DnsUser }>(env, root, 'create-record', {
      user: second,
      settings: settings(),
      body: { fullDomain: `two.owned.${root}`, type: 'A', content: '192.0.2.2', ttl: 600 },
      clientIp: ''
    }, coordinator())
    expect(created.record.uid).toBe(second.uid)
    expect((await getOwner(env, root, `owned.${root}`))?.uid).toBe(second.uid)
  })

  it('does not delete a mismatched owner during failed create compensation', async () => {
    const claimant = user('claimant')
    const winner = user('winner')
    await Promise.all([putUser(env, claimant), putUser(env, winner)])
    const marker = {
      root,
      secondLevel: `owned.${root}`,
      uid: winner.uid,
      firstRecordId: 'winner-record',
      createdAt: now(),
      updatedAt: now()
    }
    await putOwner(env, marker)
    await putRecord(env, {
      ...record(winner.uid),
      id: marker.firstRecordId,
      secondLevel: marker.secondLevel,
      fullDomain: `existing.${marker.secondLevel}`
    })

    await expect(
      requestDomainCoordinator(env, root, 'create-record', {
        user: claimant,
        settings: settings(),
        body: { fullDomain: `www.owned.${root}`, type: 'A', content: '192.0.2.1', ttl: 600 },
        clientIp: ''
      }, coordinator())
    ).rejects.toMatchObject({ status: 403 })
    expect(await getOwner(env, root, marker.secondLevel)).toEqual(marker)
  })

  it('deletes Cloudflare records from stored account and zone metadata after domain config loss', async () => {
    const owner = user('cleanup')
    const existing = record(owner.uid)
    await Promise.all([putUser(env, owner), putRecord(env, existing)])
    await env.DNS_KV.delete(keys.domain(root))
    await env.DNS_KV.delete(keys.domainIndex(root))

    const deleted = await requestDomainCoordinator<{ record: DnsRecord; user: DnsUser }>(env, root, 'delete-record', {
      user: owner,
      settings: settings(),
      id: existing.id
    }, coordinator())
    expect(deleted.record.id).toBe(existing.id)
    expect(deleted.user.points).toBe(3)
    expect(await getRecord(env, existing.id)).toBeNull()
  })

  it('does not create owner markers when protection is disabled', async () => {
    const owner = user('unprotected')
    await putUser(env, owner)
    const unprotectedRoot = 'unprotected.example.com'
    await putDomain(env, domain({ root: unprotectedRoot }))
    const result = await requestDomainCoordinator<{ record: DnsRecord; user: DnsUser }>(
      env,
      unprotectedRoot,
      'create-record',
      {
        user: owner,
        settings: settings({ protectionEnabled: false }),
        body: { fullDomain: `www.owned.${unprotectedRoot}`, type: 'A', content: '192.0.2.1', ttl: 600 },
        clientIp: ''
      },
      env.DOMAIN_COORDINATOR.getByName(unprotectedRoot)
    )
    expect(result.user.points).toBe(1)
    expect(await getOwner(env, unprotectedRoot, result.record.secondLevel)).toBeNull()
    expect((await getUser(env, owner.uid))?.points).toBe(1)
  })
})
