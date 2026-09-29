import { createRoot } from 'react-dom/client'
import '@fontsource-variable/onest'
import '@fontsource-variable/literata'
import './mini-app.css'
import MiniApp from './MiniApp'
import { applyTelegramTheme, type TelegramWebApp } from './telegram'

const webApp = (window as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp ?? null
const token = new URLSearchParams(window.location.search).get('t')
// Токен уже прочитан: из адреса он уходит, чтобы не остаться в истории окна.
if (token) history.replaceState(null, '', window.location.pathname)
applyTelegramTheme(webApp, null)

createRoot(document.getElementById('mini-app')!).render(
  // Без StrictMode: двойной запуск эффектов в разработке закрыл бы сессию Mini App (закрытие связи
  // удаляет её на сервере), а второй раз её не получить — токен кнопки одноразовый.
  <MiniApp webApp={webApp} token={token} />,
)
