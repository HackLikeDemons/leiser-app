import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'

const links = [
  { to: '/', label: 'Wochenblatt' },
  { to: '/history', label: 'Historie' },
]

export function AppLayout() {
  const [isDarkTheme, setIsDarkTheme] = useState(false)

  useEffect(() => {
    const savedTheme = localStorage.getItem('leiser-theme')
    const prefersDarkTheme = window.matchMedia('(prefers-color-scheme: dark)').matches
    const shouldUseDark = savedTheme ? savedTheme === 'dark' : prefersDarkTheme

    setIsDarkTheme(shouldUseDark)
    document.documentElement.dataset.theme = shouldUseDark ? 'dark' : 'light'
  }, [])

  const handleThemeToggle = () => {
    setIsDarkTheme((prev) => {
      const nextIsDark = !prev
      document.documentElement.dataset.theme = nextIsDark ? 'dark' : 'light'
      localStorage.setItem('leiser-theme', nextIsDark ? 'dark' : 'light')
      return nextIsDark
    })
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-row">
          <h1>Leiser</h1>
          <button type="button" className="theme-toggle" onClick={handleThemeToggle}>
            {isDarkTheme ? 'Helles Theme' : 'Dunkles Theme'}
          </button>
        </div>
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
