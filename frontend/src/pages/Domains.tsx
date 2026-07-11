import { useState } from 'react'
import { addDomain, deleteDomain } from '@/api/admin'
import { ApiError } from '@/api/client'
import type { ManagedDomain, CfAccount } from '@/types'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { PageHeader, StatCard, EmptyState, StaggerGroup } from '@/components/PageHeader'
import { toast } from 'sonner'
import { Loader2, Plus, Globe, Trash2, CircleCheck, CircleX, Coins } from 'lucide-react'

interface Props {
  domains: ManagedDomain[]
  accounts: CfAccount[]
  onRefresh: () => void
}

function accountLabel(accounts: CfAccount[], id: string) {
  const a = accounts.find(x => x.id === id)
  return a ? (a.remark || a.name) : id.slice(0, 8)
}

export default function DomainsPage({ domains, accounts, onRefresh }: Props) {
  const [addOpen, setAddOpen] = useState(false)
  const [deleteRoot, setDeleteRoot] = useState<string | null>(null)
  const [actioning, setActioning] = useState(false)

  const [root, setRoot] = useState('')
  const [cfAccountId, setCfAccountId] = useState(accounts[0]?.id || '')
  const [pointCost, setPointCost] = useState('1')

  const handleAdd = async () => {
    if (!root.trim() || !cfAccountId) { toast.error('请填写域名并选择账户'); return }
    setActioning(true)
    try {
      await addDomain({ root: root.trim(), cfAccountId, pointCost: Number(pointCost) || 1 })
      toast.success('域名接入成功')
      setRoot(''); setPointCost('1')
      setAddOpen(false)
      onRefresh()
    } catch (e) { toast.error(e instanceof ApiError ? e.message : '接入失败') }
    finally { setActioning(false) }
  }

  const handleDelete = async () => {
    if (!deleteRoot) return
    setActioning(true)
    try {
      await deleteDomain(deleteRoot)
      toast.success('操作完成')
      setDeleteRoot(null)
      onRefresh()
    } catch (e) { toast.error(e instanceof ApiError ? e.message : '操作失败') }
    finally { setActioning(false) }
  }

  const stats = {
    total: domains.length,
    enabled: domains.filter(d => d.enabled).length,
    disabled: domains.filter(d => !d.enabled).length,
  }

  return (
    <>
      <PageHeader title="域名池" description="管理可用的根域名及其解析配置">
        <Button size="sm" onClick={() => setAddOpen(true)} disabled={accounts.length === 0}>
          <Plus className="size-3.5" />
          接入域名
        </Button>
      </PageHeader>

      <StaggerGroup className="grid grid-cols-3 gap-3">
        <StatCard label="域名总数" value={stats.total} icon={<Globe className="size-4.5" />} />
        <StatCard label="已开放" value={stats.enabled} icon={<CircleCheck className="size-4.5" />} tone="success" />
        <StatCard label="已关闭" value={stats.disabled} icon={<CircleX className="size-4.5" />} tone={stats.disabled > 0 ? 'destructive' : 'default'} />
      </StaggerGroup>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-4">域名</TableHead>
                <TableHead>所属账户</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="text-right">积分成本</TableHead>
                <TableHead>Zone ID</TableHead>
                <TableHead className="w-10 pr-4"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {domains.map(d => (
                <TableRow key={d.root}>
                  <TableCell className="pl-4">
                    <div className="flex items-center gap-2">
                      <Globe className="size-3.5 text-muted-foreground" />
                      <span className="font-medium text-foreground">{d.root}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{accountLabel(accounts, d.cfAccountId)}</TableCell>
                  <TableCell>
                    {d.enabled ? (
                      <Badge variant="secondary" className="bg-success/10 text-success gap-1">
                        <CircleCheck className="size-3" />开放
                      </Badge>
                    ) : (
                      <Badge variant="destructive" className="gap-1">
                        <CircleX className="size-3" />关闭
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="inline-flex items-center gap-1 tabular-nums text-muted-foreground">
                      <Coins className="size-3" />{d.pointCost}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{d.zoneId}</TableCell>
                  <TableCell className="pr-4">
                    <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-destructive" onClick={() => setDeleteRoot(d.root)}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {domains.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={6} className="p-0">
                    <EmptyState
                      icon={<Globe className="size-5" />}
                      title="暂无域名"
                      description={accounts.length === 0 ? '请先添加 Cloudflare 账户' : '接入域名后用户即可创建解析记录'}
                    />
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>接入域名</DialogTitle>
            <DialogDescription>填写域名并选择 Cloudflare 账户。系统会自动校验该账户下是否存在此域名。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">根域名 *</Label>
              <Input value={root} onChange={e => setRoot(e.target.value)} placeholder="example.com" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Cloudflare 账户</Label>
              <Select value={cfAccountId} onValueChange={v => setCfAccountId(v ?? '')}>
                <SelectTrigger><SelectValue placeholder="选择账户" /></SelectTrigger>
                <SelectContent>
                  {accounts.map(a => (
                    <SelectItem key={a.id} value={a.id}>{a.remark || a.name} · {a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">每条解析消耗积分</Label>
              <Input type="number" min={0} value={pointCost} onChange={e => setPointCost(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>取消</Button>
            <Button onClick={handleAdd} disabled={actioning}>
              {actioning && <Loader2 className="size-3.5 animate-spin" />}
              确认接入
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {deleteRoot && (
        <Dialog open onOpenChange={() => setDeleteRoot(null)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>删除 / 禁用域名</DialogTitle>
              <DialogDescription>若该域名下仍有解析记录，将自动禁用而非删除。</DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-2.5 rounded-lg border border-border bg-muted/40 px-3 py-2">
              <Globe className="size-4 text-muted-foreground" />
              <span className="text-sm font-medium">{deleteRoot}</span>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteRoot(null)}>取消</Button>
              <Button variant="destructive" onClick={handleDelete} disabled={actioning}>
                {actioning && <Loader2 className="size-3.5 animate-spin" />}
                确认操作
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
