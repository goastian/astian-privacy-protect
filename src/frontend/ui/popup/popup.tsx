import { createRoot } from 'react-dom/client'
import { State } from './state'

import '../common/common.css'

const root = document.getElementById('root')

if (root) {
  createRoot(root).render(<State />)
}
