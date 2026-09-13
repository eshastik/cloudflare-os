import type {ProjectSignalProfile} from './mnemos-api.ts';

/** Starting requirements for a web service; source queries must be mapped explicitly. */
export function webServiceProfile():ProjectSignalProfile {
 return {requirements:[
  {id:'availability',purpose:'Доля успешных внешних проверок основного пользовательского пути за последние 5 минут. Нужны сами проверки, а не наличие адреса в карте.',max_age_seconds:300,expected_unit:'ratio'},
  {id:'error_rate',purpose:'Доля ошибочных реальных запросов за последние 5 минут. При отсутствии запросов измерение отсутствует; нулевой трафик не доказывает отсутствие ошибок.',max_age_seconds:300,expected_unit:'ratio'},
  {id:'latency_p95',purpose:'95-й перцентиль длительности реальных запросов за последние 5 минут, включая ошибки. Нужна непустая выборка.',max_age_seconds:300,expected_unit:'milliseconds'},
  {id:'dependencies',purpose:'Число неуспешных проверок ключевых зависимостей. Ноль допустим только после проверки всех зависимостей выбранного пользовательского пути.',max_age_seconds:300,expected_unit:'dependencies'},
  {id:'active_users',purpose:'Уникальные реальные пользователи за последние 24 часа. Тесты и служебные агенты исключены; ноль допустим только при подтверждённом сборе событий.',max_age_seconds:900,expected_unit:'users'},
  {id:'workflow_completions',purpose:'Успешные завершения основного пользовательского сценария за последние 24 часа. Укажите конкретный сценарий проекта; открытия страницы не заменяют результат.',max_age_seconds:900,expected_unit:'completions'},
  {id:'collection_lag',purpose:'Отставание сбора событий. Используйте подтверждённую отметку обработанных данных; текущее время SQL-запроса не подтверждает свежесть исходных событий.',max_age_seconds:300,expected_unit:'seconds'},
 ],queries:[]};
}
