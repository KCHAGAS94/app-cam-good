import {useState, type FormEvent} from 'react'
import {api, type Camera, type User} from '../api'

type Props = {me: User; cameras: Camera[]; reload: () => Promise<void>}

export function CamerasTab({me, cameras, reload}: Props) {
  const isAdmin = me.role === 'admin'
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')
  const [shown, setShown] = useState<Record<number, boolean>>({})

  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>
    setError('')
    try {
      await api.createCamera({did: f.did, name: f.name, pwd: f.pwd})
      setAdding(false)
      await reload()
    } catch (ex) {
      setError((ex as Error).message)
    }
  }

  async function edit(c: Camera) {
    const name = prompt('Nome da câmera:', c.name)
    if (name === null) return
    const pwd = prompt('Senha da câmera (deixe em branco para manter):', '')
    if (pwd === null) return
    await api.updateCamera(c.id, {name, ...(pwd ? {pwd} : {})})
    await reload()
  }

  async function remove(c: Camera) {
    if (!confirm(`Remover "${c.name}" do sistema? As fotos e vídeos já salvos continuam na galeria.`)) return
    await api.deleteCamera(c.id)
    await reload()
  }

  return (
    <div>
      <div className="row-head">
        <h2>Câmeras</h2>
        {isAdmin && !adding && (
          <button className="primary" onClick={() => setAdding(true)}>
            + Cadastrar câmera
          </button>
        )}
      </div>

      {adding && (
        <form className="card" onSubmit={add}>
          <h3>Nova câmera</h3>
          <div className="grid">
            <label>
              Nome
              <input name="name" required placeholder="Câmera Mãe" autoFocus />
            </label>
            <label>
              ID da câmera
              <input name="did" required placeholder="PIXB-..." />
            </label>
            <label>
              Senha da câmera
              <input name="pwd" required />
            </label>
          </div>
          <div className="actions">
            <button className="primary">Salvar</button>
            <button type="button" className="ghost" onClick={() => setAdding(false)}>
              Cancelar
            </button>
          </div>
          <p className="error">{error}</p>
        </form>
      )}

      {cameras.length === 0 ? (
        <p className="muted empty">Nenhuma câmera ainda.</p>
      ) : (
        <table className="list">
          <thead>
            <tr>
              <th>Nome</th>
              <th>ID</th>
              <th>Senha</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {cameras.map(c => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td>
                  <code>{c.did}</code>
                </td>
                <td>
                  <code>{shown[c.id] ? c.pwd : '••••••'}</code>{' '}
                  <button className="ghost" onClick={() => setShown(s => ({...s, [c.id]: !s[c.id]}))}>
                    {shown[c.id] ? 'Ocultar' : 'Ver'}
                  </button>
                </td>
                <td>
                  {isAdmin && (
                    <>
                      <button className="ghost" onClick={() => edit(c)}>
                        Editar
                      </button>{' '}
                      <button className="danger" onClick={() => remove(c)}>
                        Remover
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
