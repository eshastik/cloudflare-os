import type {PlatformSignal} from "./mnemos-api.ts";

/** Проверки, которые сервер отдаёт всегда, в этом порядке. */
export const CORE_SIGNAL_KEYS=["dependencies","external.readiness","external.login","external.read","external.save"] as const;

/** Словарь сигналов, который форк понимает: «ключ состояние причина». Совпадает с перечнем сервера
 * services/storage-api/internal/httpapi/testdata/platform_signals.txt (сверяет platform-signals.test.ts). */
export const KNOWN_SIGNALS:readonly string[]=[
 ...CORE_SIGNAL_KEYS.flatMap(key=>[`${key} ok check_passed`,`${key} firing check_failed`,
  ...(key==="dependencies"?["check_unavailable"]:["source_unavailable","observations_missing","observations_stale"]).map(r=>`${key} unknown ${r}`)]),
 "shared_projection ok check_passed","shared_projection firing jobs_stalled","shared_projection unknown check_unavailable",
];
const KNOWN=new Set(KNOWN_SIGNALS);
const KNOWN_KEYS=new Set(KNOWN_SIGNALS.map(s=>s.split(" ")[0]));
const KNOWN_REASONS=new Set(KNOWN_SIGNALS.map(s=>s.split(" ")[2]));

/** Сигнал с известным ключом и известной причиной, но в сочетании, которого сервер не отдаёт, — ложь
 * (например, «в порядке» без проверки). Новый ключ или новая причина — не ложь, а незнакомый сигнал. */
export function knownSignal(row:PlatformSignal):boolean{return KNOWN.has(`${row.key} ${row.state} ${row.reason}`);}

/** Снимок проверок. Отсутствующая или неверная проверка не выдаётся за успешную, но незнакомый
 * сигнал (новая проверка сервера) страницу не роняет: он показывается общей строкой с ключом. */
export function validPlatformSignals(value:unknown):value is PlatformSignal[]{
 if(!Array.isArray(value)||value.length<CORE_SIGNAL_KEYS.length||value.length>64)return false;
 const seen=new Set<string>();
 const ok=value.every((row,i)=>{
  if(!row||typeof row!=="object"||typeof row.key!=="string"||!row.key||row.key.length>64||seen.has(row.key))return false;
  seen.add(row.key);
  if(i<CORE_SIGNAL_KEYS.length&&row.key!==CORE_SIGNAL_KEYS[i])return false;
  if(!["ok","firing","unknown"].includes(row.state)||typeof row.reason!=="string"||!row.reason||row.reason.length>64)return false;
  if(row.observed_at!==null&&(typeof row.observed_at!=="string"||!Number.isFinite(Date.parse(row.observed_at))))return false;
  if(row.count!==undefined&&(!Number.isSafeInteger(row.count)||row.count<0))return false;
  if((row.state==="ok"||row.state==="firing")&&row.observed_at===null)return false;
  // Известные ключ и причина обязаны сойтись в сочетание из словаря; новое — терпится.
  return !(KNOWN_KEYS.has(row.key)&&KNOWN_REASONS.has(row.reason))||knownSignal(row);
 });
 return ok;
}
