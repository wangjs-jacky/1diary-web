import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setTokenProvider } from '../data/api';
import { TokenPage } from './TokenPage';

const activeToken = {
  id: '11111111-1111-4111-8111-111111111111',
  tokenPrefix: '1diary_pat_11111111…',
  name: 'Codex on Mac mini',
  scopes: ['diary:read', 'diary:write'],
  expiresAt: '2099-08-27T00:00:00.000Z',
  lastUsedAt: '2026-08-26T08:30:00.000Z',
  createdAt: '2026-08-20T02:00:00.000Z',
  revokedAt: null,
};

const expiredToken = {
  id: '22222222-2222-4222-8222-222222222222',
  tokenPrefix: '1diary_pat_22222222…',
  name: '旧脚本',
  scopes: ['diary:read'],
  expiresAt: '2020-01-01T00:00:00.000Z',
  lastUsedAt: null,
  createdAt: '2019-12-01T00:00:00.000Z',
  revokedAt: null,
};

describe('TokenPage', () => {
  beforeEach(() => {
    setTokenProvider(async () => 'signed-user-jwt');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify([activeToken, expiredToken]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows the create form above a token audit table', async () => {
    render(<MemoryRouter><TokenPage /></MemoryRouter>);

    expect(screen.getByRole('heading', { name: '访问令牌' })).toBeVisible();
    expect(screen.getByRole('button', { name: '创建 Token' })).toBeVisible();

    const table = await screen.findByRole('table', { name: '访问令牌列表' });
    for (const heading of ['名称', 'Token 前缀', '状态', '最近使用', '过期时间', '创建时间', '操作']) {
      expect(within(table).getByRole('columnheader', { name: heading })).toBeVisible();
    }
    expect(within(table).getByText('1diary_pat_11111111…')).toBeVisible();
    expect(within(table).getByText('有效')).toBeVisible();
    expect(within(table).getByText('已过期')).toBeVisible();
    expect(within(table).getByText('读写')).toBeVisible();
    expect(within(table).getByText('只读')).toBeVisible();
  });

  it('creates a token and reveals its secret exactly once', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ...activeToken,
            token: '1diary_pat_11111111-1111-4111-8111-111111111111.private-secret',
          }),
          { status: 201, headers: { 'content-type': 'application/json' } },
        ),
      );

    render(<MemoryRouter><TokenPage /></MemoryRouter>);
    await screen.findByText('还没有访问令牌');
    await user.type(screen.getByLabelText('名称'), 'Codex on Mac mini');
    await user.selectOptions(screen.getByLabelText('权限'), 'read-write');
    await user.click(screen.getByRole('button', { name: '创建 Token' }));

    const dialog = await screen.findByRole('dialog', { name: '保存访问令牌' });
    expect(within(dialog).queryByText(/private-secret/)).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: '显示 Token' }));
    expect(within(dialog).getByText(/private-secret/)).toBeVisible();
    await user.click(dialog.parentElement!);
    expect(dialog).toBeVisible();
    expect(screen.getByText('Codex on Mac mini')).toBeVisible();

    const createRequest = fetchMock.mock.calls[1];
    expect(createRequest?.[0]).toBe('/v1/pats');
    expect(createRequest?.[1]).toMatchObject({ method: 'POST' });
    expect(JSON.parse(String(createRequest?.[1]?.body))).toMatchObject({
      name: 'Codex on Mac mini',
      scopes: ['diary:read', 'diary:write'],
    });
  });

  it('revokes an active token after confirmation', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify([activeToken]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    render(<MemoryRouter><TokenPage /></MemoryRouter>);
    await user.click(await screen.findByRole('button', { name: '撤销 Codex on Mac mini' }));

    expect(fetchMock.mock.calls[1]?.[0]).toBe(`/v1/pats/${activeToken.id}`);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: 'DELETE' });
    expect(await screen.findByText('已撤销')).toBeVisible();
    expect(screen.queryByRole('button', { name: '撤销 Codex on Mac mini' })).not.toBeInTheDocument();
  });
});
