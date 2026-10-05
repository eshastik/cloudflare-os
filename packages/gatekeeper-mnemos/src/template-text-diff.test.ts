import {test} from 'node:test';
import assert from 'node:assert/strict';
import {templateTextChanges} from '../app/template-text-diff.ts';
test('сравнение сохраняет порядок правок, повторы и пустые строки и ограничивает большие входы',()=>{
 assert.deepEqual(templateTextChanges('Цель\nСтарое\nКонец','Цель\nНовое\nКонец'),[{kind:'removed',text:'Старое'},{kind:'added',text:'Новое'}]);
 assert.deepEqual(templateTextChanges('a\nb\na','a\na'),[{kind:'removed',text:'b'}]);
 assert.deepEqual(templateTextChanges('a\r\nb','a\nb'),[]);
 assert.deepEqual(templateTextChanges('a','a\n'),[{kind:'added',text:''}]);
 assert.deepEqual(templateTextChanges('',''),[]);
 assert.equal(templateTextChanges(Array(401).fill('a').join('\n'),'a'),null);
 assert.notEqual(templateTextChanges(Array(400).fill('a').join('\n'),'a'),null);
});
