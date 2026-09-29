import { describe, expect, it } from 'vitest'
import { attachmentBudgetBytes, attachmentDownloadName, isOfficeAttachment } from './chatAttachmentFiles'

describe('вложения беседы: документы Office', () => {
  it('опознаются по MIME, а при пустом или общем типе — по расширению', () => {
    expect(isOfficeAttachment('Отчёт.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe(true)
    expect(isOfficeAttachment('Продажи.XLSX', '')).toBe(true)
    expect(isOfficeAttachment('План.pptx', 'application/octet-stream')).toBe(true)
    expect(isOfficeAttachment('old.doc', 'application/msword')).toBe(false)
    expect(isOfficeAttachment('notes.txt', 'text/plain')).toBe(false)
  })

  it('в общий объём документ идёт не больше своего текста', () => {
    expect(attachmentBudgetBytes(10 * 1024 * 1024, 'a.docx', '')).toBe(1024 * 1024)
    expect(attachmentBudgetBytes(10 * 1024 * 1024, 'a.pdf', 'application/pdf')).toBe(10 * 1024 * 1024)
  })

  it('извлечённый текст скачивается как .txt', () => {
    expect(attachmentDownloadName('Отчёт.docx', 'text/plain')).toBe('Отчёт.docx.txt')
    expect(attachmentDownloadName('Отчёт.pdf', 'application/pdf')).toBe('Отчёт.pdf')
    expect(attachmentDownloadName(undefined, 'text/plain')).toBe('attachment')
  })
})
