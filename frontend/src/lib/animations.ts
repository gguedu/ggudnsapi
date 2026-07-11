import type { Variants, Transition } from 'motion/react'

/** 通用缓动曲线 */
export const easeOut: Transition['ease'] = [0.16, 1, 0.3, 1]
export const easeInOut: Transition['ease'] = [0.65, 0, 0.35, 1]

/** 页面切换：淡入 + 轻微上移 */
export const pageVariants: Variants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
}

export const pageTransition: Transition = { duration: 0.25, ease: easeOut }

/** 登录页 → 控制台过渡 */
export const authVariants: Variants = {
  initial: { opacity: 0, scale: 0.98 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 1.02 },
}

export const authTransition: Transition = { duration: 0.3, ease: easeOut }

/** 卡片进场：淡入 + 上移 */
export const cardVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0 },
}

export const cardTransition: Transition = { duration: 0.3, ease: easeOut }

/** 列表容器：stagger 子项 */
export const staggerContainer: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.04, delayChildren: 0.05 },
  },
}

/** 列表项：淡入 + 轻微缩放 */
export const listItemVariants: Variants = {
  hidden: { opacity: 0, y: 6, scale: 0.98 },
  visible: { opacity: 1, y: 0, scale: 1 },
}

export const listItemTransition: Transition = { duration: 0.22, ease: easeOut }

/** 侧栏进场：从左滑入 */
export const sidebarVariants: Variants = {
  initial: { opacity: 0, x: -16 },
  animate: { opacity: 1, x: 0 },
}

export const sidebarTransition: Transition = { duration: 0.35, ease: easeOut }
