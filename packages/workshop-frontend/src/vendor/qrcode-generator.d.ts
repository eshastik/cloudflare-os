// Типы только для того, что использует оболочка.
export interface QRCode {
  addData(data: string): void
  make(): void
  getModuleCount(): number
  isDark(row: number, col: number): boolean
}
export declare const qrcode: (typeNumber: number, errorCorrectionLevel: 'L' | 'M' | 'Q' | 'H') => QRCode
export default qrcode
