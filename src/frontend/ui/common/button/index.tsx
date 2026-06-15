import React, { MouseEventHandler } from 'react'

import buttonStyle from './btn.module.css'

type ButtonProps = {
  className?: string
  children: JSX.Element
  onClick?: MouseEventHandler<HTMLButtonElement>
  isPrimary?: boolean
  disabled?: boolean
  style?: Record<string, unknown>
}
type ButtonComponent = (arg0: ButtonProps) => JSX.Element

const Button: ButtonComponent = ({
  className = '',
  children,
  onClick = undefined,
  isPrimary = false,
  disabled = false,
  style = {},
}) => (
  <button
    className={`${buttonStyle.btn} ${
      isPrimary ? buttonStyle.primary : buttonStyle.secondary
    } ${className}`}
    onClick={onClick}
    style={style}
    disabled={disabled}
  >
    {children}
  </button>
)

export default Button
