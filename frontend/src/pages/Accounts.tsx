import { useState } from 'react'
import { addAccount, deleteAccount } from '@/api/admin'
import { ApiError } from '@/api/client'
import type { CfAccount } from '@/types'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { PageHeader, StatCard, EmptyState, StaggerGroup, MotionItem } from '@/components/PageHeader'
import { toast } from 'sonner'
import {
  Loader2, Plus, Cloud, Trash2, KeyRound, Mail, ShieldCheck, AlertCircle,
} from 'lucide-react'

interface Props {
  accounts: CfAccount[]
  onRefresh: () => void
}

export default function AccountsPage({ accounts, onRefresh }: Props) {
  const [addOpen, setAddOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [actioning, setActioning] = useState(false)

  const [remark, setRemark] = useState('')
  const [authType, setAuthType] = useState<'token' | 'key_email'>('token')
  const [cfEmail, setCfEmail] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [apiToken, setApiToken] = useState('')

  const handleAdd = async () => {
    if (!remark.trim()) { toast.error('请填写备注名称'); return }
    setActioning(true)
    try {
      await addAccount({
        remark: remark.trim(),
        authType,
        email: authType === 'key_email' ? cfEmail.trim() : undefined,
        apiKey: authType === 'key_email' ? apiKey.trim() : undefined,
        apiToken: authType === 'token' ? apiToken.trim() : undefined,
      })
      toast.success('账户添加成功')
      setRemark(''); setCfEmail(''); setApiKey(''); setApiToken('')
      setAddOpen(false)
      onRefresh()
    } catch (e) { toast.error(e instanceof ApiError ? e.message : '添加失败') }
    finally { setActioning(false) }
  }

  const handleDelete = async () => {
    if (!deleteId) return
    setActioning(true)
    try {
      await deleteAccount(deleteId)
      toast.success('账户已删除')
      setDeleteId(null)
      onRefresh()
    } catch (e) { toast.error(e instanceof ApiError ? e.message : '删除失败') }
    finally { setActioning(false) }
  }

  const stats = {
    total: accounts.length,
    token: accounts.filter(a => a.authType === 'token').length,
    key: accounts.filter(a => a.authType === 'key_email').length,
  }

  return (
    <>
      <PageHeader title="Cloudflare 账户" description="管理用于解析的 Cloudflare API 凭证">
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="size-3.5" />
          添加账户
        </Button>
      </PageHeader>

      <StaggerGroup className="grid grid-cols-3 gap-3">
        <StatCard label="账户总数" value={stats.total} icon={<Cloud className="size-4.5" />} />
        <StatCard label="Token 认证" value={stats.token} icon={<KeyRound className="size-4.5" />} />
        <StatCard label="Key+Email 认证" value={stats.key} icon={<Mail className="size-4.5" />} />
      </StaggerGroup>

      {accounts.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={<Cloud className="size-5" />}
              title="暂无 Cloudflare 账户"
              description="添加账户后即可接入域名并开始管理解析"
            >
              <Button size="sm" onClick={() => setAddOpen(true)}>
                <Plus className="size-3.5" />
                添加第一个账户
              </Button>
            </EmptyState>
          </CardContent>
        </Card>
      ) : (
        <StaggerGroup className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {accounts.map(a => (
            <MotionItem key={a.id}>
            <Card className="group relative transition-shadow hover:shadow-md">
              <CardContent className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-orange-500/10 text-orange-600">
                      <Cloud className="size-4.5" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{a.remark || '未命名'}</p>
                      <p className="truncate text-xs text-muted-foreground">{a.name || '账户名未同步'}</p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="opacity-0 transition-opacity group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                    onClick={() => setDeleteId(a.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>

                <div className="space-y-1.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Account ID</span>
                    <span className="font-mono text-foreground">{a.accountId || '—'}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">认证方式</span>
                    {a.authType === 'token' ? (
                      <Badge variant="secondary" className="gap-1"><KeyRound className="size-3" />API Token</Badge>
                    ) : (
                      <Badge variant="secondary" className="gap-1"><Mail className="size-3" />Key + Email</Badge>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 border-t border-border pt-2.5">
                  {a.authType === 'token' ? (
                    a.hasApiToken ? (
                      <Badge variant="secondary" className="bg-success/10 text-success gap-1">
                        <ShieldCheck className="size-3" />Token 已配置
                      </Badge>
                    ) : (
                      <Badge variant="destructive" className="gap-1">
                        <AlertCircle className="size-3" />Token 缺失
                      </Badge>
                    )
                  ) : (
                    <>
                      <Badge variant={a.hasApiKey ? 'secondary' : 'destructive'} className={a.hasApiKey ? 'bg-success/10 text-success gap-1' : 'gap-1'}>
                        <KeyRound className="size-3" />{a.hasApiKey ? 'Key' : '无 Key'}
                      </Badge>
                      <Badge variant={a.hasApiKey ? 'secondary' : 'destructive'} className={a.hasApiKey ? 'bg-success/10 text-success gap-1' : 'gap-1'}>
                        <Mail className="size-3" />{a.hasApiKey ? 'Email' : '无 Email'}
                      </Badge>
                    </>
                  )}
                </div>

                <p className="font-mono text-[10px] text-muted-foreground/70">ID: {a.id}</p>
              </CardContent>
            </Card>
            </MotionItem>
          ))}
        </StaggerGroup>
      )}

      {/* 添加账户 Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>添加 Cloudflare 账户</DialogTitle>
            <DialogDescription>
              账户名会自动从 Cloudflare 读取，只需填写备注和凭证。Token 需要 Zone:Read 和 DNS:Edit 权限。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">备注名称 *</Label>
              <Input value={remark} onChange={e => setRemark(e.target.value)} placeholder="例如：主账号" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">认证方式</Label>
              <Select value={authType} onValueChange={v => setAuthType(v as 'token' | 'key_email')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="token">API Token（推荐）</SelectItem>
                  <SelectItem value="key_email">Global API Key + Email</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {authType === 'token' ? (
              <div className="space-y-1.5">
                <Label className="text-xs">API Token</Label>
                <Input type="password" value={apiToken} onChange={e => setApiToken(e.target.value)} placeholder="Cloudflare API Token" />
              </div>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs">Cloudflare 账户邮箱</Label>
                  <Input value={cfEmail} onChange={e => setCfEmail(e.target.value)} placeholder="cf@example.com" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Global API Key</Label>
                  <Input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="Global API Key" />
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>取消</Button>
            <Button onClick={handleAdd} disabled={actioning}>
              {actioning && <Loader2 className="size-3.5 animate-spin" />}
              确认添加
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      {deleteId && (
        <Dialog open onOpenChange={() => setDeleteId(null)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>删除账户</DialogTitle>
              <DialogDescription>确认删除该 Cloudflare 账户？关联的域名需要重新绑定。</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteId(null)}>取消</Button>
              <Button variant="destructive" onClick={handleDelete} disabled={actioning}>
                {actioning && <Loader2 className="size-3.5 animate-spin" />}
                确认删除
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
