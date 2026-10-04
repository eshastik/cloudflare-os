import type {ChatWorkTemplate} from '@gadgets/workshop-shared/work-template'

/** Одно явное добавление сохранённой версии в композер указанной беседы, без отправки сообщения. */
export type ChatTemplateSeed={id:string;chatId:number|null;template:ChatWorkTemplate}
