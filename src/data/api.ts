import { config } from '../lib/config';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type TokenProvider = () => Promise<string | null>;
let tokenProvider: TokenProvider = async () => null;

export function setTokenProvider(provider: TokenProvider) {
  tokenProvider = provider;
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
  extraHeaders: Record<string, string> = {},
): Promise<T> {
  const token = await tokenProvider();
  if (!token) throw new ApiError(401, 'AUTH_REQUIRED', '请先登录');
  const response = await fetch(`${config.apiUrl}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...extraHeaders,
      ...init.headers,
    },
  });
  if (response.status === 204) return undefined as T;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const body = payload as { code?: string; message?: string };
    throw new ApiError(
      response.status,
      body.code || 'REQUEST_FAILED',
      body.message || `请求失败（${response.status}）`,
    );
  }
  return payload as T;
}

export async function uploadPresigned(
  url: string,
  fields: Record<string, string>,
  blob: Blob,
) {
  const form = new FormData();
  Object.entries(fields).forEach(([key, value]) => form.append(key, value));
  form.append('file', blob);
  const response = await fetch(url, { method: 'POST', body: form });
  if (!response.ok) throw new ApiError(response.status, 'UPLOAD_FAILED', '图片上传失败');
}
