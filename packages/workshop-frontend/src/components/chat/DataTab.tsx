import { useState } from 'react'
import { Table } from '@cloudflare/kumo'
import { Badge } from '@cloudflare/kumo'
import { Button } from '@cloudflare/kumo'
import { sampleDataRows } from '../../data/chat'

export default function DataTab() {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  function toggleRow(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (selectedIds.size === sampleDataRows.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(sampleDataRows.map((r) => r.id)))
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-kumo-fill bg-kumo-elevated">
        <div className="flex items-center gap-3">
          <span className="font-mono text-sm text-kumo-default">channels</span>
          <Badge variant="secondary">Строк: {sampleDataRows.length}</Badge>
        </div>
        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && (
            <span className="text-xs text-kumo-subtle">
              Выбрано: {selectedIds.size}
            </span>
          )}
          <Button variant="ghost" size="xs">Фильтр</Button>
          <Button variant="ghost" size="xs">Сортировка</Button>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <Table layout="fixed">
          <Table.Header>
            <Table.Row>
              <Table.CheckHead
                checked={selectedIds.size === sampleDataRows.length}
                indeterminate={selectedIds.size > 0 && selectedIds.size < sampleDataRows.length}
                onValueChange={toggleAll}
                aria-label="Выбрать все строки"
              />
              <Table.Head>Канал</Table.Head>
              <Table.Head>Сообщения</Table.Head>
              <Table.Head>Активность</Table.Head>
              <Table.Head>Статус</Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {sampleDataRows.map((row) => (
              <Table.Row key={row.id} variant={selectedIds.has(row.id) ? 'selected' : 'default'}>
                <Table.CheckCell
                  checked={selectedIds.has(row.id)}
                  onValueChange={() => toggleRow(row.id)}
                  aria-label={`Выбрать ${row.channel}`}
                />
                <Table.Cell>
                  <span className="font-mono text-sm text-kumo-default">{row.channel}</span>
                </Table.Cell>
                <Table.Cell>
                  <span className="text-sm text-kumo-subtle tabular-nums">
                    {row.messages.toLocaleString()}
                  </span>
                </Table.Cell>
                <Table.Cell>
                  <span className="text-xs text-kumo-subtle">{row.lastActive}</span>
                </Table.Cell>
                <Table.Cell>
                  {row.unread ? (
                    <Badge variant="primary">Непрочитано</Badge>
                  ) : (
                    <Badge variant="secondary">Прочитано</Badge>
                  )}
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-kumo-fill bg-kumo-elevated flex items-center justify-between">
        <span className="font-mono text-xs text-kumo-subtle">
          Строк в channels: {sampleDataRows.length}
        </span>
        <span className="font-mono text-xs text-kumo-subtle">
          Всего сообщений: {sampleDataRows.reduce((sum, r) => sum + r.messages, 0).toLocaleString()}
        </span>
      </div>
    </div>
  )
}
