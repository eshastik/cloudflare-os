import { createFileRoute } from '@tanstack/react-router'
import TelegramSettings from '../TelegramSettings'

export const Route = createFileRoute('/telegram')({
  component: TelegramSettings,
})
