import { useState, useMemo } from 'react'
import {
  addBanReasonPreset, addUser, adjustPoints, banUser, deleteUser, disableBanReasonPreset,
} from '@/api/admin'
import { ApiError } from '@/api/client'
import type { BanReasonPreset, DnsUser } from '@/types'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { PageHeader, StatCard, EmptyState, StaggerGroup } from '@/components/PageHeader'
import { toast } from 'sonner'
import {
  Loader2, Plus, Search, MoreHorizontal, Coins, Ban, Trash2, UserCheck,
  Users as UsersIcon, ShieldOff, FileText, X,
} from 'lucide-react'

interface Props {
  users: DnsUser[]
  presets: BanReasonPreset[]
  onRefresh: () => void
}

export default function UsersPage({ users, presets, onRefresh }: Props) {
  const [query, setQuery] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [actioning, setActioning] = useState(false)

  // 添加用户表单
  const [email, setEmail] = useState('')
  const [uid, setUid] = useState('')
  const [name, setName] = useState('')
  const [points, setPoints] = useState('')

  // 操作弹窗
  const [dialog, setDialog] = useState<{ type: 'points' | 'ban' | 'delete'; uid: string } | null>(null)
  const [pointsDelta, setPointsDelta] = useState('')
  const [banReason, setBanReason] = useState('')
  const [selectedPresetId, setSelectedPresetId] = useState('')
  const [newPreset, setNewPreset] = useState('')
  const [presetActioning, setPresetActioning] = useState(false)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return users
    return users.filter(u =>
      u.email.toLowerCase().includes(q) ||
      u.uid.toLowerCase().includes(q) ||
      u.name.toLowerCase().includes(q),
    )
  }, [users, query])

  const stats = useMemo(() => ({
    total: users.length,
    active: users.filter(u => !u.banned).length,
    banned: users.filter(u => u.banned).length,
    records: users.reduce((s, u) => s + u.recordCount, 0),
  }), [users])

  const handleAdd = async () => {
    if (!email.trim()) { toast.error('请输入邮箱'); return }
    setActioning(true)
    try {
      await addUser({
        email: email.trim(),
        uid: uid.trim() || undefined,
        name: name.trim() || undefined,
        points: points ? Number(points) : undefined,
      })
      toast.success('用户添加成功')
      setEmail(''); setUid(''); setName(''); setPoints('')
      setAddOpen(false)
      onRefresh()
    } catch (e) { toast.error(e instanceof ApiError ? e.message : '添加失败') }
    finally { setActioning(false) }
  }

  const handleAction = async () => {
    if (!dialog) return
    setActioning(true)
    try {
      if (dialog.type === 'points') {
        const delta = Number(pointsDelta)
        if (!delta) { toast.error('请输入有效的非零整数'); setActioning(false); return }
        await adjustPoints(dialog.uid, delta)
        toast.success('积分已调整')
      } else if (dialog.type === 'ban') {
        const user = users.find(u => u.uid === dialog.uid)
        if (user?.banned) {
          await banUser(dialog.uid, false, '管理员解除封禁')
          toast.success('用户已解封')
        } else {
          await banUser(dialog.uid, true, banReason || undefined, selectedPresetId || undefined)
          toast.success('用户已封禁')
        }
      } else {
        await deleteUser(dialog.uid)
        toast.success('用户已删除')
      }
      setDialog(null)
      onRefresh()
    } catch (e) { toast.error(e instanceof ApiError ? e.message : '操作失败') }
    finally { setActioning(false) }
  }

  const openDialog = (type: 'points' | 'ban' | 'delete', uid: string) => {
    setPointsDelta('')
    setBanReason('')
    setSelectedPresetId('')
    setDialog({ type, uid })
  }

  const targetUser = dialog ? users.find(u => u.uid === dialog.uid) : null

  const handleAddPreset = async () => {
    if (!newPreset.trim()) return
    setPresetActioning(true)
    try {
      const preset = await addBanReasonPreset(newPreset.trim())
      setSelectedPresetId(preset.id)
      setNewPreset('')
      toast.success('封禁理由预设已添加')
      onRefresh()
    } catch (e) { toast.error(e instanceof ApiError ? e.message : '添加预设失败') }
    finally { setPresetActioning(false) }
  }

  const handleDisablePreset = async (id: string) => {
    setPresetActioning(true)
    try {
      await disableBanReasonPreset(id)
      if (selectedPresetId === id) setSelectedPresetId('')
      toast.success('预设已停用')
      onRefresh()
    } catch (e) { toast.error(e instanceof ApiError ? e.message : '停用预设失败') }
    finally { setPresetActioning(false) }
  }

  return (
    <>
      <PageHeader title="用户管理" description="管理 DNS 平台用户、积分与访问权限">
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="size-3.5" />
          添加用户
        </Button>
      </PageHeader>

      <StaggerGroup className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="总用户数" value={stats.total} icon={<UsersIcon className="size-4.5" />} />
        <StatCard label="活跃用户" value={stats.active} icon={<UserCheck className="size-4.5" />} tone="success" />
        <StatCard label="已封禁" value={stats.banned} icon={<ShieldOff className="size-4.5" />} tone={stats.banned > 0 ? 'destructive' : 'default'} />
        <StatCard label="解析记录总数" value={stats.records} icon={<FileText className="size-4.5" />} />
      </StaggerGroup>

      <Card>
        <CardContent className="border-b border-border p-3">
          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="搜索邮箱、UID 或名称..."
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
          </div>
        </CardContent>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-4">用户</TableHead>
                <TableHead>UID</TableHead>
                <TableHead className="text-right">积分</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="text-right">解析数</TableHead>
                <TableHead className="w-10 pr-4"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(user => (
                <TableRow key={user.uid}>
                  <TableCell className="pl-4">
                    <div className="flex items-center gap-2.5">
                      <Avatar size="sm">
                        <AvatarFallback className="bg-muted text-xs font-medium text-muted-foreground">
                          {user.email.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">{user.email}</p>
                        {user.name && <p className="truncate text-xs text-muted-foreground">{user.name}</p>}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{user.uid}</TableCell>
                  <TableCell className="text-right tabular-nums font-medium">{user.points}</TableCell>
                  <TableCell>
                    {user.banned ? (
                      <div>
                        <Badge variant="destructive">已封禁</Badge>
                        {user.bannedReason && <p className="mt-1 max-w-44 truncate text-[11px] text-destructive" title={user.bannedReason}>{user.bannedReason}</p>}
                        {user.bannedAt && <p className="mt-0.5 text-[10px] text-muted-foreground">{new Date(user.bannedAt).toLocaleString('zh-CN')}</p>}
                      </div>
                    ) : (
                      <Badge variant="secondary" className="bg-success/10 text-success">正常</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{user.recordCount}</TableCell>
                  <TableCell className="pr-4">
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={<Button variant="ghost" size="icon-sm" className="text-muted-foreground" />}
                      >
                        <MoreHorizontal className="size-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-40">
                        <DropdownMenuItem onClick={() => openDialog('points', user.uid)}>
                          <Coins className="size-4" />
                          调整积分
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => openDialog('ban', user.uid)}>
                          {user.banned ? <><UserCheck className="size-4" />解封用户</> : <><Ban className="size-4" />封禁用户</>}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onClick={() => openDialog('delete', user.uid)}>
                          <Trash2 className="size-4" />
                          删除用户
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={6} className="p-0">
                    <EmptyState
                      icon={<UsersIcon className="size-5" />}
                      title={query ? '未找到匹配的用户' : '暂无用户'}
                      description={query ? '尝试调整搜索关键词' : '点击「添加用户」创建第一个用户'}
                    />
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* 添加用户 Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>添加用户</DialogTitle>
            <DialogDescription>为新用户分配初始积分，UID 留空则使用邮箱作为标识。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">邮箱 *</Label>
              <Input value={email} onChange={e => setEmail(e.target.value)} placeholder="user@ggu.edu" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">UID（可选）</Label>
                <Input value={uid} onChange={e => setUid(e.target.value)} placeholder="自动生成" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">初始积分</Label>
                <Input type="number" min={0} value={points} onChange={e => setPoints(e.target.value)} placeholder="0" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">名称 / 备注</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="可选" />
            </div>
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

      {/* 操作 Dialog */}
      {dialog && (
        <Dialog open onOpenChange={() => setDialog(null)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>
                {dialog.type === 'delete' ? '删除用户' :
                 dialog.type === 'ban' ? (targetUser?.banned ? '解封用户' : '封禁用户') :
                 '调整积分'}
              </DialogTitle>
              <DialogDescription>
                {dialog.type === 'delete' ? '此操作不可撤销。仅可删除没有解析记录的用户。' :
                 dialog.type === 'ban' ? (targetUser?.banned ? '解封后该用户可恢复使用 DNS 用户功能，历史操作仍会保留。' : '封禁后用户仍可登录通行证，但无法使用 DNS 记录、积分与兑换功能。') :
                 '输入积分增减量，正数增加，负数扣减。'}
              </DialogDescription>
            </DialogHeader>
            {targetUser && (
              <div className="flex items-center gap-2.5 rounded-lg border border-border bg-muted/40 px-3 py-2">
                <Avatar size="sm">
                  <AvatarFallback className="bg-muted text-xs">{targetUser.email.slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{targetUser.email}</p>
                  <p className="font-mono text-xs text-muted-foreground">{targetUser.uid} · 当前 {targetUser.points} 积分</p>
                </div>
              </div>
            )}
            {dialog.type === 'points' && (
              <div className="space-y-1.5">
                <Label className="text-xs">积分变动量</Label>
                <Input type="number" value={pointsDelta} onChange={e => setPointsDelta(e.target.value)} placeholder="例如 10 或 -5" autoFocus />
              </div>
            )}
            {dialog.type === 'ban' && !targetUser?.banned && (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">理由预设</Label>
                  <div className="flex flex-wrap gap-2">
                    {presets.filter(item => item.active).map(preset => (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => { setSelectedPresetId(preset.id); setBanReason('') }}
                        className={`group inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors ${selectedPresetId === preset.id ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-muted/40 text-muted-foreground hover:text-foreground'}`}
                      >
                        {preset.reason}
                        <span
                          role="button"
                          tabIndex={0}
                          className="ml-0.5 opacity-45 hover:opacity-100"
                          onClick={event => { event.stopPropagation(); handleDisablePreset(preset.id) }}
                          onKeyDown={event => { if (event.key === 'Enter') handleDisablePreset(preset.id) }}
                        ><X className="size-3" /></span>
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Input value={newPreset} onChange={e => setNewPreset(e.target.value)} placeholder="添加常用封禁理由" />
                    <Button variant="outline" onClick={handleAddPreset} disabled={presetActioning || !newPreset.trim()}>添加</Button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">自定义理由</Label>
                  <Input value={banReason} onChange={e => { setBanReason(e.target.value); if (e.target.value) setSelectedPresetId('') }} placeholder="也可以手动填写具体原因" autoFocus />
                  <p className="text-[11px] text-muted-foreground">理由会连同封禁时间展示给用户。</p>
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialog(null)}>取消</Button>
              <Button
                variant={dialog.type === 'points' ? 'default' : 'destructive'}
                onClick={handleAction}
                disabled={actioning || (dialog.type === 'ban' && !targetUser?.banned && !banReason.trim() && !selectedPresetId)}
              >
                {actioning && <Loader2 className="size-3.5 animate-spin" />}
                确认
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
