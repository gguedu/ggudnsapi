import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { cn } from '@/lib/utils'
import { cardVariants, cardTransition, staggerContainer, listItemVariants, listItemTransition } from '@/lib/animations'

interface PageHeaderProps {
  title: string
  description?: string
  children?: ReactNode
  className?: string
}

export function PageHeader({ title, description, children, className }: PageHeaderProps) {
  return (
    <motion.div
      variants={cardVariants}
      initial="hidden"
      animate="visible"
      transition={cardTransition}
      className={cn('flex items-start justify-between gap-4', className)}
    >
      <div className="min-w-0 space-y-1">
        <h2 className="text-lg font-semibold tracking-tight text-foreground truncate">{title}</h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </motion.div>
  )
}

/** Stagger 容器：包裹多个 StatCard 或其他子项实现依次进场 */
export function StaggerGroup({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
      className={className}
    >
      {children}
    </motion.div>
  )
}

interface StatCardProps {
  label: string
  value: ReactNode
  icon?: ReactNode
  hint?: string
  tone?: 'default' | 'success' | 'warning' | 'destructive'
}

export function StatCard({ label, value, icon, hint, tone = 'default' }: StatCardProps) {
  const toneClass = {
    default: 'text-muted-foreground bg-muted/60',
    success: 'text-success bg-success/10',
    warning: 'text-warning bg-warning/10',
    destructive: 'text-destructive bg-destructive/10',
  }[tone]

  return (
    <motion.div
      variants={listItemVariants}
      transition={listItemTransition}
      className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3.5"
    >
      {icon && (
        <div className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg', toneClass)}>
          {icon}
        </div>
      )}
      <div className="min-w-0 space-y-0.5">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <div className="flex items-baseline gap-1.5">
          <span className="text-xl font-semibold tabular-nums text-foreground">{value}</span>
          {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
        </div>
      </div>
    </motion.div>
  )
}

interface EmptyStateProps {
  icon?: ReactNode
  title: string
  description?: string
  children?: ReactNode
}

export function EmptyState({ icon, title, description, children }: EmptyStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className="flex flex-col items-center justify-center gap-3 py-16 text-center"
    >
      {icon && (
        <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          {icon}
        </div>
      )}
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      {children}
    </motion.div>
  )
}

/** 可动画的列表项包装器，配合 StaggerGroup 实现依次进场 */
export function MotionItem({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div variants={listItemVariants} transition={listItemTransition} className={className}>
      {children}
    </motion.div>
  )
}
