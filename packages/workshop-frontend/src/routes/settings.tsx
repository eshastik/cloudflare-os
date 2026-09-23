import { createFileRoute } from '@tanstack/react-router'
import SettingsHub from '../SettingsHub'

export const Route = createFileRoute('/settings')({
  component: SettingsHub,
})
