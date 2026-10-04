import {test,expect} from 'vitest';
import {selectedWorkTemplatesPrompt} from '../src/agent-work-templates.js';
const selected={accountId:7,ownerId:'sender',reference:{scope_id:'department',template_key:'form',revision:5},title:'Форма ТЗ',purpose:'Подготовить ТЗ',kind:'document' as const};
test('точный владелец и аккаунт определяют разрешённое подключение',()=>{
 const prompt=selectedWorkTemplatesPrompt([selected],[{name:'OTHER',mnemosAccount:{ownerId:'other',accountId:7}},{name:'MNEMOS',mnemosAccount:{ownerId:'sender',accountId:7}}]);
 expect(prompt).toContain('"binding":"MNEMOS"');expect(prompt).not.toContain('"binding":"OTHER"');expect(prompt).toContain('"revision":5');expect(prompt).toContain('readTemplates');
});
test('отсутствие, смена владельца и неоднозначность не выбирают первое подключение',()=>{
 for(const bindings of [[],[{name:'OTHER',mnemosAccount:{ownerId:'other',accountId:7}}],[{name:'A',mnemosAccount:{ownerId:'sender',accountId:7}},{name:'B',mnemosAccount:{ownerId:'sender',accountId:7}}]])expect(selectedWorkTemplatesPrompt([selected],bindings)).toContain('"binding":null');
 expect(selectedWorkTemplatesPrompt(undefined,[])).toBe('');
});

test('нативная форма заполняется и сохраняется перед объявлением результата',()=>{
 const prompt=selectedWorkTemplatesPrompt([selected],[{name:'MNEMOS',mnemosAccount:{ownerId:'sender',accountId:7}}]);
 expect(prompt).toContain('readNativeDraft');expect(prompt).toContain('saveNativeDraft');
 expect(prompt).toContain('с сохранением структуры и оформления');
 expect(prompt).toContain('только после подтверждённого сохранения заполненной формы');
});
