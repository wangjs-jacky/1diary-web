import { useState, type FormEvent } from 'react';
import { useAuth } from './AuthContext';

export function LoginPage() {
  const auth = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
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
    const message = await auth.signIn(email.trim(), password);
    if (message) setError('账号或密码不正确');
    setSubmitting(false);
  }

  return (
    <main className="center-page">
      <form className="login-card" onSubmit={submit}>
        <div className="login-mark">一</div>
        <h1>一本日记</h1>
        <p>写给自己，也只由自己阅读。</p>
        <label>
          <span>账号</span>
          <input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </label>
        <label>
          <span>密码</span>
          <input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
        </label>
        {error && <div className="form-error">{error}</div>}
        <button className="primary-button" disabled={submitting}>{submitting ? '正在进入…' : '进入日记'}</button>
      </form>
    </main>
  );
}
