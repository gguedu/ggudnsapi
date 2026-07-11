import { useState, useCallback, useEffect, useRef } from 'react'
import { motion } from 'motion/react'
import { getUsers, getAccounts, getDomains, getBlacklist, getSettings, getRecords, getMe } from '@/api/admin'
import { clearToken, ApiError } from '@/api/client'
import type { DnsUser, CfAccount, ManagedDomain, BlacklistRule, GlobalSettings, DnsRecord, AuthMe } from '@/types'
import Login from '@/components/Login'
import Layout from '@/components/Layout'
import UsersPage from '@/pages/Users'
import AccountsPage from '@/pages/Accounts'
import DomainsPage from '@/pages/Domains'
import BlacklistPage from '@/pages/Blacklist'
import SettingsPage from '@/pages/Settings'
import RecordsPage from '@/pages/Records'
import { toast } from 'sonner'

type Tab = 'users' | 'accounts' | 'domains' | 'blacklist' | 'settings' | 'records'

interface Cache {
  users: DnsUser[]
  accounts: CfAccount[]
  domains: ManagedDomain[]
  blacklist: BlacklistRule[]
  settings: GlobalSettings | null
  records: DnsRecord[]
}

export default function App() {
  // null = 正在恢复会话，AuthMe = 已登录，false = 未登录
  const [authed, setAuthed] = useState<AuthMe | false | null>(null)
  const [currentTab, setCurrentTab] = useState<Tab>('users')
  const [loading, setLoading] = useState(false)
  const restoredRef = useRef(false)

  const [cache, setCache] = useState<Cache>({
    users: [],
    accounts: [],
    domains: [],
    blacklist: [],
    settings: null,
    records: [],
  })

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [users, accounts, domains, blacklist, settings, records] = await Promise.all([
        getUsers(), getAccounts(), getDomains(), getBlacklist(), getSettings(), getRecords(),
      ])
      setCache({ users, accounts, domains, blacklist, settings, records })
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : '数据加载失败'
      toast.error(msg)
      if (e instanceof ApiError && e.status === 401) {
        clearToken()
        setAuthed(false)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  const handleLogin = useCallback((me: AuthMe) => { setAuthed(me) }, [])
  const handleLogout = useCallback(() => {
    clearToken()
    setAuthed(false)
    setCurrentTab('users')
    setCache({ users: [], accounts: [], domains: [], blacklist: [], settings: null, records: [] })
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
      case 'users': return <UsersPage users={cache.users} onRefresh={loadAll} />
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
