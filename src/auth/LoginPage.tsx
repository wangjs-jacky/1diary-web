import { Eye, EyeOff, LockKeyhole, Mail } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { AppIcon, DiaryMark } from '../ui/icons';
import { useAuth } from './AuthContext';

export function LoginPage() {
  const auth = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!auth.configured) {
    return (
      <main className="center-page">
        <section className="login-card">
          <div className="login-mark">一</div>
          <h1>需要完成连接配置</h1>
          <p>请在部署环境中设置 Supabase URL、匿名公钥和后端 API 地址。</p>
          <code>VITE_SUPABASE_URL · VITE_SUPABASE_ANON_KEY · VITE_API_URL</code>
        </section>
      </main>
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    setNotice('');
    if (mode === 'register') {
      if (password.length < 8) {
        setError('密码至少需要 8 个字符');
        setSubmitting(false);
        return;
      }
      if (password !== confirmation) {
        setError('两次输入的密码不一致');
        setSubmitting(false);
        return;
      }
      const result = await auth.signUp(email.trim(), password);
      if (result.error) setError('暂时无法创建账号，请稍后重试');
      else if (result.confirmationRequired) setNotice('注册成功，请检查邮箱完成验证');
    } else {
      const message = await auth.signIn(email.trim(), password);
      if (message) setError('邮箱或密码不正确');
    }
    setSubmitting(false);
  }

  function switchMode(next: 'login' | 'register') {
    setMode(next);
    setError('');
    setNotice('');
    setConfirmation('');
  }

  return (
    <main className="center-page">
      <form className="login-card" onSubmit={submit}>
        <div className="login-mark" aria-hidden="true"><DiaryMark size={35} /></div>
        <h1>一本日记</h1>
        <p>{mode === 'login' ? '回来继续写下今天。' : '为自己的时间留下一本书。'}</p>
        <div className="auth-mode-switch" aria-label="账号入口">
          <button type="button" aria-pressed={mode === 'login'} onClick={() => switchMode('login')}>登录</button>
          <button type="button" aria-pressed={mode === 'register'} onClick={() => switchMode('register')}>创建账号</button>
        </div>
        <label className="auth-field">
          <span>邮箱</span>
          <div className="auth-input-shell">
            <AppIcon icon={Mail} name="email" size={17} />
            <input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </div>
        </label>
        <label className="auth-field">
          <span>密码</span>
          <div className="auth-input-shell">
            <AppIcon icon={LockKeyhole} name="password" size={17} />
            <input
              type={showPassword ? 'text' : 'password'}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={mode === 'register' ? 8 : undefined}
              required
            />
            <button
              type="button"
              className="password-visibility"
              aria-label={showPassword ? '隐藏密码' : '显示密码'}
              onClick={() => setShowPassword((visible) => !visible)}
            >
              <AppIcon icon={showPassword ? EyeOff : Eye} name={showPassword ? 'hide-password' : 'show-password'} size={17} />
            </button>
          </div>
        </label>
        {mode === 'register' && (
          <label className="auth-field">
            <span>确认密码</span>
            <div className="auth-input-shell">
              <AppIcon icon={LockKeyhole} name="confirm-password" size={17} />
              <input
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                minLength={8}
                required
              />
            </div>
          </label>
        )}
        {error && <div className="form-error" role="alert">{error}</div>}
        {notice && <div className="form-notice" role="status">{notice}</div>}
        <button className="primary-button" disabled={submitting}>
          {submitting ? (mode === 'login' ? '正在进入…' : '正在创建…') : (mode === 'login' ? '进入日记' : '创建并开始记录')}
        </button>
      </form>
    </main>
  );
}
