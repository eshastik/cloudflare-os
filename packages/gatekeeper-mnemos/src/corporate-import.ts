export interface JiraImportPreview {
 source_node_id:string;source_head:string;source_sha256:string;
 preview:{attachments?:{id:string;issue_id:string;issue_key:string;name:string;size_bytes:number;content_type:string;sha256?:string;available:boolean}[];source_id:string;page_sha256:string[];access_mapping:"unmapped";pending_attachments:number;
 issues:{task_mapping_source?:{record_sha256:string;status:string;responsible_id:string};id:string;key:string;title:string;record:string;referenced_issues:string[];missing_fields:string[]}[];
 unresolved:{from:string;to:string}[];};
}

export interface JiraTaskPrepared {preview_id:string;source_node_id:string;source_head:string;issue_id:string;content_type:string;content:string;sha256:string;}

export interface CorporateOrigin {revision_head?:string;source_node_id:string;source_head:string;source_sha256:string;output_sha256:string;provider:string;entity_kind:string;entity_id:string;}

export interface BitrixImportPreview {
 source_node_id:string;source_head:string;source_sha256:string;
 preview:{files?:{object_id:string;name:string;size_bytes:number;sha256?:string;content_type?:string;available:boolean}[];source_id:string;page_sha256:string[];access_mapping:"unmapped";
 records:{task_mapping_source?:{record_sha256:string;status:string;responsible_id:string};kind:string;id:string;title:string;record:string;missing_fields:string[]}[];
 references:{from_kind:string;from_id:string;field:string;to_kind:string;to_id:string;resolved:boolean}[];
 missing_collections:string[];};
}

export interface BitrixTaskMapping {source_record_sha256:string;source_status:string;source_responsible_id:string;status:string;assignee_id:string;stage_name:string;department:string;next_step:string;blocker:string;result:string;}

export interface CorporateUpdateResolution {current_sha256:string;incoming_sha256:string;title_choice:"local"|"incoming";}
export interface CorporateRecordUpdatePreview {
 preview_id?:string;
 resolution?:CorporateUpdateResolution;
 target_node_id:string;target_head:string;current_sha256:string;incoming_node_id:string;incoming_head:string;incoming_sha256:string;
 plan:{source_changed:boolean;local_changed:boolean;conflicts:{field:string;base:string;local:string;incoming:string}[];content:string};
}

export interface CorporateFilePrepared {preview_id:string;source_node_id:string;source_head:string;entity_id:string;name:string;content_type:string;content_base64:string;size_bytes:number;sha256:string;}

export interface CorporateLinks {links:{source_task_id?:string;field:string;kind:string;entity_id:string;label:string}[];}

export interface CorporateWorkflowPreview {source_node_id:string;source_head:string;source_sha256:string;provider:string;content:string;sha256:string;}

/** Explicit source records and existing Mnemos identities chosen by a human. */
export interface BitrixDepartmentSelection {
 source_sha256:string; person_id:string; department_id:string; role_id:string; member_id:string;
}
/** Authorized source relationship and current membership shown before a change. */
export interface BitrixDepartmentPreview {
 origin:{project_id:string;source_node_id:string;source_head:string;source_sha256:string;person_id:string;department_id:string};
 person_name:string;department_name:string;source_person_active:boolean;
 membership:import("./mnemos-api.ts").PrincipalMembership;
}
