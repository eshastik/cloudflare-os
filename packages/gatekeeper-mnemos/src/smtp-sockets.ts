import {connect} from 'cloudflare:sockets';
import type {SmtpConnect} from './smtp-client.ts';

/** TLS is enforced by the Worker runtime; no caller-supplied trust overrides. */
export const connectSmtp:SmtpConnect=server=>connect({hostname:server.host,port:server.port},
  {allowHalfOpen:false,secureTransport:server.security==='tls'?'on':'starttls'});
