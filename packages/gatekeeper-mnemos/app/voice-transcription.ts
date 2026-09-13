import type {VoiceManagement} from '../src/voice-management.ts';
import type {VoiceSource} from '../src/voice-contract.ts';
import type {TeamBudgetProposal} from '../src/mnemos-api.ts';

type API=Pick<VoiceManagement,'prepareVoiceTranscription'|'resumeVoiceTranscription'|'readTeamBudget'|'runTeamBudgetMember'>;
const formats:Record<string,string>={'audio/wav':'wav','audio/x-wav':'wav','audio/wave':'wav','audio/webm':'webm','audio/ogg':'ogg','audio/mpeg':'mp3','audio/mp3':'mp3','audio/flac':'flac','audio/mp4':'m4a'};
/** Keeps one set of approved original/revision terms across creation and dispatch retries. */
export class VoiceTranscriptionFlow {
 private attempted=false;
 proposal?:TeamBudgetProposal;
 constructor(private api:API,readonly source:VoiceSource,readonly expectedRevision:number){}
 get creationID(){return this.attempted?'saved':undefined;}
 async create(binding:string,limit:string){this.attempted=true;const out=await this.api.prepareVoiceTranscription(this.source.request_id,this.expectedRevision,binding,limit);this.validate(out);this.proposal=out;return out;}
 async resume(){const out=await this.api.resumeVoiceTranscription(this.source.request_id,this.expectedRevision);this.validate(out);this.attempted=true;this.proposal=out;return out;}
 private validate(out:TeamBudgetProposal){
  const terms=out.proposal,intent=JSON.parse(terms.task);
  if(out.project_id!==this.source.project_id||out.agent_id!==''||terms.tracker||terms.replay||terms.rework||terms.replay_request||terms.absence_request_id||terms.members.length!==1||intent.kind!=='mnemos.voice.transcription.v1'||intent.source_request_id!==this.source.request_id||intent.original_sha256!==this.source.sha256||intent.audio_format!==formats[this.source.media_type]||intent.expected_revision!==this.expectedRevision)throw Error('Voice budget differs from the original');
 }
 async load(id:string){const out=await this.api.readTeamBudget(this.source.project_id,id);this.validate(out);this.proposal=out;return out;}
 async run(){
  const id=this.proposal?.id;if(!id)throw Error('Voice budget missing');
  const current=await this.load(id);if(current.state!=='approved')throw Error('Voice budget not approved');
  return this.api.runTeamBudgetMember(this.source.project_id,id,current.proposal.members[0].binding_id);
 }
}
