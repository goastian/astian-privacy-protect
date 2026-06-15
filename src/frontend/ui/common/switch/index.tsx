import React from 'react'

import switchStyle from './switch.module.css'

export const Switch = ({
  state,
  checkedColour,
  onChange,
  backgroundColor,
}: {
  state: boolean
  checkedColour: string
  onChange: (state: boolean) => void
  backgroundColor?: string
}): JSX.Element => {
  const onSChange = () => {
    onChange(state)
  }

  return (
    <div
      className={switchStyle.parent}
      onClick={() => onSChange()}
      style={{ backgroundColor: backgroundColor || 'white' }}
    >
      <i
        style={{ backgroundColor: state ? checkedColour : '' }}
        className={`${switchStyle.switchCircle} ${
          state == true ? switchStyle.switchCircleChecked : ''
        }`}
      ></i>
    </div>
  )
}
