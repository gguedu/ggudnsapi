import { useMemo, useRef, useState } from 'react'
import {
  Copy, Gift, History, KeyRound, Loader2, PauseCircle, PlayCircle,
  Search, ShieldCheck, Sparkles, TicketCheck, Users,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  createRedemptionCode, getRedemptionCodeUses, setRedemptionCodeActive,
} from '@/api/admin'
import { ApiError } from '@/api/client'
import type { RedemptionCode, RedemptionUse } from '@/types'
import { PageHeader, StatCard, StaggerGroup, EmptyState } from '@/components/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

interface Props {
  codes: RedemptionCode[]
  onRefresh: () => void
}

const formatTime = (value?: string) => value
  ? new Date(value).toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' })
  : '永久有效'

export default function RedemptionCodesPage({ codes, onRefresh }: Props) {
  const [custom, setCustom] = useState(false)
  const [label, setLabel] = useState('')
  const [code, setCode] = useState('')
  const [points, setPoints] = useState('10')
  const [maxUses, setMaxUses] = useState('1')
  const [expiresAt, setExpiresAt] = useState('')
  const [creating, setCreating] = useState(false)
  const [revealedCode, setRevealedCode] = useState('')
  const [query, setQuery] = useState('')
  const [usesOpen, setUsesOpen] = useState(false)
  const [usesLoading, setUsesLoading] = useState(false)
  const [selected, setSelected] = useState<RedemptionCode | null>(null)
  const [uses, setUses] = useState<RedemptionUse[]>([])
  const usesRequestRef = useRef(0)

  const stats = useMemo(() => ({
    total: codes.length,
    active: codes.filter(item => item.active).length,
    redeemed: codes.reduce((sum, item) => sum + item.useCount, 0),
    capacity: codes.reduce((sum, item) => sum + item.maxUses, 0),
  }), [codes])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return codes
    return codes.filter(item => `${item.label} ${item.maskedCode}`.toLowerCase().includes(needle))
  }, [codes, query])

  const create = async () => {
    const pointValue = Number(points)
    const maxUseValue = Number(maxUses)
    if (!Number.isInteger(pointValue) || pointValue <= 0) { toast.error('请输入有效的积分数量'); return }
    if (!Number.isInteger(maxUseValue) || maxUseValue <= 0) { toast.error('请输入有效的兑换次数'); return }
    if (custom && !code.trim()) { toast.error('请输入自定义兑换码'); return }
    setCreating(true)
    try {
      const result = await createRedemptionCode({
        label: label.trim() || undefined,
        mode: custom ? 'custom' : 'generated',
        code: custom ? code.trim() : undefined,
        points: pointValue,
        maxUses: maxUseValue,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
      })
      setRevealedCode(result.plainCode)
      setLabel(''); setCode(''); setPoints('10'); setMaxUses('1'); setExpiresAt('')
      toast.success('兑换码已创建，请立即保存明文')
      onRefresh()
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : '兑换码创建失败')
    } finally { setCreating(false) }
  }

  const copyCode = async () => {
    await navigator.clipboard.writeText(revealedCode)
    toast.success('兑换码已复制')
  }

  const toggleActive = async (item: RedemptionCode) => {
    try {
      await setRedemptionCodeActive(item.id, !item.active)
      toast.success(item.active ? '兑换码已停用' : '兑换码已启用')
      onRefresh()
    } catch (error) { toast.error(error instanceof ApiError ? error.message : '状态更新失败') }
  }

  const openUses = async (item: RedemptionCode) => {
    const requestId = ++usesRequestRef.current
    setSelected(item); setUsesOpen(true); setUsesLoading(true); setUses([])
    try {
      const result = await getRedemptionCodeUses(item.id)
      if (requestId === usesRequestRef.current) setUses(result.items)
    } catch (error) {
      if (requestId === usesRequestRef.current) toast.error(error instanceof ApiError ? error.message : '使用记录加载失败')
    } finally {
      if (requestId === usesRequestRef.current) setUsesLoading(false)
    }
  }

  return (
    <>
      <PageHeader title="兑换码中心" description="创建积分凭证，并保留 UID、邮箱与入账状态的完整审计。" />

      <StaggerGroup className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="兑换码总数" value={stats.total} icon={<TicketCheck className="size-4.5" />} />
        <StatCard label="启用中" value={stats.active} icon={<ShieldCheck className="size-4.5" />} tone="success" />
        <StatCard label="已兑换" value={stats.redeemed} icon={<Users className="size-4.5" />} />
        <StatCard label="总容量" value={stats.capacity} icon={<Gift className="size-4.5" />} />
      </StaggerGroup>

      <Card className="overflow-hidden border-primary/15">
        <div className="grid lg:grid-cols-[0.72fr_1.28fr]">
          <div className="relative overflow-hidden border-b border-border bg-primary p-6 text-primary-foreground lg:border-b-0 lg:border-r lg:p-8">
            <div className="absolute -right-16 -top-20 size-56 rounded-full border-[34px] border-white/8" />
            <div className="relative">
              <span className="grid size-11 place-items-center rounded-xl bg-white/12"><Sparkles className="size-5" /></span>
              <p className="mt-10 text-xs font-medium uppercase tracking-[0.24em] text-primary-foreground/65">Issue credit</p>
              <h2 className="mt-3 max-w-sm text-3xl font-semibold tracking-tight">创建一份可追溯的积分凭证</h2>
              <p className="mt-4 max-w-md text-sm leading-6 text-primary-foreground/70">
                总次数由系统强一致地扣减，每位用户仅可使用一次。自动生成的明文只展示一次。
              </p>
            </div>
          </div>

          <CardContent className="p-6 lg:p-8">
            <div className="mb-6 flex items-center justify-between gap-4">
              <div>
                <h3 className="text-base font-semibold">创建兑换码</h3>
                <p className="mt-1 text-xs text-muted-foreground">设置价值、发放容量与可选有效期</p>
              </div>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                自定义代码 <Switch checked={custom} onCheckedChange={setCustom} />
              </label>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5 md:col-span-2"><Label className="text-xs">活动名称 / 备注</Label><Input value={label} onChange={e => setLabel(e.target.value)} placeholder="例如：迎新活动积分" /></div>
              {custom && <div className="space-y-1.5 md:col-span-2"><Label className="text-xs">自定义兑换码</Label><Input value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="至少 12 位，需含字母和数字" className="font-mono uppercase" /></div>}
              <div className="space-y-1.5"><Label className="text-xs">每次兑换积分</Label><Input type="number" min={1} value={points} onChange={e => setPoints(e.target.value)} /></div>
              <div className="space-y-1.5"><Label className="text-xs">总可兑换次数</Label><Input type="number" min={1} value={maxUses} onChange={e => setMaxUses(e.target.value)} /></div>
              <div className="space-y-1.5 md:col-span-2"><Label className="text-xs">过期时间（可选）</Label><Input type="datetime-local" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} /></div>
            </div>
            <Button className="mt-6 w-full" onClick={create} disabled={creating}>
              {creating ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
              {creating ? '正在签发' : '创建兑换码'}
            </Button>
            {revealedCode && (
              <div className="mt-5 rounded-xl border border-success/25 bg-success/8 p-4">
                <div className="flex items-center justify-between gap-3"><div><p className="text-xs font-medium text-success">仅展示一次 · 请立即保存</p><p className="mt-2 break-all font-mono text-base font-semibold tracking-wide">{revealedCode}</p></div><Button variant="outline" size="icon-sm" onClick={copyCode}><Copy className="size-4" /></Button></div>
              </div>
            )}
          </CardContent>
        </div>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-4 border-b border-border">
          <div><CardTitle className="text-base">使用情况</CardTitle><p className="mt-1 text-xs text-muted-foreground">点击任意兑换码查看 UID、邮箱与入账时间</p></div>
          <div className="relative w-72 max-w-full"><Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-8" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索名称或掩码" /></div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow className="hover:bg-transparent"><TableHead className="pl-5">兑换码</TableHead><TableHead>价值</TableHead><TableHead>使用进度</TableHead><TableHead>有效期</TableHead><TableHead>状态</TableHead><TableHead className="pr-5 text-right">操作</TableHead></TableRow></TableHeader>
            <TableBody>
              {filtered.map(item => (
                <TableRow key={item.id} className="cursor-pointer" onClick={() => openUses(item)}>
                  <TableCell className="pl-5"><p className="font-medium">{item.label}</p><p className="mt-0.5 font-mono text-xs text-muted-foreground">{item.maskedCode}</p></TableCell>
                  <TableCell className="tabular-nums font-medium">{item.points} 积分</TableCell>
                  <TableCell><div className="w-32"><div className="mb-1 flex justify-between text-xs text-muted-foreground"><span>{item.useCount}</span><span>{item.maxUses}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, item.useCount / item.maxUses * 100)}%` }} /></div></div></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatTime(item.expiresAt)}</TableCell>
                  <TableCell>{item.active ? <Badge variant="secondary" className="bg-success/10 text-success">启用</Badge> : <Badge variant="outline">停用</Badge>}</TableCell>
                  <TableCell className="pr-5 text-right"><Button variant="ghost" size="sm" onClick={e => { e.stopPropagation(); toggleActive(item) }}>{item.active ? <PauseCircle className="size-4" /> : <PlayCircle className="size-4" />}{item.active ? '停用' : '启用'}</Button></TableCell>
                </TableRow>
              ))}
              {!filtered.length && <TableRow><TableCell colSpan={6} className="p-0"><EmptyState icon={<TicketCheck className="size-5" />} title="暂无兑换码" description="使用上方签发区创建第一枚积分兑换码" /></TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={usesOpen} onOpenChange={setUsesOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader><DialogTitle>{selected?.label || '兑换码'} · 使用记录</DialogTitle><DialogDescription>{selected?.maskedCode}，共 {selected?.useCount || 0} 次兑换</DialogDescription></DialogHeader>
          <div className="max-h-[55vh] overflow-auto rounded-xl border border-border">
            {usesLoading ? <div className="flex min-h-40 items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 size-4 animate-spin" />正在加载审计记录</div> : uses.length ? (
              <Table><TableHeader><TableRow><TableHead>用户</TableHead><TableHead>UID</TableHead><TableHead>积分</TableHead><TableHead>时间</TableHead><TableHead>状态</TableHead></TableRow></TableHeader><TableBody>{uses.map(use => <TableRow key={use.id}><TableCell><p className="font-medium">{use.email}</p></TableCell><TableCell className="font-mono text-xs text-muted-foreground">{use.uid}</TableCell><TableCell className="font-medium text-success">+{use.points}</TableCell><TableCell className="text-xs text-muted-foreground">{formatTime(use.redeemedAt)}</TableCell><TableCell><Badge variant={use.status === 'completed' ? 'secondary' : 'outline'}>{use.status === 'completed' ? '已入账' : '同步中'}</Badge></TableCell></TableRow>)}</TableBody></Table>
            ) : <EmptyState icon={<History className="size-5" />} title="尚未使用" description="成功兑换后将在这里记录 UID 与邮箱" />}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
