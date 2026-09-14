import type { ReactNode } from 'react'
import styles from './IntegrationForm.module.css'

/** Shared shell presentation for connection forms, including nested import steps. */
export default function IntegrationForm({ title, children }: { title: string; children: ReactNode }) {
  return <section aria-label={title} className={styles.form}>
    <h3 className="text-base font-medium text-kumo-default">{title}</h3>
    {children}
  </section>
}
