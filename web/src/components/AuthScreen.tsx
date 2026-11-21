import {useState, type FormEvent} from 'react'
import {api, type User} from '../api'

type Props = {mode: 'setup' | 'login'; onDone: (user: User) => void}

/** First-run "create admin" screen and the login screen share the same form. */
export function AuthScreen({mode, onDone}: Props) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>
    setBusy(true)
    setError('')
    try {
      const {user} =
        mode === 'setup'
          ? await api.setup({name: f.name, email: f.email, password: f.password})
          : await api.login({email: f.email, password: f.password})
      onDone(user)
    } catch (ex) {
      setError((ex as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="auth">
      <form className="card" onSubmit={submit}>
        <h1>CamGood</h1>
        {mode === 'setup' && <p className="muted">Primeiro acesso: crie a conta de administrador.</p>}
        {mode === 'setup' && (
          <label>
            Nome
            <input name="name" required autoComplete="name" />
          </label>
        )}
        <label>
          E-mail
          <input name="email" type="email" required autoComplete="email" />
        </label>
        <label>
          {mode === 'setup' ? 'Senha (mínimo 8 caracteres)' : 'Senha'}
          <input
            name="password"
            type="password"
            required
            minLength={mode === 'setup' ? 8 : undefined}
            autoComplete={mode === 'setup' ? 'new-password' : 'current-password'}
          />
        </label>
        <button className="primary" disabled={busy}>
          {mode === 'setup' ? 'Criar administrador' : 'Entrar'}
        </button>
        <p className="error">{error}</p>
      </form>
    </section>
  )
}
