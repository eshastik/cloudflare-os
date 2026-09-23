import type {SourceLoadHealth} from './source-health.ts';
export interface GitConnection extends SourceLoadHealth {connection_id:string;owner_id:string;provider:"github"|"gitlab"|"gitea";api_base:string;account_id:string;account_login:string;name:string;revision:number;enabled:boolean}
export interface GitConnectionPage {connections:GitConnection[];next_cursor?:string}
export interface GitRepository {id:string;name:string;default_branch:string}
export interface GitRepositoryPage {repositories:GitRepository[];next_page?:number}
export interface GitSetup {provider:"github"|"gitlab";api_base:string;name:string}
export interface GitRegistration extends GitSetup {connection_id:string;token:string}
export interface GitDisabled {connection:GitConnection;credential_removed:boolean}
export function validateGitSetup(input:GitSetup):GitSetup {
 if(!input||typeof input!=="object"||Object.keys(input).some(k=>!["provider","api_base","name"].includes(k))||!["github","gitlab"].includes(input.provider)||typeof input.name!=="string"||!input.name.trim()||input.name!==input.name.trim()||new TextEncoder().encode(input.name).length>255||(typeof input.api_base!=="string"||input.api_base.length>2048))throw Error("Invalid Git setup");
 const u=new URL(input.api_base);if(u.protocol!=="https:"||u.username||u.password||u.search||u.hash||/[\\\s]/.test(input.api_base))throw Error("Invalid Git endpoint");
 return {provider:input.provider,api_base:input.api_base.replace(/\/$/,""),name:input.name};
}

export interface GitProjectRepository {project_id:string;connection_id:string;repository_id:string;repository_name:string;revision:number;enabled:boolean;provider:"github"|"gitlab"|"gitea";connection_revision:number}
export interface GitProjectRepositoryPage {repositories:GitProjectRepository[];next_cursor?:string}
export interface GitRepositorySelection {expected_connection_revision:number;expected_revision:number;repository_name:string;enabled:boolean}

export interface GitBindingState {push_path?:string;push_url?:string;mcp_resource?:string;connection_revision:number;binding:Omit<GitProjectRepository,"provider"|"connection_revision">|null}

export interface GitCommit {repository_id:string;sha:string;message:string;committed_at:string;parents:string[]}

export interface GitFile {repository_id:string;commit_sha:string;path:string;blob_sha:string;sha256:string;size_bytes:number;content:string}

export interface GitTreeEntry {name:string;path:string;type:"file"|"dir"|"symlink"|"submodule";size_bytes:number;sha:string}
export interface GitTree {repository_id:string;commit_sha:string;path:string;entries:GitTreeEntry[];truncated:boolean}
export interface GitBranch {name:string;sha:string}
export interface GitBranchPage {repository_id:string;branches:GitBranch[];next_page?:number}
export interface GitLogPage {repository_id:string;ref:string;path?:string;commits:GitCommit[];next_page?:number}
export interface GitChangedFile {path:string;old_path?:string;status:"added"|"deleted"|"modified"|"renamed";additions:number;deletions:number;binary?:boolean}
export interface GitComparison {repository_id:string;base:string;head:string;total_commits:number;commits:GitCommit[];commits_truncated:boolean;files:GitChangedFile[];files_complete:boolean;diff:string;diff_truncated:boolean}

/** Ответ провайдера — непроверенные данные: без ожидаемой формы экран не строится. */
export function checkedGitTree(value:GitTree):GitTree{if(!value||typeof value.commit_sha!=="string"||!Array.isArray(value.entries)||value.entries.some(e=>!e||typeof e.name!=="string"||typeof e.path!=="string"||!["file","dir","symlink","submodule"].includes(e.type)))throw Error("Invalid Git tree");return value;}
export function checkedGitBranches(value:GitBranchPage):GitBranchPage{if(!value||!Array.isArray(value.branches)||value.branches.some(b=>!b||typeof b.name!=="string"||typeof b.sha!=="string"))throw Error("Invalid Git branches");return value;}
export function checkedGitLog(value:GitLogPage):GitLogPage{if(!value||!Array.isArray(value.commits)||value.commits.some(c=>!c||typeof c.sha!=="string"))throw Error("Invalid Git log");return value;}
export function checkedGitComparison(value:GitComparison):GitComparison{if(!value||!Array.isArray(value.files)||!Array.isArray(value.commits)||typeof value.diff!=="string"||value.files.some(f=>!f||typeof f.path!=="string"||!["added","deleted","modified","renamed"].includes(f.status)))throw Error("Invalid Git comparison");return value;}
