import {createFileRoute} from '@tanstack/react-router'
import TemplateLibraryPage from '../TemplateLibraryPage'

export const Route=createFileRoute('/blueprints')({component:TemplateLibraryPage})
