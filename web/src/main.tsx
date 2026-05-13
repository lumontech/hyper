import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// Workaround: Chrome blocca fetch() su URL con credentials inline (user:pwd@host).
// Se la pagina è caricata via URL con credentials, le rimuoviamo dal pathname
// preservando la session auth basic memorizzata da Chrome.
if (window.location.href.includes('@')) {
  const cleanUrl = window.location.protocol + '//' + window.location.host + window.location.pathname + window.location.search + window.location.hash
  window.history.replaceState(null, '', cleanUrl)
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
