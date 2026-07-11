import { useState } from 'react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { LogOut, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  email: string
  uid: string
  collapsed: boolean
  onLogout: () => void
}

export default function UserMenu({ email, uid, collapsed, onLogout }: Props) {
  const [confirmOpen, setConfirmOpen] = useState(false)

  const initials = (() => {
    const name = email.split('@')[0] || email
    const matches = name.match(/[a-zA-Z]/g)
    if (matches && matches.length >= 2) return matches.slice(0, 2).join('').toUpperCase()
    if (matches && matches.length === 1) return matches[0].toUpperCase()
    return email.slice(0, 2).toUpperCase()
  })()

  const handleLogout = () => {
    setConfirmOpen(false)
    onLogout()
  }

  const confirmDialog = (
    <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <div className="mb-1 flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <LogOut className="size-5" />
          </div>
          <DialogTitle>退出登录</DialogTitle>
          <DialogDescription>
            确认退出当前账号？退出后需要重新登录才能访问管理控制台。
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2.5 rounded-lg border border-border bg-muted/40 px-3 py-2">
          <Avatar size="sm">
            <AvatarFallback className="bg-gradient-to-br from-primary/80 to-primary text-xs font-semibold text-primary-foreground">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{email}</p>
            <p className="truncate font-mono text-xs text-muted-foreground">{uid}</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setConfirmOpen(false)}>取消</Button>
          <Button variant="destructive" onClick={handleLogout}>
            确认退出
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  const avatarEl = (
    <Avatar size="sm" className="shrink-0 ring-2 ring-transparent transition-shadow group-hover:ring-sidebar-border">
      <AvatarFallback className="bg-gradient-to-br from-primary/80 to-primary text-xs font-semibold text-primary-foreground">
        {initials}
      </AvatarFallback>
    </Avatar>
  )

  if (collapsed) {
    return (
      <>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label="用户菜单"
                className="group flex w-full justify-center rounded-lg p-2 transition-colors hover:bg-sidebar-accent"
                onClick={() => setConfirmOpen(true)}
              />
            }
          >
            {avatarEl}
          </TooltipTrigger>
          <TooltipContent side="right" className="max-w-[200px]">
            <div className="min-w-0">
              <p className="truncate font-medium">{email}</p>
              <p className="truncate font-mono text-[10px] opacity-70">{uid}</p>
            </div>
          </TooltipContent>
        </Tooltip>
        {confirmDialog}
      </>
    )
  }

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          className={cn(
            'group flex w-full items-center gap-2.5 rounded-lg p-2 text-left transition-colors',
            'hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
        >
          {avatarEl}
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-sidebar-foreground">{email}</p>
            <p className="truncate font-mono text-[10px] text-muted-foreground">{uid}</p>
          </div>
          <ChevronUp className="size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-sidebar-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="top" sideOffset={8} className="w-56">
          <DropdownMenuLabel>
            <div className="flex items-center gap-2.5">
              <Avatar size="sm">
                <AvatarFallback className="bg-gradient-to-br from-primary/80 to-primary text-xs font-semibold text-primary-foreground">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 space-y-0.5">
                <p className="truncate text-sm font-medium text-foreground">{email}</p>
                <p className="truncate font-mono text-xs text-muted-foreground">{uid}</p>
              </div>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => setConfirmOpen(true)}>
            <LogOut className="size-4" />
            退出登录
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {confirmDialog}
    </>
  )
}
