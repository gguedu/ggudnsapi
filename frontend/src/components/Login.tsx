import { useState, type FormEvent } from 'react'
import { motion } from 'motion/react'
import { adminLogin } from '@/api/admin'
import { setToken, ApiError } from '@/api/client'
import type { AuthMe } from '@/types'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Globe, Loader2, Lock, Mail, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'

interface Props {
  onLogin: (me: AuthMe) => void
}

export default function Login({ onLogin }: Props) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!email.trim() || !password) {
      toast.error('请输入邮箱和密码')
      return
    }
    setLoading(true)
    try {
      const data = await adminLogin(email.trim(), password)
      if (data.isAdmin) {
        setToken(data.token)
        toast.success('登录成功')
        onLogin(data)
      } else {
        toast.error('当前账号无管理员权限')
      }
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : '登录失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-primary/5 via-background to-accent/40 p-4">
      <div
        className="pointer-events-none absolute -top-40 -right-40 size-96 rounded-full bg-primary/8 blur-3xl"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -bottom-40 -left-40 size-96 rounded-full bg-accent/60 blur-3xl"
        aria-hidden
      />

      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="relative w-full max-w-sm"
      >
        <Card className="shadow-xl ring-1 ring-border/50">
          <CardHeader className="items-center gap-0 text-center">
            <div className="mb-3 flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/25">
              <Globe className="size-6" />
            </div>
            <CardTitle className="text-xl tracking-tight">GGU DNS</CardTitle>
            <CardDescription className="mt-1">DNS 解析管理控制台</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-xs font-medium text-muted-foreground">
                  管理员邮箱
                </Label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    className="pl-8"
                    placeholder="admin@ggu.edu"
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={loading}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-xs font-medium text-muted-foreground">
                  密码
                </Label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="password"
                    type="password"
                    className="pl-8"
                    placeholder="请输入密码"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={loading}
                  />
                </div>
              </div>
              <Button type="submit" className="w-full" size="lg" disabled={loading}>
                {loading ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
                {loading ? '验证中...' : '登录控制台'}
              </Button>
            </form>
            <p className="mt-4 text-center text-xs text-muted-foreground">
              使用 GGU 通行证账号登录，需在管理员白名单中
            </p>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  )
}
