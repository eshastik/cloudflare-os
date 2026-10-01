import { describe, expect, it } from 'vitest'
import { attachmentDownloadName, chatDocumentContentType, chatDocumentPlaceLabel } from './chatAttachmentFiles'

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'

describe('вложения беседы: какой файл — документ', () => {
  it('опознаёт документы по MIME', () => {
    expect(chatDocumentContentType('application/pdf', 'a.pdf')).toBe('application/pdf')
    expect(chatDocumentContentType(DOCX, 'Отчёт.docx')).toBe(DOCX)
    expect(chatDocumentContentType('text/plain; charset=utf-8', 'a.txt')).toBe('text/plain')
  })

  it('при пустом или общем типе смотрит на расширение, как сервер', () => {
    expect(chatDocumentContentType('', 'Большой отчёт.PDF')).toBe('application/pdf')
    expect(chatDocumentContentType('application/octet-stream', 'Большой отчёт.pdf')).toBe('application/pdf')
    expect(chatDocumentContentType('', 'Продажи.XLSX')).toBe(XLSX)
    expect(chatDocumentContentType('application/zip', 'План.pptx')).toBe(PPTX)
    expect(chatDocumentContentType('application/octet-stream', 'Отчёт.docx')).toBe(DOCX)
    expect(chatDocumentContentType('', 'README.md')).toBe('text/markdown')
    expect(chatDocumentContentType('application/vnd.ms-excel', 'data.csv')).toBe('text/csv')
    expect(chatDocumentContentType('text/json', 'conf.json')).toBe('application/json')
  })

  it('картинки, код и старые форматы — не документы', () => {
    expect(chatDocumentContentType('image/png', 'a.png')).toBeUndefined()
    expect(chatDocumentContentType('image/png', 'обманка.pdf')).toBeUndefined()
    expect(chatDocumentContentType('application/msword', 'old.doc')).toBeUndefined()
    expect(chatDocumentContentType('text/javascript', 'app.js')).toBeUndefined()

  })

  it('пометка называет место документа', () => {
    expect(chatDocumentPlaceLabel({ personal: true, projectTitle: 'x' })).toBe('Сохранено в личное пространство')
    expect(chatDocumentPlaceLabel({ personal: false, projectTitle: 'Продажи' })).toBe('Сохранено в проект «Продажи» — личная версия')
  })

  it('старый документ Office (извлечённый текст) скачивается как .txt', () => {
    expect(attachmentDownloadName('Отчёт.docx', 'text/plain')).toBe('Отчёт.docx.txt')
    expect(attachmentDownloadName('Отчёт.pdf', 'application/pdf')).toBe('Отчёт.pdf')
    expect(attachmentDownloadName(undefined, 'text/plain')).toBe('attachment')
  })
})

describe("ZIP как документ Mnemos", () => {
  it("нормализует тип ZIP и общий тип с расширением, сохраняя Office", () => {
    for (const [mime, name] of [["application/zip", "архив.zip"], ["application/x-zip-compressed", "архив.ZIP"], ["", "архив.zip"], ["application/octet-stream", "архив.zip"], ["application/zip; charset=binary", "выгрузка"]]) {
      expect(chatDocumentContentType(mime, name)).toBe("application/zip");
    }
    expect(chatDocumentContentType("application/zip", "Отчёт.docx")).toBe(DOCX);
    expect(chatDocumentContentType("image/png", "обманка.zip")).toBeUndefined();
  });
});
