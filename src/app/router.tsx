import { createBrowserRouter, Navigate } from 'react-router-dom'
import { AppLayout } from '../components/AppLayout'
import { HistoriePage } from '../pages/HistoriePage'
import { MonatPage } from '../pages/MonatPage'
import { WochenblattPage } from '../pages/WochenblattPage'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      {
        index: true,
        element: <WochenblattPage />,
      },
      {
        path: 'month',
        element: <MonatPage />,
      },
      {
        path: 'history',
        element: <HistoriePage />,
      },
      {
        path: 'historie',
        element: <Navigate to="/history" replace />,
      },
    ],
  },
])
