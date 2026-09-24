import { OrganizationSharingSettings } from "./ProjectSharing.tsx";
import { Block, Notice } from "./ui.tsx";

/** «Правила»: как в организации создают проекты и делятся ими. Меняет администратор; сервер проверяет каждое изменение. */
export default function RulesTab() {
  return <section aria-label="Правила организации">
    <Block title="Проекты">
      <p className="mt-0 mb-3 max-w-[650px] text-[13px] text-kumo-subtle">Кто создаёт проекты, кому виден новый проект, нужны ли подтверждения, чтобы открыть проект отделу или всей организации, и можно ли сотрудникам вести личные проекты.</p>
      <OrganizationSharingSettings />
    </Block>
    <Block title="Согласования">
      <Notice>Кто согласует изменения документов, задаётся в каждом проекте: страница проекта, блок «Согласование». Запросы на согласование приходят во «Входящие».</Notice>
    </Block>
  </section>;
}
