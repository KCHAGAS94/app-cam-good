// Typed client for the CamGood server API. The web panel uses the httpOnly session cookie.

export type Role = 'admin' | 'user'

export type User = {id: number; name: string; email: string; role: Role}

export type Camera = {id: number; did: string; name: string; user: string; pwd: string}

export type ManagedUser = User & {active: boolean; created_at: string; camera_ids: number[]}

export type Media = {
  id: number
  kind: 'photo' | 'video'
  mime: string
  size_bytes: number
  duration_ms: number | null
  taken_at: string
  camera_id: number | null
  camera_name: string | null
  user_name: string | null
}

export type LogEntry = {
  id: number
  action: string
  detail: Record<string, unknown> | null
  ip: string | null
  created_at: string
  user_name: string | null
  camera_name: string | null
}

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

/** Called when the session expires so the app can show the login screen. */
let onUnauthorized: () => void = () => {}
export const setUnauthorizedHandler = (fn: () => void) => {
  onUnauthorized = fn
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch('/api' + url, {
    method,
    headers: body !== undefined ? {'Content-Type': 'application/json'} : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  })
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null
  if (res.status === 401 && url !== '/login' && url !== '/me') {
    onUnauthorized()
  }
  if (!res.ok) {
    throw new ApiError(data?.error ?? `Erro ${res.status}`, res.status)
  }
  return data as T
}

export const api = {
  needsSetup: () => request<{needsSetup: boolean}>('GET', '/setup'),
  setup: (b: {name: string; email: string; password: string}) => request<{user: User}>('POST', '/setup', b),
  login: (b: {email: string; password: string}) => request<{user: User}>('POST', '/login', b),
  logout: () => request<{ok: true}>('POST', '/logout'),
  me: () => request<{user: User}>('GET', '/me'),

  cameras: () => request<{cameras: Camera[]}>('GET', '/cameras'),
  createCamera: (b: {did: string; name: string; pwd: string}) => request<{id: number}>('POST', '/cameras', b),
  updateCamera: (id: number, b: {name?: string; pwd?: string}) => request('PUT', `/cameras/${id}`, b),
  deleteCamera: (id: number) => request('DELETE', `/cameras/${id}`),

  users: () => request<{users: ManagedUser[]}>('GET', '/users'),
  createUser: (b: {name: string; email: string; password: string; role: Role}) => request('POST', '/users', b),
  updateUser: (id: number, b: Partial<{name: string; role: Role; active: boolean; password: string; cameraIds: number[]}>) =>
    request('PUT', `/users/${id}`, b),
  deleteUser: (id: number) => request('DELETE', `/users/${id}`),

  media: (q: {cameraId?: number; kind?: 'photo' | 'video'; before?: number}) => {
    const p = new URLSearchParams()
    if (q.cameraId) p.set('cameraId', String(q.cameraId))
    if (q.kind) p.set('kind', q.kind)
    if (q.before) p.set('before', String(q.before))
    return request<{media: Media[]}>('GET', `/media?${p}`)
  },
  deleteMedia: (id: number) => request('DELETE', `/media/${id}`),
  mediaUrl: (id: number) => `/api/media/${id}/file`,

  log: (before?: number) => request<{log: LogEntry[]}>('GET', '/log' + (before ? `?before=${before}` : '')),
}

export const fmtDate = (d: string) => new Date(d).toLocaleString('pt-BR', {dateStyle: 'short', timeStyle: 'short'})
export const fmtSize = (b: number) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.ceil(b / 1024)} KB`)
