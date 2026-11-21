import {useCallback, useEffect, useState} from 'react'
import {api, setUnauthorizedHandler, type Camera, type User} from './api'
import {AuthScreen} from './components/AuthScreen'
import {CamerasTab} from './components/CamerasTab'
import {GalleryTab} from './components/GalleryTab'
import {HistoryTab} from './components/HistoryTab'
import {UsersTab} from './components/UsersTab'

type Screen = 'loading' | 'setup' | 'login' | 'main'
type Tab = 'cameras' | 'gallery' | 'users' | 'history'

const TABS: {id: Tab; label: string; adminOnly?: boolean}[] = [
  {id: 'cameras', label: 'Câmeras'},
  {id: 'gallery', label: 'Galeria'},
  {id: 'users', label: 'Usuários', adminOnly: true},
  {id: 'history', label: 'Histórico', adminOnly: true},
]

export default function App() {
  const [screen, setScreen] = useState<Screen>('loading')
  const [me, setMe] = useState<User | null>(null)
  const [tab, setTab] = useState<Tab>('cameras')
  const [cameras, setCameras] = useState<Camera[]>([])

  const loadCameras = useCallback(async () => setCameras((await api.cameras()).cameras), [])

  // decide the first screen: setup (no users yet), login, or the panel
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setMe(null)
      setScreen('login')
    })
    ;(async () => {
      const {needsSetup} = await api.needsSetup()
      if (needsSetup) return setScreen('setup')
      try {
        setMe((await api.me()).user)
        setScreen('main')
      } catch {
        setScreen('login')
      }
    })().catch(() => setScreen('login'))
  }, [])

  useEffect(() => {
    if (screen === 'main') loadCameras().catch(e => alert(e.message))
  }, [screen, loadCameras])

  const enter = (user: User) => {
    setMe(user)
    setTab('cameras')
    setScreen('main')
  }

  const logout = async () => {
    await api.logout()
    setMe(null)
    setScreen('login')
  }

  if (screen === 'loading') return null
  if (screen === 'setup' || screen === 'login' || !me) return <AuthScreen mode={screen === 'setup' ? 'setup' : 'login'} onDone={enter} />

  const isAdmin = me.role === 'admin'

  return (
    <>
      <header className="topbar">
        <strong>CamGood</strong>
        <nav className="tabs">
          {TABS.filter(t => !t.adminOnly || isAdmin).map(t => (
            <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
        <span className="spacer" />
        <span className="muted">
          {me.name}
          {isAdmin ? ' (admin)' : ''}
        </span>
        <button className="ghost" onClick={logout}>
          Sair
        </button>
      </header>
      <main>
        {tab === 'cameras' && <CamerasTab me={me} cameras={cameras} reload={loadCameras} />}
        {tab === 'gallery' && <GalleryTab me={me} cameras={cameras} />}
        {tab === 'users' && isAdmin && <UsersTab me={me} cameras={cameras} />}
        {tab === 'history' && isAdmin && <HistoryTab />}
      </main>
    </>
  )
}
