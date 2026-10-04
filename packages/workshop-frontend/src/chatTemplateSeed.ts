import type {ChatWorkTemplate} from '@gadgets/workshop-shared/work-template'

/** Одно явное добавление точных версий в композер указанной беседы, без отправки сообщения. */
export type ChatTemplateSeed={id:string;chatId:number|null;templates:ChatWorkTemplate[]}
