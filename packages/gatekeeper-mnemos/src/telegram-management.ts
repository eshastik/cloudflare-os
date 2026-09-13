import type {TelegramDeliveryState,TelegramLocalInbox} from './telegram-delivery.ts';
import type {TelegramInbox} from './telegram-inbox.ts';
import type {MnemosAccountSession} from './account-session.ts';
/** Public human metadata; bot/channel credentials are intentionally absent. */
export type TelegramConnectionState = ReturnType<TelegramInbox['describe']> & {
 bot:string;username:string;binding:string;ready:boolean;disconnected:boolean;
 cleanup_pending:boolean;channel_id:string|null;channel_registered:boolean;code:string|null;
};
/** Shared contract implemented by the real human RPC target. */
export interface TelegramManagement {
 /** Owned connection metadata only; unavailable attempts are counted separately. */
 listTelegram():Promise<{connections:Pick<TelegramConnectionState,'bot'|'username'|'binding'|'ready'|'disconnected'|'cleanup_pending'|'channel_registered'>[];unavailable:number}>;
 readTelegramBudget:MnemosAccountSession['readTelegramBudget'];
 setTelegramBudget:MnemosAccountSession['setTelegramBudget'];
 readProjectBudget:MnemosAccountSession['readProjectBudget'];
 connectTelegram(request:string,token:string,binding:string,deliveryAcknowledged:boolean):Promise<TelegramConnectionState>;
 describeTelegram(bot:string):Promise<TelegramConnectionState>;
 confirmTelegram(bot:string,epoch:string,sender:number):Promise<TelegramConnectionState>;
 disconnectTelegram(bot:string):Promise<void>;
 telegramLocalInbox(id:string,after?:number):Promise<TelegramLocalInbox>;
 telegramTaskJournal(id:string,after?:number):Promise<Awaited<ReturnType<MnemosAccountSession['telegramTaskJournal']>> & {delivery:TelegramDeliveryState[]}>;
 listAgentConnections:MnemosAccountSession['listAgentConnections'];
}
