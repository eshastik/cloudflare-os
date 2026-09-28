import { useMemo } from 'react'
import qrcode from '../vendor/qrcode-generator.js'

/** Путь SVG из тёмных модулей QR: одна фигура вместо сотен прямоугольников. */
export function qrPath(text: string): { size: number; path: string } {
  const code = qrcode(0, 'M')
  code.addData(text)
  code.make()
  const size = code.getModuleCount()
  let path = ''
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (code.isDark(row, col)) path += `M${col} ${row}h1v1h-1z`
    }
  }
  return { size, path }
}

/**
 * QR всегда чёрный на белом в любой теме: сканеры телефонов хуже читают светлые модули на тёмном.
 * Поле в 4 модуля — минимум, который требует стандарт.
 */
export function QrCode({ value, label, className = '' }: { value: string; label: string; className?: string }) {
  const { size, path } = useMemo(() => qrPath(value), [value])
  const quiet = 4
  const box = size + quiet * 2
  return (
    <svg role="img" aria-label={label} viewBox={`${-quiet} ${-quiet} ${box} ${box}`} shapeRendering="crispEdges"
      className={`block rounded-lg bg-white ${className}`}>
      <rect x={-quiet} y={-quiet} width={box} height={box} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  )
}
