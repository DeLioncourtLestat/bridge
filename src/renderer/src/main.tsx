import { createRoot } from 'react-dom/client'
import '@xterm/xterm/css/xterm.css'
import './styles.css'
import { App } from './App'

if (window.bridge.platform === 'darwin') document.body.classList.add('mac')
createRoot(document.getElementById('root')!).render(<App />)
