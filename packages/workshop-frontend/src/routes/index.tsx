import { classifyRpcError, logRpcFailure } from "../rpcErrors";
import { useState, useEffect, useRef, useCallback } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useKumoToastManager } from "@cloudflare/kumo";
import { ChatInput } from "../ChatInterface";
import HomeTaskSuggestions from "../components/AppShell/HomeTaskSuggestions";
import { useAuthenticatedApi } from "../AuthContext";
import { RpcStub } from "capnweb";
import {
  Overseer,
  AiChatAuthorInfo,
  CapsuleSpecifier,
  ChatAttachmentHandle,
  MessageFormatRef,
  SlashCommandRequest,
  type ChatProjectChoice,
} from "@gadgets/workshop-shared/api";
import {
  getStoredSelectedModel,
  persistSelectedModel,
} from "../modelSelection";
import { useDocumentTitle } from "../useDocumentTitle";
import { homePromptFromSearch, homeProjectFromSearch, projectContextFromProjects } from "../homePrompt";
import { ProjectChips } from "../components/chat/ProjectChips";
import { CodeModeSwitch } from "../components/chat/CodeModeSwitch";
import { MAX_CHAT_PROJECTS, chatCodeMode, chatProjects, type ChatCodeMode, type ChatProject } from "@gadgets/workshop-shared/code-work";
import SharedWithYou from "../components/AppShell/SharedWithYou";

type HomeSearch = { prompt?: string; projectContext?: import('@gadgets/workshop-shared/api').ChatProjectContext };

export const Route = createFileRoute("/")({
  component: HomePage,
  validateSearch: (search: Record<string, unknown>): HomeSearch => ({
    prompt: homePromptFromSearch(search.prompt),
    projectContext: homeProjectFromSearch(search.projectContext),
  }),
});

// The Home page is the "new workspace" launcher. Persistent navigation (recents, favorites) lives
// in the AppShell rail, so this page focuses on a single thing: composing the first message of a
// new gadget. Макет Main: приветствие по центру, одно поле ввода, под ним несколько подсказок.
function HomePage() {
  return <HomePageContent {...Route.useSearch()} />;
}

export function HomePageContent({ prompt, projectContext: project }: HomeSearch) {
  useDocumentTitle("Новая беседа");

  const { authenticatedApi } = useAuthenticatedApi();
  const navigate = useNavigate();
  const toasts = useKumoToastManager();

  const [projects, setProjects] = useState<ChatProject[]>(() => chatProjects(project));
  useEffect(() => { if (project) setProjects(chatProjects(project)); }, [project]);
  const loadProjectChoices = useCallback(() => authenticatedApi.listChatProjects(), [authenticatedApi]);
  // Проект подключается к беседе чипом (пример задачи по проекту или проект из папки).
  const addProject = useCallback((project: ChatProjectChoice) => {
    setProjects((current) => current.some((p) => p.accountId === project.accountId && p.projectId === project.projectId)
      ? current
      : [...current, {
          accountId: project.accountId, projectId: project.projectId, title: project.title,
          pinnedBy: "user" as const, ...(project.hasCode ? { hasCode: true } : {}),
        }].slice(-MAX_CHAT_PROJECTS));
  }, []);
  // Проекты человека — для примеров задач по его проектам под полем ввода.
  const [projectChoices, setProjectChoices] = useState<ChatProjectChoice[] | null | "failed">(null);
  useEffect(() => {
    let cancelled = false;
    Promise.resolve()
      .then(() => authenticatedApi.listChatProjects())
      .then((list) => { if (!cancelled) setProjectChoices(list); })
      .catch(() => { if (!cancelled) setProjectChoices("failed"); });
    return () => { cancelled = true; };
  }, [authenticatedApi]);

  // Работа с кодом для новой беседы. Сохраняется в беседе сразу после её создания; по умолчанию
  // «Авто», как у любой беседы без явного выбора.
  const [codeMode, setCodeMode] = useState<ChatCodeMode>(() => chatCodeMode(undefined));

  const [models, setModels] = useState<AiChatAuthorInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  // Bumped each time a task suggestion is picked; the composer re-seeds its text off the nonce.
  const [seed, setSeed] = useState<{ text: string; nonce: number }>({ text: "", nonce: 0 });

  useEffect(() => {
    if (!prompt) return;
    setSeed((previous) => ({ text: prompt, nonce: previous.nonce + 1 }));
    navigate({ to: "/", search: {}, replace: true });
  }, [navigate, prompt]);

  useEffect(() => {
    let cancelled = false;
    authenticatedApi.listModels()
      .then((list) => {
        if (cancelled) return;
        setModels(list);
        setSelectedModel(getStoredSelectedModel(list));
      })
      .catch((err) => {
        logRpcFailure("Failed to fetch models:", err);
        // Toast unless it's a connection error (reconnect refetches); a do-reset here already
        // survived the Worker's same-colo retry, so the user should hear about it.
        if (classifyRpcError(err) !== "connection") {
          toasts.add({ title: "Не удалось загрузить список моделей. Обновите страницу.", variant: "error" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [authenticatedApi]);

  const handleModelChange = useCallback((value: string | null) => {
    setSelectedModel(value);
    persistSelectedModel(value);
  }, []);

  // Pre-create a provisional gadget as soon as the user starts interacting, so that navigation
  // after submit is instant. Same pattern as before — disposed on unmount if never consumed.
  const provisionalOverseerRef = useRef<{ stub: RpcStub<Overseer> } | null>(null);

  const ensureProvisionalGadget = useCallback(() => {
    if (!provisionalOverseerRef.current) {
      const overseer = authenticatedApi.newGadget();
      provisionalOverseerRef.current = { stub: overseer };
    }
  }, [authenticatedApi]);

  useEffect(() => {
    return () => {
      provisionalOverseerRef.current?.stub[Symbol.dispose]();
      provisionalOverseerRef.current = null;
    };
  }, []);

  const handleSend = useCallback(
    async (
      message: string | SlashCommandRequest,
      modelId: string | null,
      capsules?: CapsuleSpecifier[],
      attachments?: ChatAttachmentHandle[],
      formats?: MessageFormatRef[],
    ) => {
      try {
        ensureProvisionalGadget();
        const overseer = provisionalOverseerRef.current!.stub;
        // Pipeline both independent calls in one batch, but settle both before releasing the stub.
        const projectContext = projectContextFromProjects(projects);
        const [chat, {id}] = await Promise.all([
          projectContext ? overseer.newChat(message, modelId, capsules, attachments, formats, projectContext) : overseer.newChat(message, modelId, capsules, attachments, formats),
          overseer.getMetadata(),
        ]);
        if (codeMode !== chatCodeMode(undefined)) {
          // Беседа уже создана: сбой переключателя не должен терять её, человек поправит режим в ней.
          try {
            await overseer.setChatCodeMode(chat, codeMode);
          } catch (err) {
            logRpcFailure("Не удалось сохранить режим работы с кодом:", err);
            toasts.add({ title: "Беседа начата, но режим работы с кодом не сохранился. Выберите его в беседе.", variant: "error" });
          }
        }
        provisionalOverseerRef.current?.stub[Symbol.dispose]();
        provisionalOverseerRef.current = null;
        // Open the conversation we just started.
        navigate({ to: "/workspace/$id", params: { id }, search: { chat } });
      } catch (err) {
        const transient = logRpcFailure("Failed to create gadget:", err,
            { reportSite: "workspace.create" });
        // A retry reuses the provisional gadget while the draft contains gadget-scoped references.
        if (!attachments?.length && !capsules?.length) {
          provisionalOverseerRef.current?.stub[Symbol.dispose]();
          provisionalOverseerRef.current = null;
        }
        if (!transient) {
          toasts.add({ title: "Не удалось начать беседу. Попробуйте ещё раз.", variant: "error" });
        }
        throw err;
      }
    },
    [ensureProvisionalGadget, navigate, toasts, projects, codeMode],
  );

  const getOverseer = useCallback((): RpcStub<Overseer> => {
    ensureProvisionalGadget();
    return provisionalOverseerRef.current!.stub;
  }, [ensureProvisionalGadget]);

  const createCapsuleGatekeeper = useCallback(
    (accountId: number, url: string) => {
      ensureProvisionalGadget();
      return provisionalOverseerRef.current!.stub.newGatekeeper(accountId, url);
    },
    [ensureProvisionalGadget],
  );

  return (
    <div className="flex min-h-full w-full flex-col items-center justify-center px-4 pb-20 pt-12 sm:px-8">
      <div className="flex w-full max-w-[720px] flex-col items-stretch">
        {/* Крупное приветствие по центру (макет Main). */}
        <header className="mb-9 text-center">
          <h1 className="m-0 text-[34px] leading-tight font-semibold tracking-[-1px] text-kumo-default sm:text-[44px] sm:tracking-[-1.4px]">
            Над чем работаем?
          </h1>
          <p className="mx-auto mt-3 mb-0 max-w-[520px] text-[17px] leading-normal text-kumo-subtle">
            Спросите или поручите что угодно. Агент найдёт нужное в ваших проектах и сделает в пределах ваших прав.
          </p>
        </header>

        {/* Одно поле ввода: над ним — проекты беседы и переключатель работы с кодом. */}
        <div>
          <ProjectChips
            projects={projects}
            onChange={setProjects}
            loadChoices={loadProjectChoices}
            trailing={<CodeModeSwitch mode={codeMode} onChange={setCodeMode} />}
          />
          <ChatInput
            createCapsuleGatekeeper={createCapsuleGatekeeper}
            getOverseer={getOverseer}
            onSend={handleSend}
            isAgentActive={false}
            models={models}
            selectedModel={selectedModel}
            onModelChange={handleModelChange}
            newChat
            autoFocus
            minRows={2}
            seedText={seed.text}
            seedNonce={seed.nonce}
            onFolderProjectCreated={addProject}
          />
        </div>

        {/* Три-четыре подсказки по проектам человека. Щелчок кладёт текст в поле ввода. */}
        <div className="mt-7">
          <HomeTaskSuggestions
            choices={projectChoices}
            onPick={(example) => {
              setSeed((prev) => ({ text: example.prompt, nonce: prev.nonce + 1 }));
              // Пример по проекту подключает этот проект к беседе (если его ещё нет в наборе).
              if (example.project) addProject(example.project);
            }}
          />
        </div>

        {/* Недавние документы, которыми с вами поделились: щелчок открывает документ в редакторе. */}
        <SharedWithYou />
      </div>
    </div>
  );
}
