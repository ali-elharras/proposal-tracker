import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { DemoStoreProvider } from './demo/DemoStore.jsx'
import { ApiProvider } from './api/ApiProvider.jsx'
import { API_MODE } from './data/source.js'
import './styles/tokens.css'
import './styles/base.css'
import './styles/layout.css'
import './styles/components.css'
import './styles/dashboard.css'
import './styles/polish.css'
import './styles/v2.css'
import './styles/v3.css'

// API mode: everything comes from the backend (ApiProvider). The in-memory demo store stays mounted
// underneath for demo mode (VITE_DATA_SOURCE=demo), where it is the data source.
const app = (
  <DemoStoreProvider>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </DemoStoreProvider>
)

createRoot(document.getElementById('root')).render(
  <StrictMode>{API_MODE ? <ApiProvider>{app}</ApiProvider> : app}</StrictMode>,
)
