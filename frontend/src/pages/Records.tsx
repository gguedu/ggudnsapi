import { useState, useMemo } from 'react'
import type { DnsRecord } from '@/types'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PageHeader, StatCard, EmptyState, StaggerGroup } from '@/components/PageHeader'
import { ClipboardList, Search, CircleCheck, CircleX, Globe, Clock } from 'lucide-react'

interface Props {
  records: DnsRecord[]
}

export default function RecordsPage({ records }: Props) {
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<string>('all')

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    records.forEach(r => { counts[r.type] = (counts[r.type] || 0) + 1 })
    return counts
  }, [records])

  const types = Object.keys(typeCounts).sort()

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return records.filter(r => {
      if (typeFilter !== 'all' && r.type !== typeFilter) return false
      if (!q) return true
      return r.fullDomain.toLowerCase().includes(q) || r.content.toLowerCase().includes(q) || r.uid.toLowerCase().includes(q)
    })
  }, [records, query, typeFilter])

  const stats = {
    total: records.length,
    active: records.filter(r => r.enabled).length,
    disabled: records.filter(r => !r.enabled).length,
  }

  const formatTime = (s: string) => {
    if (!s) return '—'
    const d = new Date(s)
    if (isNaN(d.getTime())) return s
    return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  }

  return (
    <>
      <PageHeader title="解析记录总览" description="查看所有用户的 DNS 解析记录" />

      <StaggerGroup className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="记录总数" value={stats.total} icon={<ClipboardList className="size-4.5" />} />
        <StatCard label="启用中" value={stats.active} icon={<CircleCheck className="size-4.5" />} tone="success" />
        <StatCard label="已关闭" value={stats.disabled} icon={<CircleX className="size-4.5" />} tone={stats.disabled > 0 ? 'destructive' : 'default'} />
        <StatCard label="记录类型" value={types.length} icon={<Globe className="size-4.5" />} hint="种" />
      </StaggerGroup>

      <Card>
        <CardContent className="border-b border-border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-8" placeholder="搜索域名、内容或 UID..." value={query} onChange={e => setQuery(e.target.value)} />
            </div>
            <Select value={typeFilter} onValueChange={v => setTypeFilter(v ?? 'all')}>
              <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部类型</SelectItem>
                {types.map(t => <SelectItem key={t} value={t}>{t} ({typeCounts[t]})</SelectItem>)}
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">{filtered.length} / {records.length}</span>
          </div>
        </CardContent>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-4">域名</TableHead>
                <TableHead>类型</TableHead>
                <TableHead>内容</TableHead>
                <TableHead>用户</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>创建 IP</TableHead>
                <TableHead className="pr-4">创建时间</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(r => (
                <TableRow key={r.id}>
                  <TableCell className="pl-4">
                    <div className="flex items-center gap-2">
                      <Globe className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="font-medium text-foreground">{r.fullDomain}</span>
                    </div>
                    {r.comment && <p className="ml-6 truncate text-xs text-muted-foreground">{r.comment}</p>}
                  </TableCell>
                  <TableCell><Badge variant="secondary" className="font-mono">{r.type}</Badge></TableCell>
                  <TableCell className="max-w-[200px] truncate font-mono text-xs text-muted-foreground" title={r.content}>{r.content}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{r.uid}</TableCell>
                  <TableCell>
                    {r.enabled ? (
                      <Badge variant="secondary" className="bg-success/10 text-success gap-1"><CircleCheck className="size-3" />启用</Badge>
                    ) : (
                      <Badge variant="destructive" className="gap-1"><CircleX className="size-3" />关闭</Badge>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{r.createIp || '—'}</TableCell>
                  <TableCell className="pr-4 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1"><Clock className="size-3" />{formatTime(r.createdAt)}</span>
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={7} className="p-0">
                    <EmptyState
                      icon={<ClipboardList className="size-5" />}
                      title={query || typeFilter !== 'all' ? '未找到匹配的记录' : '暂无解析记录'}
                      description={query || typeFilter !== 'all' ? '尝试调整搜索或筛选条件' : '用户创建解析记录后将显示在此处'}
                    />
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  )
}
