import {useCallback, useEffect, useState, type FormEvent} from 'react'
import {api, type Camera, type ManagedUser, type Role, type User} from '../api'

type Props = {me: User; cameras: Camera[]}

export function UsersTab({me, cameras}: Props) {
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => setUsers((await api.users()).users), [])
  useEffect(() => {
    load().catch(e => alert(e.message))
  }, [load])

  async function update(id: number, body: Parameters<typeof api.updateUser>[1]) {
    try {
      await api.updateUser(id, body)
    } catch (e) {
      alert((e as Error).message)
    }
    await load()
  }

  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>
    setError('')
    try {
      await api.createUser({name: f.name, email: f.email, password: f.password, role: f.role as Role})
      setAdding(false)
      await load()
    } catch (ex) {
      setError((ex as Error).message)
    }
  }

  function toggleCamera(u: ManagedUser, cameraId: number, on: boolean) {
    const ids = on ? [...u.camera_ids, cameraId] : u.camera_ids.filter(id => id !== cameraId)
    update(u.id, {cameraIds: ids})
  }

  async function resetPassword(u: ManagedUser) {
    const pwd = prompt(`Nova senha para ${u.name} (mínimo 8 caracteres):`)
    if (pwd) await update(u.id, {password: pwd})
  }

  async function remove(u: ManagedUser) {
    if (!confirm(`Remover ${u.name}? A pessoa perde o acesso na hora.`)) return
    await api.deleteUser(u.id)
    await load()
  }

  return (
    <div>
      <div className="row-head">
        <h2>Usuários</h2>
        {!adding && (
          <button className="primary" onClick={() => setAdding(true)}>
            + Novo usuário
          </button>
        )}
      </div>

      {adding && (
        <form className="card" onSubmit={add}>
          <h3>Novo usuário</h3>
          <div className="grid">
            <label>
              Nome
              <input name="name" required autoFocus />
            </label>
            <label>
              E-mail
              <input name="email" type="email" required />
            </label>
            <label>
              Senha (mín. 8)
              <input name="password" type="password" minLength={8} required />
            </label>
            <label>
              Tipo
              <select name="role" defaultValue="user">
                <option value="user">Usuário</option>
                <option value="admin">Administrador</option>
              </select>
            </label>
          </div>
          <div className="actions">
            <button className="primary">Criar</button>
            <button type="button" className="ghost" onClick={() => setAdding(false)}>
              Cancelar
            </button>
          </div>
          <p className="error">{error}</p>
        </form>
      )}

      {users.map(u => {
        const isMe = u.id === me.id
        return (
          <div key={u.id} className="card user">
            <div className="user-head">
              <span className="name">{u.name}</span>
              <span className="muted">{u.email}</span>
              <span className={'badge' + (u.role === 'admin' ? ' admin' : '')}>
                {u.role === 'admin' ? 'administrador' : 'usuário'}
              </span>
              {!u.active && <span className="badge off">desativado</span>}
              <span className="spacer" />
              {!isMe && (
                <>
                  <button className="ghost" onClick={() => resetPassword(u)}>
                    Nova senha
                  </button>
                  <button className="ghost" onClick={() => update(u.id, {active: !u.active})}>
                    {u.active ? 'Desativar' : 'Reativar'}
                  </button>
                  <button className="danger" onClick={() => remove(u)}>
                    Remover
                  </button>
                </>
              )}
            </div>
            {u.role === 'admin' ? (
              <div className="muted note">Administradores acessam todas as câmeras.</div>
            ) : (
              <>
                <div className="muted note">Câmeras que pode acessar:</div>
                {cameras.length === 0 ? (
                  <span className="muted">nenhuma cadastrada</span>
                ) : (
                  <div className="cams">
                    {cameras.map(c => (
                      <label key={c.id}>
                        <input
                          type="checkbox"
                          checked={u.camera_ids.includes(c.id)}
                          onChange={e => toggleCamera(u, c.id, e.target.checked)}
                        />
                        {c.name}
                      </label>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
