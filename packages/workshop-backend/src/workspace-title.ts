export const DEFAULT_WORKSPACE_TITLE = "Новая беседа";

export function isDefaultWorkspaceTitle(title: string): boolean {
  return [DEFAULT_WORKSPACE_TITLE, "Untitled Workspace", "Untitled Gadget"].includes(title);
}

/** Старые служебные имена переводятся при чтении без переименования пользовательских данных. */
export function displayWorkspaceTitle(title: string): string {
  return isDefaultWorkspaceTitle(title) ? DEFAULT_WORKSPACE_TITLE : title;
}
