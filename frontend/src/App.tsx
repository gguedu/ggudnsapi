import { useState, useCallback, useEffect, useRef } from 'react'
import { motion } from 'motion/react'
import {
  getUsers, getAccounts, getDomains, getBlacklist, getSettings, getRecords, getMe,
  getBanReasonPresets, getRedemptionCodes,
} from '@/api/admin'
import { clearToken, ApiError } from '@/api/client'
import type {
  DnsUser, CfAccount, ManagedDomain, BlacklistRule, GlobalSettings, DnsRecord, AuthMe,
  BanReasonPreset, RedemptionCode,
} from '@/types'
import Login from '@/components/Login'
import Layout from '@/components/Layout'
import UsersPage from '@/pages/Users'
import AccountsPage from '@/pages/Accounts'
import DomainsPage from '@/pages/Domains'
import BlacklistPage from '@/pages/Blacklist'
import SettingsPage from '@/pages/Settings'
import RecordsPage from '@/pages/Records'
import RedemptionCodesPage from '@/pages/RedemptionCodes'
import { toast } from 'sonner'

type Tab = 'users' | 'redemption' | 'accounts' | 'domains' | 'blacklist' | 'settings' | 'records'

interface Cache {
  users: DnsUser[]
  accounts: CfAccount[]
  domains: ManagedDomain[]
  blacklist: BlacklistRule[]
  settings: GlobalSettings | null
  records: DnsRecord[]
  banReasonPresets: BanReasonPreset[]
  redemptionCodes: RedemptionCode[]
}

export default function App() {
  // null = 正在恢复会话，AuthMe = 已登录，false = 未登录
  const [authed, setAuthed] = useState<AuthMe | false | null>(null)
  const [currentTab, setCurrentTab] = useState<Tab>('users')
  const [loading, setLoading] = useState(false)
  const restoredRef = useRef(false)
  const loadGenerationRef = useRef(0)

  const [cache, setCache] = useState<Cache>({
    users: [],
    accounts: [],
    domains: [],
    blacklist: [],
    settings: null,
    records: [],
    banReasonPresets: [],
    redemptionCodes: [],
  })

  const loadAll = useCallback(async () => {
    const generation = ++loadGenerationRef.current
    setLoading(true)
    const requests = [
      getUsers(), getAccounts(), getDomains(), getBlacklist(), getSettings(), getRecords(),
      getBanReasonPresets(), getRedemptionCodes(),
    ] as const
    try {
      const results = await Promise.allSettled(requests)
      if (generation !== loadGenerationRef.current) return
      const authError = results.find(
        result => result.status === 'rejected' && result.reason instanceof ApiError && result.reason.status === 401,
      )
      if (authError?.status === 'rejected') {
        clearToken()
        setAuthed(false)
        return
      }
      setCache(previous => ({
        users: results[0].status === 'fulfilled' ? results[0].value : previous.users,
        accounts: results[1].status === 'fulfilled' ? results[1].value : previous.accounts,
        domains: results[2].status === 'fulfilled' ? results[2].value : previous.domains,
        blacklist: results[3].status === 'fulfilled' ? results[3].value : previous.blacklist,
        settings: results[4].status === 'fulfilled' ? results[4].value : previous.settings,
        records: results[5].status === 'fulfilled' ? results[5].value : previous.records,
        banReasonPresets: results[6].status === 'fulfilled' ? results[6].value : previous.banReasonPresets,
        redemptionCodes: results[7].status === 'fulfilled' ? results[7].value : previous.redemptionCodes,
      }))
      const failed = results.filter(result => result.status === 'rejected')
      if (failed.length) toast.error(`${failed.length} 个数据集加载失败，已保留其他可用数据`)
    } finally {
      if (generation === loadGenerationRef.current) setLoading(false)
    }
  }, [])

  const handleLogin = useCallback((me: AuthMe) => { setAuthed(me) }, [])
  const handleLogout = useCallback(() => {
    clearToken()
    setAuthed(false)
    setCurrentTab('users')
    setCache({
      users: [], accounts: [], domains: [], blacklist: [], settings: null, records: [],
      banReasonPresets: [], redemptionCodes: [],
    })
  }, [])

  // 应用启动时恢复会话（仅一次）
  useEffect(() => {
    if (restoredRef.current) return
    restoredRef.current = true
    const token = localStorage.getItem('mail_token')
    if (!token) {
      setAuthed(false)
      return
    }
    getMe()
      .then((me) => {
        if (me.isAdmin) setAuthed(me)
        else {
          toast.error('当前账号无管理员权限')
          clearToken()
          setAuthed(false)
        }
      })
      .catch(() => {
        clearToken()
        setAuthed(false)
      })
  }, [])

  useEffect(() => {
    if (authed) loadAll()
  }, [authed, loadAll])

  // 正在恢复会话：显示加载状态
  if (authed === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <div className="size-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
          <p className="text-sm">正在加载...</p>
        </div>
      </div>
    )
  }

  // 未登录：渲染 Login（Login 不再自己恢复会话）
  if (authed === false) return <Login onLogin={handleLogin} />

  const renderPage = () => {
    switch (currentTab) {
      case 'users': return <UsersPage users={cache.users} presets={cache.banReasonPresets} onRefresh={loadAll} />
      case 'redemption': return <RedemptionCodesPage codes={cache.redemptionCodes} onRefresh={loadAll} />
      case 'accounts': return <AccountsPage accounts={cache.accounts} onRefresh={loadAll} />
      case 'domains': return <DomainsPage domains={cache.domains} accounts={cache.accounts} onRefresh={loadAll} />
      case 'blacklist': return <BlacklistPage blacklist={cache.blacklist} onRefresh={loadAll} />
      case 'settings': return cache.settings ? <SettingsPage settings={cache.settings} onRefresh={loadAll} /> : null
      case 'records': return <RecordsPage records={cache.records} />
    }
  }

  // 已登录：渲染 Dashboard
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
    >
      <Layout
        email={authed.user.email}
        uid={authed.user.uid}
        currentTab={currentTab}
        onTabChange={(tab) => setCurrentTab(tab as Tab)}
        onRefresh={loadAll}
        onLogout={handleLogout}
        loading={loading}
        tabKey={currentTab}
      >
        {renderPage()}
      </Layout>
    </motion.div>
  )
}
