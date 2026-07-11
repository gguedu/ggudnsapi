import { useState, useCallback } from 'react'
import { updateSettings } from '@/api/admin'
import { ApiError } from '@/api/client'
import type { GlobalSettings } from '@/types'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { PageHeader, StaggerGroup, MotionItem } from '@/components/PageHeader'
import { toast } from 'sonner'
import { Loader2, Save, ShieldCheck, Coins, Clock, ListChecks } from 'lucide-react'
import { cn } from '@/lib/utils'

const ALL_TYPES = [
  'A', 'AAAA', 'CNAME', 'HTTPS', 'TXT', 'SRV', 'LOC', 'MX', 'NS',
  'CERT', 'DNSKEY', 'DS', 'NAPTR', 'SMIMEA', 'SSHFP', 'SVCB', 'TLSA', 'URI', 'CAA',
]

interface Props {
  settings: GlobalSettings
  onRefresh: () => void
}

export default function SettingsPage({ settings, onRefresh }: Props) {
  const [saving, setSaving] = useState(false)
  const [draggedType, setDraggedType] = useState('')
  const [initialPoints, setInitialPoints] = useState(String(settings.initialPoints))
  const [refundEnabled, setRefundEnabled] = useState(settings.deleteRefundEnabled)
  const [protectionEnabled, setProtectionEnabled] = useState(settings.protectionEnabled)
  const [defaultTtl, setDefaultTtl] = useState(String(settings.defaultTtl))
  const [allowedTypes, setAllowedTypes] = useState<string[]>(settings.allowedTypes)

  const rejectedTypes = ALL_TYPES.filter(t => !allowedTypes.includes(t))

  const save = async (patch: Partial<GlobalSettings>) => {
    setSaving(true)
    try {
      await updateSettings(patch)
      toast.success('保存成功')
      onRefresh()
    } catch (e) { toast.error(e instanceof ApiError ? e.message : '保存失败') }
    finally { setSaving(false) }
  }

  const handleDrop = useCallback((target: 'allow' | 'reject') => {
    if (!draggedType) return
    if (target === 'allow') {
      setAllowedTypes(prev => prev.includes(draggedType) ? prev : [...prev, draggedType])
    } else {
      setAllowedTypes(prev => prev.filter(t => t !== draggedType))
    }
    setDraggedType('')
  }, [draggedType])

  return (
    <>
      <PageHeader title="系统设置" description="配置全局解析策略与积分规则" />

      <StaggerGroup className="space-y-6">
      <MotionItem>
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <ListChecks className="size-4" />
            </div>
            <div>
              <CardTitle>解析类型权限</CardTitle>
              <CardDescription>拖拽类型在允许和拒绝之间移动</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div
              className="min-h-[120px] rounded-lg border-2 border-dashed border-primary/30 bg-primary/5 p-3"
              onDragOver={e => e.preventDefault()}
              onDrop={() => handleDrop('allow')}
            >
              <span className="mb-2 block text-xs font-medium text-primary">允许 ({allowedTypes.length})</span>
              <div className="flex flex-wrap gap-1.5">
                {allowedTypes.map(t => (
                  <span
                    key={t}
                    draggable
                    onDragStart={() => setDraggedType(t)}
                    className={cn(
                      'inline-flex items-center rounded-md border border-primary/20 bg-primary/10 px-2 py-0.5 font-mono text-xs font-medium text-primary cursor-grab active:cursor-grabbing',
                      draggedType === t && 'opacity-40',
                    )}
                  >
                    {t}
                  </span>
                ))}
                {allowedTypes.length === 0 && <span className="text-xs text-muted-foreground">拖拽类型至此处</span>}
              </div>
            </div>
            <div
              className="min-h-[120px] rounded-lg border-2 border-dashed border-muted-foreground/25 bg-muted/30 p-3"
              onDragOver={e => e.preventDefault()}
              onDrop={() => handleDrop('reject')}
            >
              <span className="mb-2 block text-xs font-medium text-muted-foreground">拒绝 ({rejectedTypes.length})</span>
              <div className="flex flex-wrap gap-1.5">
                {rejectedTypes.map(t => (
                  <span
                    key={t}
                    draggable
                    onDragStart={() => setDraggedType(t)}
                    className={cn(
                      'inline-flex items-center rounded-md border border-border bg-card px-2 py-0.5 font-mono text-xs font-medium text-muted-foreground cursor-grab active:cursor-grabbing',
                      draggedType === t && 'opacity-40',
                    )}
                  >
                    {t}
                  </span>
                ))}
                {rejectedTypes.length === 0 && <span className="text-xs text-muted-foreground">已全部允许</span>}
              </div>
            </div>
          </div>
          <div className="flex justify-end">
            <Button size="sm" onClick={() => save({ allowedTypes })} disabled={saving}>
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
              保存类型配置
            </Button>
          </div>
        </CardContent>
      </Card>
      </MotionItem>

      <MotionItem>
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-success/10 text-success">
              <ShieldCheck className="size-4" />
            </div>
            <div>
              <CardTitle>安全策略</CardTitle>
              <CardDescription>子域保护防止用户抢占二级子域名</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">子域保护</Label>
              <p className="text-xs text-muted-foreground">开启后，首个创建子域的用户拥有该二级子域独占权</p>
            </div>
            <Switch checked={protectionEnabled} onCheckedChange={setProtectionEnabled} />
          </div>
          <div className="mt-3 flex justify-end">
            <Button size="sm" onClick={() => save({ protectionEnabled })} disabled={saving}>
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
              保存安全策略
            </Button>
          </div>
        </CardContent>
      </Card>
      </MotionItem>

      <MotionItem>
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-warning/10 text-warning">
              <Coins className="size-4" />
            </div>
            <div>
              <CardTitle>积分设置</CardTitle>
              <CardDescription>控制新用户积分和删除退款行为</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">新用户初始积分</Label>
              <p className="text-xs text-muted-foreground">注册时自动发放的积分数量</p>
            </div>
            <Input type="number" min={0} className="w-24 text-right" value={initialPoints} onChange={e => setInitialPoints(e.target.value)} />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">删除退积分</Label>
              <p className="text-xs text-muted-foreground">删除解析记录时返还消耗的积分</p>
            </div>
            <Switch checked={refundEnabled} onCheckedChange={setRefundEnabled} />
          </div>
          <div className="flex justify-end">
            <Button size="sm" onClick={() => save({ initialPoints: Number(initialPoints), deleteRefundEnabled: refundEnabled })} disabled={saving}>
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
              保存积分设置
            </Button>
          </div>
        </CardContent>
      </Card>
      </MotionItem>

      <MotionItem>
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Clock className="size-4" />
            </div>
            <div>
              <CardTitle>默认 TTL</CardTitle>
              <CardDescription>解析记录的默认生存时间（秒）</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">默认 TTL（秒）</Label>
              <p className="text-xs text-muted-foreground">最小值 60 秒，Cloudflare 代理记录固定为 Auto</p>
            </div>
            <Input type="number" min={60} className="w-24 text-right" value={defaultTtl} onChange={e => setDefaultTtl(e.target.value)} />
          </div>
          <div className="mt-3 flex justify-end">
            <Button size="sm" onClick={() => save({ defaultTtl: Number(defaultTtl) })} disabled={saving}>
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
              保存 TTL
            </Button>
          </div>
        </CardContent>
      </Card>
      </MotionItem>
      </StaggerGroup>
    </>
  )
}
