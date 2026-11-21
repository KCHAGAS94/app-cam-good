import {useCallback, useEffect, useState} from 'react'
import {api, fmtDate, type LogEntry} from '../api'

const PAGE = 100

/** Human labels for access_log actions (server + app). */
const ACTIONS: Record<string, string> = {
  setup: 'configurou o sistema',
  login: 'entrou',
  login_failed: 'errou a senha',
  password_changed: 'trocou a própria senha',
  camera_created: 'cadastrou câmera',
  camera_updated: 'alterou câmera',
  camera_deleted: 'removeu câmera',
  user_created: 'criou usuário',
  user_updated: 'alterou usuário',
  user_deleted: 'removeu usuário',
  upload_photo: 'enviou foto',
  upload_video: 'enviou vídeo',
  media_deleted: 'apagou arquivo',
  live_view: 'assistiu ao vivo',
  talk: 'falou pela câmera',
  playback: 'assistiu gravação do cartão',
}

export function HistoryTab() {
  const [log, setLog] = useState<LogEntry[]>([])
  const [hasMore, setHasMore] = useState(false)

  const load = useCallback(async (before?: number) => {
    const {log: page} = await api.log(before)
    setLog(prev => (before ? [...prev, ...page] : page))
    setHasMore(page.length === PAGE)
  }, [])

  useEffect(() => {
    load().catch(e => alert(e.message))
  }, [load])

  return (
    <div>
      <div className="row-head">
        <h2>Histórico</h2>
        <button className="ghost" onClick={() => load()}>
          Atualizar
        </button>
      </div>
      <table className="list history">
        <thead>
          <tr>
            <th>Quando</th>
            <th>Quem</th>
            <th>O quê</th>
            <th>Câmera</th>
            <th>IP</th>
          </tr>
        </thead>
        <tbody>
          {log.map(l => (
            <tr key={l.id}>
              <td>{fmtDate(l.created_at)}</td>
              <td>{l.user_name ?? '—'}</td>
              <td>
                {ACTIONS[l.action] ?? l.action}
                {l.action === 'login_failed' && typeof l.detail?.email === 'string' ? ` (${l.detail.email})` : ''}
              </td>
              <td>{l.camera_name ?? ''}</td>
              <td className="muted">{l.ip ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {hasMore && (
        <button className="ghost more" onClick={() => load(log[log.length - 1]?.id)}>
          Carregar mais
        </button>
      )}
    </div>
  )
}
