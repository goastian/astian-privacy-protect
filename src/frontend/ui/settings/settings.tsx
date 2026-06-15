/// <reference types="web-ext-types"/>

import { createRoot } from 'react-dom/client'
import SettingsApp from './app'

import '../common/common.css'

const root = document.getElementById('root')

if (root) {
  createRoot(root).render(<SettingsApp />)
}
