import { Badge } from '@cloudflare/kumo'
import { Text } from '@cloudflare/kumo'
import { Circle } from '@phosphor-icons/react'
import { sampleDataRows } from '../../data/chat'

/**
 * App tab = live preview of the running app.
 * This renders a mock of what the deployed Slack summarizer looks like.
 */
export default function AppPreview() {
  return (
    <div className="flex flex-col h-full bg-kumo-base">
      {/* App content */}
      <div className="flex-1 overflow-auto p-6">
        {/* App header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <Text variant="heading2" as="h1">Сводка каналов</Text>
            <p className="text-sm text-kumo-subtle mt-1">
              Ежедневная сводка ваших каналов Slack на Workers AI
            </p>
          </div>
          <Badge variant="success">Работает</Badge>
        </div>

        {/* Channel cards */}
        <div className="grid gap-3">
          {sampleDataRows.filter(r => r.unread).map((row) => (
            <div
              key={row.id}
              className="rounded-lg border border-kumo-line bg-kumo-base p-4 hover:bg-kumo-elevated transition-colors cursor-pointer"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-semibold text-kumo-default">{row.channel}</span>
                  <Badge variant="primary">{row.messages} сообщ.</Badge>
                </div>
                <span className="text-xs text-kumo-subtle">{row.lastActive}</span>
              </div>
              {/* Fake summary */}
              <div className="space-y-1.5 mt-3">
                <div className="flex items-start gap-2">
                  <Circle size={5} className="text-kumo-subtle mt-1.5 flex-shrink-0" weight="fill" />
                  <p className="text-sm text-kumo-subtle">
                    {row.channel === '#general'
                      ? 'Команда обсудила план на первый квартал и договорилась о сроке предложений — 15 марта'
                      : row.channel === '#engineering'
                        ? 'Выкатили исправление v2.4.1 для таймаута входа. Задержка по панелям мониторинга вернулась в норму'
                        : 'Живое обсуждение проектов к хакатону на выходных и планов на пятничный обед'}
                  </p>
                </div>
                <div className="flex items-start gap-2">
                  <Circle size={5} className="text-kumo-subtle mt-1.5 flex-shrink-0" weight="fill" />
                  <p className="text-sm text-kumo-subtle">
                    {row.channel === '#general'
                      ? 'Назначено 3 задачи, принято 2 решения'
                      : row.channel === '#engineering'
                        ? 'RFC по новому слою кэширования получил 5 одобрений, переходим к реализации'
                        : '12 участников, темы: хакатон, обед команды, выезд'}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Quiet channels */}
        <div className="mt-6">
          <div className="text-xs font-semibold text-kumo-subtle uppercase tracking-wider mb-3">
            Без новой активности
          </div>
          <div className="flex flex-wrap gap-2">
            {sampleDataRows.filter(r => !r.unread).map((row) => (
              <div key={row.id} className="px-3 py-1.5 rounded-md bg-kumo-tint">
                <span className="font-mono text-xs text-kumo-subtle">{row.channel}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
