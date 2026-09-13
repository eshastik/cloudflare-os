/** Advertise an administrator-configured reverse proxy origin while retaining
 * the internal callback path and secret-authenticated Worker route. Never use
 * request headers or sender input to choose the public destination. */
export function telegramPublicWebhook(route:string, publicOrigin?:string):string {
 if(publicOrigin===undefined)return route;
 let origin:URL;
 try{origin=new URL(publicOrigin);}catch{throw Error('Invalid public Telegram origin.');}
 if(origin.protocol!=='https:'||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash||
    !['','443','80','88','8443'].includes(origin.port))throw Error('Invalid public Telegram origin.');
 const internal=new URL(route);
 return origin.origin+internal.pathname;
}
