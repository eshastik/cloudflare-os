export interface DatabaseConnection {db_id:string;project_id:string;name:string;driver:string;env_var:string;registered_by:string;registered_at:string;configured:boolean;last_sweep_at:string;unreachable_since:string}
export interface DatabaseRegistration {name:string;driver:"postgres";env_var:string;max_rows:number;timeout_ms:number}
