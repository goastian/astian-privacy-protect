import React from 'react'

import style from './favicon.module.css'

const toCssImageUrl = (icon: string): string => {
  const trimmedIcon = icon.trim()
  if (trimmedIcon.startsWith('<')) {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(trimmedIcon)}`
  }

  return icon
}

const Favicon = ({ icon }: { icon: string }): JSX.Element => {
  return (
    <div className={style.favicon}>
      <i style={{ backgroundImage: `url("${toCssImageUrl(icon)}")` }}></i>
    </div>
  )
}

export default Favicon
