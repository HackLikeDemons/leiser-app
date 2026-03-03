import { NavLink, Outlet } from 'react-router-dom'

const links = [
  { to: '/', label: 'Wochenblatt' },
  { to: '/history', label: 'Historie' },
]

export function AppLayout() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>Leiser</h1>
        <p>Ruhig, fokussiert und komplett lokal.</p>
      </header>

      <nav className="app-nav" aria-label="Hauptnavigation">
        {links.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.to === '/'}
            className={({ isActive }) => (isActive ? 'nav-link nav-link--active' : 'nav-link')}
          >
            {link.label}
          </NavLink>
        ))}
      </nav>

      <main className="app-main">
        <Outlet />
      </main>
    </div>
  )
}
