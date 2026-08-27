import {
  ArrowLeft,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, apiRequest } from '../data/api';
import { AppIcon } from '../ui/icons';

type PatScope = 'diary:read' | 'diary:write';

type PersonalAccessToken = {
  id: string;
  tokenPrefix: string;
  name: string;
  scopes: PatScope[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
};

type CreatedPersonalAccessToken = PersonalAccessToken & { token: string };

type TokenStatus = 'active' | 'expired' | 'revoked';

function statusOf(token: PersonalAccessToken): TokenStatus {
  if (token.revokedAt) return 'revoked';
  if (token.expiresAt && new Date(token.expiresAt).getTime() <= Date.now()) {
    return 'expired';
  }
  return 'active';
}

function statusLabel(status: TokenStatus): string {
  return { active: '有效', expired: '已过期', revoked: '已撤销' }[status];
}

function formatDateTime(value: string | null, empty: string): string {
  if (!value) return empty;
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return '登录状态已过期，请重新登录';
    if (error.status === 403) return '当前账号没有管理访问令牌的权限';
  }
  return fallback;
}

function SecretDialog({
  created,
  onClose,
}: {
  created: CreatedPersonalAccessToken;
  onClose(): void;
}) {
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copyToken() {
    try {
      await navigator.clipboard.writeText(created.token);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  function closeWithWarning() {
    if (window.confirm('关闭后将无法再次查看完整 Token。确认已经安全保存？')) {
      onClose();
    }
  }

  return (
    <div className="token-secret-overlay">
      <section
        className="token-secret-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="token-secret-title"
      >
        <header>
          <div className="token-secret-icon"><AppIcon icon={KeyRound} name="token-created" size={22} /></div>
          <div>
            <span>创建成功</span>
            <h2 id="token-secret-title">保存访问令牌</h2>
          </div>
          <button type="button" onClick={closeWithWarning} aria-label="关闭"><AppIcon icon={X} name="close" /></button>
        </header>
        <p>这是唯一一次显示完整 Token。复制并保存到密码管理器，关闭后无法再次查看。</p>
        <div className="token-secret-value">
          <code>{visible ? created.token : '••••••••••••••••••••••••••••••••••••••••'}</code>
          <button
            type="button"
            onClick={() => setVisible((value) => !value)}
            aria-label={visible ? '隐藏 Token' : '显示 Token'}
          >
            <AppIcon icon={visible ? EyeOff : Eye} name={visible ? 'hide-token' : 'show-token'} size={17} />
          </button>
        </div>
        <footer>
          <button type="button" className="token-copy-button" onClick={() => void copyToken()}>
            <AppIcon icon={Copy} name="copy-token" size={16} />
            {copied ? '已复制' : '复制 Token'}
          </button>
          <button type="button" className="token-saved-button" onClick={onClose}>我已安全保存</button>
        </footer>
      </section>
    </div>
  );
}

export function TokenPage() {
  const [tokens, setTokens] = useState<PersonalAccessToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [permission, setPermission] = useState<'read' | 'read-write'>('read-write');
  const [expiration, setExpiration] = useState('90');
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedPersonalAccessToken | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void apiRequest<PersonalAccessToken[]>('/pats')
      .then((items) => {
        if (active) setTokens(items);
      })
      .catch((requestError: unknown) => {
        if (active) setError(errorMessage(requestError, '暂时无法加载访问令牌'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function createToken(event: FormEvent) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;
    setCreating(true);
    setError('');
    const scopes: PatScope[] =
      permission === 'read-write'
        ? ['diary:read', 'diary:write']
        : ['diary:read'];
    const expiresAt =
      expiration === 'never'
        ? null
        : new Date(
            Date.now() + Number(expiration) * 24 * 60 * 60 * 1000,
          ).toISOString();
    try {
      const next = await apiRequest<CreatedPersonalAccessToken>('/pats', {
        method: 'POST',
        body: JSON.stringify({ name: trimmedName, scopes, expiresAt }),
      });
      setTokens((current) => [next, ...current]);
      setCreated(next);
      setName('');
    } catch (requestError) {
      setError(errorMessage(requestError, '暂时无法创建访问令牌'));
    } finally {
      setCreating(false);
    }
  }

  async function revokeToken(token: PersonalAccessToken) {
    if (!window.confirm(`撤销“${token.name}”？使用它的程序将立即无法访问日记。`)) return;
    setRevokingId(token.id);
    setError('');
    try {
      await apiRequest<void>(`/pats/${token.id}`, { method: 'DELETE' });
      const revokedAt = new Date().toISOString();
      setTokens((current) =>
        current.map((item) => item.id === token.id ? { ...item, revokedAt } : item),
      );
    } catch (requestError) {
      setError(errorMessage(requestError, '暂时无法撤销访问令牌'));
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <div className="token-page">
      <header className="token-page-header">
        <Link to="/" aria-label="返回日记"><AppIcon icon={ArrowLeft} name="back" size={18} />返回</Link>
        <div>
          <span>开发者访问</span>
          <h1>访问令牌</h1>
          <p>为 CLI、Agent 或个人脚本创建独立凭证，无需共享账号密码。</p>
        </div>
        <div className="token-security-note"><AppIcon icon={ShieldCheck} name="secure-token" size={17} />Token 只显示一次</div>
      </header>

      <main className="token-page-content">
        <section className="token-create-card" aria-labelledby="token-create-title">
          <div className="token-section-heading">
            <div>
              <span>新凭证</span>
              <h2 id="token-create-title">创建 Token</h2>
            </div>
            <p>为每个工具分别创建，停用时只需撤销对应 Token。</p>
          </div>
          <form onSubmit={(event) => void createToken(event)}>
            <label>
              <span>名称</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="例如：Codex on Mac mini"
                maxLength={100}
                required
              />
            </label>
            <label>
              <span>权限</span>
              <select value={permission} onChange={(event) => setPermission(event.target.value as 'read' | 'read-write')}>
                <option value="read-write">读写日记</option>
                <option value="read">只读日记</option>
              </select>
            </label>
            <label>
              <span>有效期</span>
              <select value={expiration} onChange={(event) => setExpiration(event.target.value)}>
                <option value="30">30 天</option>
                <option value="90">90 天</option>
                <option value="365">1 年</option>
                <option value="never">永不过期</option>
              </select>
            </label>
            <button type="submit" className="token-create-button" disabled={creating}>
              <AppIcon icon={KeyRound} name="create-token" size={17} />
              {creating ? '正在创建…' : '创建 Token'}
            </button>
          </form>
          {error && <div className="token-page-error" role="alert">{error}</div>}
        </section>

        <section className="token-list-card" aria-labelledby="token-list-title">
          <div className="token-section-heading token-list-heading">
            <div>
              <span>凭证记录</span>
              <h2 id="token-list-title">已创建的 Token</h2>
            </div>
            <p>{tokens.length} 个记录</p>
          </div>

          {loading ? (
            <div className="token-list-state">正在加载访问令牌…</div>
          ) : tokens.length === 0 ? (
            <div className="token-list-state"><b>还没有访问令牌</b><span>创建后会在这里显示使用状态和审计时间</span></div>
          ) : (
            <div className="token-table-scroll">
              <table aria-label="访问令牌列表" className="token-table">
                <thead>
                  <tr>
                    <th>名称</th>
                    <th>Token 前缀</th>
                    <th>状态</th>
                    <th>最近使用</th>
                    <th>过期时间</th>
                    <th>创建时间</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {tokens.map((token) => {
                    const status = statusOf(token);
                    return (
                      <tr key={token.id}>
                        <td><b>{token.name}</b><span>{token.scopes.includes('diary:write') ? '读写' : '只读'}</span></td>
                        <td><code>{token.tokenPrefix}</code></td>
                        <td><span className={`token-status ${status}`}>{statusLabel(status)}</span></td>
                        <td>{formatDateTime(token.lastUsedAt, '从未使用')}</td>
                        <td>{formatDateTime(token.expiresAt, '永不过期')}</td>
                        <td>{formatDateTime(token.createdAt, '—')}</td>
                        <td>
                          {status === 'active' ? (
                            <button
                              type="button"
                              className="token-revoke-button"
                              aria-label={`撤销 ${token.name}`}
                              disabled={revokingId === token.id}
                              onClick={() => void revokeToken(token)}
                            >
                              <AppIcon icon={Trash2} name="revoke-token" size={15} />
                              {revokingId === token.id ? '撤销中…' : '撤销'}
                            </button>
                          ) : <span className="token-no-action">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>

      {created && <SecretDialog created={created} onClose={() => setCreated(null)} />}
    </div>
  );
}
