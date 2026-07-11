import { useState, useMemo } from 'react'
import { addBlacklist, deleteBlacklist } from '@/api/admin'
import { ApiError } from '@/api/client'
import type { BlacklistRule } from '@/types'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { PageHeader, StatCard, EmptyState, StaggerGroup } from '@/components/PageHeader'
import { toast } from 'sonner'
import { Loader2, Plus, ShieldBan, Trash2, Globe, User, Filter } from 'lucide-react'

interface Props {
  blacklist: BlacklistRule[]
  onRefresh: () => void
}

const MATCH_MODES = [
  { value: 'exact', label: '完全匹配', desc: '仅匹配完全一致的字符串' },
  { value: 'suffix', label: '后缀匹配', desc: '匹配自身及其所有子路径' },
  { value: 'contains', label: '包含匹配', desc: '包含该文本即命中' },
  { value: 'wildcard', label: '通配符', desc: '支持单个 * 通配符' },
] as const

const TARGET_INFO: Record<string, { label: string; icon: typeof Globe }> = {
  domain: { label: '域名', icon: Globe },
  user: { label: '用户', icon: User },
}

export default function BlacklistPage({ blacklist, onRefresh }: Props) {
  const [addOpen, setAddOpen] = useState(false)
  const [filterTarget, setFilterTarget] = useState<'all' | 'domain' | 'user'>('all')
  const [pattern, setPattern] = useState('')
  const [target, setTarget] = useState<'domain' | 'user'>('domain')
  const [modeType, setModeType] = useState<'exact' | 'suffix' | 'contains' | 'wildcard'>('exact')
  const [reason, setReason] = useState('')
  const [adding, setAdding] = useState(false)

  const filtered = useMemo(() => {
    if (filterTarget === 'all') return blacklist
    return blacklist.filter(r => r.target === filterTarget)
  }, [blacklist, filterTarget])

  const stats = {
    total: blacklist.length,
    domain: blacklist.filter(r => r.target === 'domain').length,
    user: blacklist.filter(r => r.target === 'user').length,
  }

  const handleAdd = async () => {
    if (!pattern.trim()) { toast.error('请输入规则内容'); return }
    setAdding(true)
    try {
      await addBlacklist({ pattern: pattern.trim(), target, type: modeType, reason: reason.trim() })
      toast.success('规则添加成功')
      setPattern(''); setReason('')
      setAddOpen(false)
      onRefresh()
    } catch (e) { toast.error(e instanceof ApiError ? e.message : '添加失败') }
    finally { setAdding(false) }
  }

  const handleDelete = async (id: string) => {
    try {
      await deleteBlacklist(id)
      toast.success('规则已删除')
      onRefresh()
    } catch (e) { toast.error(e instanceof ApiError ? e.message : '删除失败') }
  }

  const currentModeDesc = MATCH_MODES.find(m => m.value === modeType)?.desc

  return (
    <>
      <PageHeader title="黑名单规则" description="拦截特定域名或用户的解析请求">
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="size-3.5" />
          添加规则
        </Button>
      </PageHeader>

      <StaggerGroup className="grid grid-cols-3 gap-3">
        <StatCard label="规则总数" value={stats.total} icon={<ShieldBan className="size-4.5" />} tone={stats.total > 0 ? 'warning' : 'default'} />
        <StatCard label="域名规则" value={stats.domain} icon={<Globe className="size-4.5" />} />
        <StatCard label="用户规则" value={stats.user} icon={<User className="size-4.5" />} />
      </StaggerGroup>

      <Card>
        <CardContent className="border-b border-border p-3">
          <div className="flex items-center gap-2">
            <Filter className="size-3.5 text-muted-foreground" />
            <Select value={filterTarget} onValueChange={v => setFilterTarget(v as typeof filterTarget)}>
              <SelectTrigger className="h-7 w-32 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部目标</SelectItem>
                <SelectItem value="domain">仅域名</SelectItem>
                <SelectItem value="user">仅用户</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">{filtered.length} 条规则</span>
          </div>
        </CardContent>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-4">规则内容</TableHead>
                <TableHead>目标</TableHead>
                <TableHead>匹配模式</TableHead>
                <TableHead>原因</TableHead>
                <TableHead className="w-10 pr-4"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(r => {
                const TargetIcon = TARGET_INFO[r.target]?.icon || Globe
                return (
                  <TableRow key={r.id}>
                    <TableCell className="pl-4 font-mono text-sm text-foreground">{r.pattern}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="gap-1">
                        <TargetIcon className="size-3" />{TARGET_INFO[r.target]?.label}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-mono">{r.type}</Badge>
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-sm text-muted-foreground">{r.reason || '—'}</TableCell>
                    <TableCell className="pr-4">
                      <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-destructive" onClick={() => handleDelete(r.id)}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
              {filtered.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={5} className="p-0">
                    <EmptyState
                      icon={<ShieldBan className="size-5" />}
                      title="暂无黑名单规则"
                      description="添加规则以拦截特定域名或用户的解析请求"
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
            <DialogTitle>添加黑名单规则</DialogTitle>
            <DialogDescription>设置拦截规则，匹配的域名或用户将无法创建解析记录。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">规则内容 *</Label>
              <Input value={pattern} onChange={e => setPattern(e.target.value)} placeholder={target === 'domain' ? 'bad.example.com' : 'user@example.com'} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">目标类型</Label>
                <Select value={target} onValueChange={v => setTarget(v as 'domain' | 'user')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="domain">域名</SelectItem>
                    <SelectItem value="user">用户</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">匹配模式</Label>
                <Select value={modeType} onValueChange={v => setModeType(v as typeof modeType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MATCH_MODES.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {currentModeDesc && (
              <p className="rounded-md bg-muted/50 px-2.5 py-1.5 text-xs text-muted-foreground">{currentModeDesc}</p>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs">原因（可选）</Label>
              <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="记录封禁原因" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>取消</Button>
            <Button onClick={handleAdd} disabled={adding}>
              {adding && <Loader2 className="size-3.5 animate-spin" />}
              确认添加
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
