import type {VoiceTransfer} from './voice-transfer.ts';
import type {MnemosAccountSession} from './account-session.ts';
/** The actual human RPC target implements these account-session methods. */
export type VoiceManagement=Pick<MnemosAccountSession,'prepareVoiceCommand'|'readProjectBudget'|'createTeamBudget'|'readTeamBudget'|'runTeamBudgetMember'|'readVoiceSource'|'beginVoiceUpload'|'downloadVoiceSource'|'importVoiceSource'|'readVoiceTranscript'|'editVoiceTranscript'|'confirmVoiceTranscript'|'readVoiceConfirmation'> & {
 prepareVoiceCommandBudget(source:string,confirmation:string,binding:string,criteria:string,limit:string):ReturnType<VoiceTransfer['prepareCommandBudget']>;
 resumeVoiceCommandBudget(source:string):ReturnType<VoiceTransfer['resumeCommandBudget']>;
 prepareVoiceTranscription(source:string,revision:number,binding:string,limit:string):ReturnType<VoiceTransfer['prepareTranscription']>;
 resumeVoiceTranscription(source:string,revision:number):ReturnType<VoiceTransfer['resumeTranscription']>;
 uploadVoice(request:string,project:string,mime:string,bytes:Uint8Array):ReturnType<VoiceTransfer['upload']>;
 readVoiceAudio(source:import('./voice-contract.ts').VoiceSource):ReturnType<VoiceTransfer['read']>;
};
