import {useCallback, useEffect, useState} from 'react'
import {api, fmtDate, fmtSize, type Camera, type Media, type User} from '../api'

type Props = {me: User; cameras: Camera[]}

const PAGE = 60

export function GalleryTab({me, cameras}: Props) {
  const [cameraId, setCameraId] = useState<number | undefined>()
  const [kind, setKind] = useState<'photo' | 'video' | undefined>()
  const [items, setItems] = useState<Media[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [open, setOpen] = useState<Media | null>(null)

  const load = useCallback(
    async (before?: number) => {
      const {media} = await api.media({cameraId, kind, before})
      setItems(prev => (before ? [...prev, ...media] : media))
      setHasMore(media.length === PAGE)
    },
    [cameraId, kind],
  )

  useEffect(() => {
    load().catch(e => alert(e.message))
  }, [load])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  async function remove(m: Media) {
    if (!confirm('Apagar este arquivo do servidor?')) return
    await api.deleteMedia(m.id)
    setOpen(null)
    await load()
  }

  return (
    <div>
      <div className="row-head">
        <h2>Galeria</h2>
        <select value={cameraId ?? ''} onChange={e => setCameraId(e.target.value ? Number(e.target.value) : undefined)}>
          <option value="">Todas as câmeras</option>
          {cameras.map(c => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select value={kind ?? ''} onChange={e => setKind((e.target.value || undefined) as typeof kind)}>
          <option value="">Fotos e vídeos</option>
          <option value="photo">Só fotos</option>
          <option value="video">Só vídeos</option>
        </select>
      </div>

      {items.length === 0 ? (
        <p className="muted empty">Nada por aqui ainda. As fotos e vídeos feitos no app aparecem aqui.</p>
      ) : (
        <div className="gallery">
          {items.map(m => (
            <div key={m.id} className="tile" onClick={() => setOpen(m)}>
              {m.kind === 'photo' ? (
                <img src={api.mediaUrl(m.id)} loading="lazy" alt="" />
              ) : (
                <div className="video-ph">▶</div>
              )}
              <div className="meta">
                {m.camera_name ?? ''} · {fmtDate(m.taken_at)}
              </div>
            </div>
          ))}
        </div>
      )}
      {hasMore && (
        <button className="ghost more" onClick={() => load(items[items.length - 1]?.id)}>
          Carregar mais
        </button>
      )}

      {open && (
        <div className="viewer">
          <div className="viewer-body">
            {open.kind === 'photo' ? (
              <img src={api.mediaUrl(open.id)} alt="" />
            ) : (
              <video src={api.mediaUrl(open.id)} controls autoPlay />
            )}
          </div>
          <div className="viewer-bar">
            <span className="muted">
              {open.camera_name ?? ''} · {fmtDate(open.taken_at)} · {fmtSize(open.size_bytes)}
              {open.user_name ? ` · por ${open.user_name}` : ''}
            </span>
            <span className="spacer" />
            <a className="ghost button" href={api.mediaUrl(open.id)} download>
              Baixar
            </a>
            {me.role === 'admin' && (
              <button className="danger" onClick={() => remove(open)}>
                Apagar
              </button>
            )}
            <button className="ghost" onClick={() => setOpen(null)}>
              Fechar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
