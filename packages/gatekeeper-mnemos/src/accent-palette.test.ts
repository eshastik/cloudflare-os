// Панель Mnemos во фрейме берёт акцент оболочки: зашитого зелёного Mnemos в её стилях и разметке нет.
// Зелёный допустим только у токенов, которые скрипт переопределяет (accentCSSVariables), и у статуса «успех».
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {accentViolations, defaultAccentHue, greenLiterals} from '@gadgets/workshop-shared/accent-audit';

const appDir = new URL('../app-react/', import.meta.url);
const read = (name: string) => readFileSync(new URL(name, appDir), 'utf8');

test('styles.css панели: нейтральные токены окрашены оттенком акцента, зелёного вне акцента и статусов нет', () => {
  const css = read('styles.css');
  assert.deepEqual(accentViolations(css), []);
  assert.equal(defaultAccentHue(css), 167.3);
});

test('разделы панели не держат зелёный Mnemos в разметке: только токены Kumo', () => {
  const found = readdirSync(appDir).filter(name => /\.(tsx?|html)$/.test(name))
    .flatMap(name => greenLiterals(read(name)).map(hit => `${name}: ${hit}`));
  assert.deepEqual(found, []);
});

test('страница завершения входа не красит ссылку зелёным Mnemos', () => {
  assert.deepEqual(greenLiterals(readFileSync(new URL('./browser-login.ts', import.meta.url), 'utf8')), []);
});
