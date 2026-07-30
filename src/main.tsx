import ReactDOM from 'react-dom/client'
import './lib/md-editor-setup' // must run before any MdEditor/MdPreview mounts
import App from './App.tsx'
import './index.css'
import 'md-editor-rt/lib/style.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <App />
)
