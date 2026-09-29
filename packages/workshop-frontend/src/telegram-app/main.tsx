import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/onest'
import '@fontsource-variable/literata'
import './mini-app.css'
import MiniApp, { type TelegramWebApp } from './MiniApp'

const webApp = (window as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp ?? null
const token = new URLSearchParams(window.location.search).get('t')
// Токен уже прочитан: из адреса он уходит, чтобы не остаться в истории окна.
if (token) history.replaceState(null, '', window.location.pathname)
if (webApp?.colorScheme) document.documentElement.dataset.theme = webApp.colorScheme

createRoot(document.getElementById('mini-app')!).render(
  <StrictMode><MiniApp webApp={webApp} token={token} /></StrictMode>,
)
