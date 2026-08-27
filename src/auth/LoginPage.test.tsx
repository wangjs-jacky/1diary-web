import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseAuth = vi.hoisted(() => ({
  getSession: vi.fn(async () => ({ data: { session: null } })),
  onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
  signInWithPassword: vi.fn(),
  signUp: vi.fn(async (): Promise<{
    data: { session: null };
    error: null | { message: string; code: string };
  }> => ({ data: { session: null }, error: null })),
  signOut: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ auth: supabaseAuth })),
}));

describe('LoginPage', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'public-anon-key');
    vi.clearAllMocks();
    supabaseAuth.getSession.mockResolvedValue({ data: { session: null } });
    supabaseAuth.signUp.mockResolvedValue({ data: { session: null }, error: null });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
  });

  it('lets a new reader create an account and explains email confirmation', async () => {
    const user = userEvent.setup();
    const { AuthProvider } = await import('./AuthContext');
    const { LoginPage } = await import('./LoginPage');
    render(<AuthProvider><LoginPage /></AuthProvider>);

    await waitFor(() => expect(screen.getByRole('heading', { name: '一本日记' })).toBeVisible());
    await user.click(screen.getByRole('button', { name: '创建账号' }));
    await user.type(screen.getByLabelText('邮箱'), 'new-reader@example.com');
    await user.type(screen.getByLabelText('密码', { exact: true }), 'journal-pass-2026');
    await user.type(screen.getByLabelText('确认密码', { exact: true }), 'journal-pass-2026');
    await user.click(screen.getByRole('button', { name: '创建并开始记录' }));

    await waitFor(() => {
      expect(supabaseAuth.signUp).toHaveBeenCalledWith({
        email: 'new-reader@example.com',
        password: 'journal-pass-2026',
        options: { emailRedirectTo: window.location.origin },
      });
    });
    expect(screen.getByRole('status')).toHaveTextContent('注册成功，请检查邮箱完成验证');
  }, 15_000);

  it('explains when the confirmation email is temporarily rate limited', async () => {
    supabaseAuth.signUp.mockResolvedValueOnce({
      data: { session: null },
      error: { message: 'email rate limit exceeded', code: 'over_email_send_rate_limit' },
    });
    const user = userEvent.setup();
    const { AuthProvider } = await import('./AuthContext');
    const { LoginPage } = await import('./LoginPage');
    render(<AuthProvider><LoginPage /></AuthProvider>);

    await user.click(await screen.findByRole('button', { name: '创建账号' }));
    await user.type(screen.getByLabelText('邮箱'), 'limited-reader@example.com');
    await user.type(screen.getByLabelText('密码', { exact: true }), 'journal-pass-2026');
    await user.type(screen.getByLabelText('确认密码', { exact: true }), 'journal-pass-2026');
    await user.click(screen.getByRole('button', { name: '创建并开始记录' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('验证邮件发送过于频繁，请稍后再试');
  }, 15_000);
});
