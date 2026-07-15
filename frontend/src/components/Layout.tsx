import { useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  Loader2, RefreshCw, Users, Cloud, Globe, ShieldBan,
  Settings, ClipboardList, PanelLeftClose, PanelLeft, TicketCheck,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { sidebarVariants, sidebarTransition, pageVariants, pageTransition } from '@/lib/animations'
import UserMenu from '@/components/UserMenu'

interface NavItem {
  id: string
  label: string
  icon: ReactNode
  group: string
}

const navItems: NavItem[] = [
  { id: 'users', label: '用户管理', icon: <Users className="size-4" />, group: '运营' },
  { id: 'records', label: '解析总览', icon: <ClipboardList className="size-4" />, group: '运营' },
  { id: 'redemption', label: '兑换码', icon: <TicketCheck className="size-4" />, group: '运营' },
  { id: 'accounts', label: 'CF 账户', icon: <Cloud className="size-4" />, group: '基础设施' },
  { id: 'domains', label: '域名池', icon: <Globe className="size-4" />, group: '基础设施' },
  { id: 'blacklist', label: '黑名单', icon: <ShieldBan className="size-4" />, group: '安全' },
  { id: 'settings', label: '系统设置', icon: <Settings className="size-4" />, group: '安全' },
]

const tabInfo: Record<string, { title: string; description: string }> = {
  users: { title: '用户管理', description: '管理 DNS 平台用户、积分与访问权限' },
  accounts: { title: 'Cloudflare 账户', description: '管理用于解析的 Cloudflare API 凭证' },
  domains: { title: '域名池', description: '管理可用的根域名及其解析配置' },
  blacklist: { title: '黑名单规则', description: '拦截特定域名或用户的解析请求' },
  settings: { title: '系统设置', description: '配置全局解析策略与积分规则' },
  records: { title: '解析记录总览', description: '查看所有用户的 DNS 解析记录' },
  redemption: { title: '兑换码中心', description: '创建积分兑换码并追踪每一次使用' },
}

interface Props {
  email: string
  uid: string
  currentTab: string
  onTabChange: (tab: string) => void
  onRefresh: () => void
  onLogout: () => void
  loading: boolean
  tabKey: string
  children: ReactNode
}

export default function Layout({
  email, uid, currentTab, onTabChange, onRefresh, onLogout, loading, tabKey, children,
}: Props) {
  const [collapsed, setCollapsed] = useState(false)
  const info = tabInfo[currentTab] || { title: '', description: '' }

  const groups = navItems.reduce<Record<string, NavItem[]>>((acc, item) => {
    ;(acc[item.group] ??= []).push(item)
    return acc
  }, {})

  return (
    <div className="min-h-screen bg-background md:flex">
      <motion.aside
        variants={sidebarVariants}
        initial="initial"
        animate="animate"
        transition={sidebarTransition}
        className={cn(
          'fixed inset-y-0 left-0 z-20 hidden flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200 md:flex',
          collapsed ? 'w-16' : 'w-60',
        )}
      >
        <div className="flex h-14 items-center gap-2.5 border-b border-sidebar-border px-4">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Globe className="size-4.5" />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <p className="text-sm font-semibold tracking-tight text-sidebar-foreground">GGU DNS</p>
              <p className="text-[10px] text-muted-foreground">管理控制台</p>
            </div>
          )}
        </div>

        <nav className="flex-1 space-y-4 overflow-y-auto p-2.5">
          {Object.entries(groups).map(([groupName, items]) => (
            <div key={groupName} className="space-y-0.5">
              {!collapsed && (
                <p className="px-2.5 pb-1 pt-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  {groupName}
                </p>
              )}
              {items.map((item) => {
                const active = currentTab === item.id
                return (
                  <button
                    key={item.id}
                    onClick={() => onTabChange(item.id)}
                    title={collapsed ? item.label : undefined}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors',
                      active
                        ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                        : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                      collapsed && 'justify-center',
                    )}
                  >
                    <span className="shrink-0">{item.icon}</span>
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </button>
                )
              })}
            </div>
          ))}
        </nav>

        <Separator />

        <div className="p-2.5">
          <UserMenu email={email} uid={uid} collapsed={collapsed} onLogout={onLogout} />
        </div>
      </motion.aside>

      <div className={cn('flex min-h-screen min-w-0 flex-1 flex-col', collapsed ? 'md:ml-16' : 'md:ml-60')}>
        <header className="sticky top-0 z-10 flex h-14 items-center justify-between gap-4 border-b border-border bg-background/80 px-6 backdrop-blur-sm">
          <div className="min-w-0">
            <h1 className="text-base font-semibold tracking-tight text-foreground">{info.title}</h1>
            <p className="truncate text-xs text-muted-foreground">{info.description}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setCollapsed((c) => !c)}
              className="hidden text-muted-foreground md:inline-flex"
              title={collapsed ? '展开侧栏' : '折叠侧栏'}
            >
              {collapsed ? <PanelLeft className="size-4" /> : <PanelLeftClose className="size-4" />}
            </Button>
            <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
              {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              刷新
            </Button>
          </div>
        </header>

        <nav className="flex gap-1 overflow-x-auto border-b border-border bg-background px-3 py-2 md:hidden" aria-label="管理功能">
          {navItems.map(item => (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors',
                currentTab === item.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted',
              )}
            >
              {item.icon}{item.label}
            </button>
          ))}
        </nav>

        <main className="flex-1 overflow-auto p-3 sm:p-5 lg:p-8">
          <div className="mx-auto max-w-7xl">
            <AnimatePresence mode="wait">
              <motion.div
                key={tabKey}
                variants={pageVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={pageTransition}
                className="space-y-6"
              >
                {children}
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </div>
    </div>
  )
}
