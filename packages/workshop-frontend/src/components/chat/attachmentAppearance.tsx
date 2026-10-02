import { File, FilePdf, FileDoc, FileXls, FilePpt, FileZip, FileCode, FileText, FileImage, FileAudio, FileVideo, EnvelopeSimple, TextAa, Database, Cube, type Icon } from "@phosphor-icons/react";

type Appearance = { icon: Icon; label: string; color: string };
const TYPES = {
  pdf: { icon: FilePdf, label: "PDF", color: "#dc5263" },
  document: { icon: FileDoc, label: "Документ", color: "#5285db" },
  sheet: { icon: FileXls, label: "Таблица", color: "#399b79" },
  slides: { icon: FilePpt, label: "Презентация", color: "#da8650" },
  archive: { icon: FileZip, label: "Архив", color: "#ac8550" },
  code: { icon: FileCode, label: "Код", color: "#8d75d1" },
  text: { icon: FileText, label: "Текст", color: "#7287a2" },
  image: { icon: FileImage, label: "Изображение", color: "#ad73bb" },
  audio: { icon: FileAudio, label: "Аудио", color: "#b976a1" },
  video: { icon: FileVideo, label: "Видео", color: "#9674d1" },
  email: { icon: EnvelopeSimple, label: "Письмо", color: "#648eae" },
  font: { icon: TextAa, label: "Шрифт", color: "#987887" },
  database: { icon: Database, label: "База данных", color: "#568f99" },
  model: { icon: Cube, label: "3D-модель", color: "#659a8b" },
  other: { icon: File, label: "Файл", color: "#8290a1" },
} satisfies Record<string, Appearance>;
const EXTENSIONS: Partial<Record<string, keyof typeof TYPES>> = {};
for (const [type, extensions] of Object.entries({
  pdf: "pdf", document: "doc docx odt rtf pages", sheet: "xls xlsx xlsm ods csv tsv numbers", slides: "ppt pptx odp key",
  archive: "zip rar 7z tar gz bz2 xz tgz zst", code: "js jsx ts tsx py go rs java c cpp h hpp cs rb php sh bash zsh ps1 html css scss json yaml yml xml toml sql ipynb",
  text: "txt md markdown log tex", image: "png jpg jpeg gif webp svg avif heic bmp tiff tif ico psd ai eps",
  audio: "mp3 wav ogg m4a flac aac opus aiff", video: "mp4 mov webm avi mkv m4v wmv", email: "eml msg mbox",
  font: "ttf otf woff woff2", database: "db sqlite sqlite3", model: "obj stl gltf glb fbx blend step stp",
})) for (const extension of extensions.split(" ")) EXTENSIONS[extension] = type as keyof typeof TYPES;

export function attachmentAppearance(name?: string, mimeType = "") {
  const extension = /\.([a-z0-9]+)$/i.exec(name ?? "")?.[1]?.toLowerCase();
  const mime = mimeType.split(";", 1)[0].trim().toLowerCase();
  const type = extension && Object.hasOwn(EXTENSIONS, extension) && EXTENSIONS[extension] || (
    mime === "application/pdf" ? "pdf" : mime.startsWith("image/") ? "image" :
    mime.startsWith("audio/") ? "audio" : mime.startsWith("video/") ? "video" :
    /zip|compressed|archive|tar/.test(mime) ? "archive" : /spreadsheet|excel|csv/.test(mime) ? "sheet" :
    /presentation|powerpoint/.test(mime) ? "slides" : /word|opendocument.text|rtf/.test(mime) ? "document" :
    /json|javascript|xml/.test(mime) ? "code" : mime.startsWith("text/") ? "text" :
    mime.startsWith("font/") ? "font" : mime === "message/rfc822" ? "email" : "other");
  return { ...TYPES[type], extension: extension?.toUpperCase() };
}

export function AttachmentFileIcon({ name, mimeType, size = 26 }: { name?: string; mimeType?: string; size?: number }) {
  const { icon: Glyph, color } = attachmentAppearance(name, mimeType);
  return <span aria-hidden="true" className="grid h-12 w-12 shrink-0 place-items-center rounded-xl" style={{ color, backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)` }}><Glyph size={size} weight="duotone" /></span>;
}
