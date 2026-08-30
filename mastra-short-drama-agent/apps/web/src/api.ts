export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
    ...init,
  });
  if (res.status === 401) {
    window.location.href = '/login';
    throw new ApiError(401, '未登录');
  }
  const data = (await res.json().catch(() => ({}))) as T & { message?: string; code?: string };
  if (!res.ok) throw new ApiError(res.status, data.message ?? `请求失败 (${res.status})`);
  return data;
}
