import type {TelegramBudgetSettings} from './mnemos-api.ts';

/** Shared checked projection of human and channel budget responses. */
export function telegramVoiceBudget(value:unknown):TelegramBudgetSettings{
 const r=value as TelegramBudgetSettings;
 if(!r||!Number.isSafeInteger(r.revision)||r.revision<0||!Number.isSafeInteger(r.policy_revision)||typeof r.project_id!=='string'||r.project_id.length>255||typeof r.limit_usd_micros!=='string')throw Error('Invalid Telegram budget.');
 const money=(s:unknown)=>typeof s==='string'&&/^[1-9][0-9]{0,18}$/.test(s)&&BigInt(s)<=9223372036854775807n;
 if(r.revision===0?r.project_id!==''||r.policy_revision!==0||r.limit_usd_micros!=='0':!r.project_id||r.policy_revision<1||!money(r.limit_usd_micros))throw Error('Invalid Telegram budget.');
 const binding=r.voice_binding_id??'',limit=r.voice_limit_usd_micros??'0';
 if(typeof binding!=='string'||binding.length>255||binding.includes('\0')||(!binding?limit!=='0':r.revision===0||!money(limit)))throw Error('Invalid Telegram voice budget.');
 return {revision:r.revision,project_id:r.project_id,policy_revision:r.policy_revision,limit_usd_micros:r.limit_usd_micros,...(binding?{voice_binding_id:binding,voice_limit_usd_micros:limit}:{})};
}
