export interface GitConnection {connection_id:string;owner_id:string;provider:"github"|"gitlab";api_base:string;account_id:string;account_login:string;name:string;revision:number;enabled:boolean}
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

export interface GitProjectRepository {project_id:string;connection_id:string;repository_id:string;repository_name:string;revision:number;enabled:boolean;provider:"github"|"gitlab";connection_revision:number}
export interface GitProjectRepositoryPage {repositories:GitProjectRepository[];next_cursor?:string}
export interface GitRepositorySelection {expected_connection_revision:number;expected_revision:number;repository_name:string;enabled:boolean}

export interface GitBindingState {push_path?:string;push_url?:string;mcp_resource?:string;connection_revision:number;binding:Omit<GitProjectRepository,"provider"|"connection_revision">|null}

export interface GitCommit {repository_id:string;sha:string;message:string;committed_at:string;parents:string[]}

export interface GitFile {repository_id:string;commit_sha:string;path:string;blob_sha:string;sha256:string;size_bytes:number;content:string}
