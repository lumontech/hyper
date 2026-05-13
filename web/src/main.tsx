import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// Workaround sicurezza Chrome:
// Quando la pagina è caricata con `https://user:pwd@host/`, document.baseURI mantiene
// le credentials e Chrome blocca ogni fetch() relativo con:
//   "Request cannot be constructed from a URL that includes credentials"
// history.replaceState cambia solo location.href, NON baseURI/document.URL.
// Unica soluzione: location.replace() su URL pulito → browser ricarica usando
// le credentials già in session cache → fetch poi funzionano.
if (window.location.href.includes('@')) {
  const cleanUrl = window.location.protocol + '//' + window.location.host
    + window.location.pathname + window.location.search + window.location.hash
  window.location.replace(cleanUrl)
  // Stop bootstrap: il browser sta ricaricando.
} else {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
}
