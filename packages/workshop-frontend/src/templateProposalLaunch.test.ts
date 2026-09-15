import {beforeEach,describe,it,expect,vi} from 'vitest'
import {launchTemplateProposal} from './templateProposalLaunch'
const mocks=vi.hoisted(()=>({download:vi.fn(),decode:vi.fn()}))
vi.mock('./gatekeeperAppDownload',()=>({downloadGatekeeperTemplateText:(...args:unknown[])=>mocks.download(...args)}))
vi.mock('@gadgets/workshop-shared/blueprint-template',()=>({BLUEPRINT_TEMPLATE_MIME:'application/vnd.mnemos.blueprint-template+json',decodeBlueprintTemplate:(...args:unknown[])=>mocks.decode(...args)}))
beforeEach(()=>{vi.resetAllMocks();mocks.download.mockResolvedValue('{"точная":"версия"}');mocks.decode.mockResolvedValue({})})
function setup(){
 const dispose=vi.fn(),navigate=vi.fn().mockResolvedValue(undefined)
 const create=vi.fn().mockResolvedValue({getMetadata:async()=>({id:'copy'}),[Symbol.dispose]:dispose})
 const issuer={issue:vi.fn().mockResolvedValue({content_type:'application/vnd.mnemos.blueprint-template+json'}),validate:vi.fn().mockResolvedValue(undefined)}
 const run=()=>launchTemplateProposal({newGadgetFromTemplateSnapshot:create} as never,{storageOrigin:'https://objects.example',issuer} as never,'project','node','proposal',new AbortController().signal,navigate)
 return {dispose,navigate,create,issuer,run}
}
describe('Копия предложенного шаблона в гаджете',()=>{
 it('передаёт точный снимок без подключений и открывает созданный гаджет',async()=>{
  const s=setup();await s.run()
  expect(s.issuer.issue).toHaveBeenCalledWith('project','node','template-proposal:proposal',0)
  expect(s.issuer.validate).toHaveBeenCalledWith('project','node','template-proposal:proposal')
  expect(s.issuer.validate.mock.invocationCallOrder[0]).toBeLessThan(s.create.mock.invocationCallOrder[0])
  expect(await new Response(s.create.mock.calls[0][0]).text()).toBe('{"точная":"версия"}')
  expect(s.create.mock.calls[0][1]).toEqual({});expect(s.navigate).toHaveBeenCalledWith('copy');expect(s.dispose).toHaveBeenCalledOnce()
 })
 it('не создаёт гаджет после отзыва доступа во время загрузки',async()=>{
  const s=setup();s.issuer.validate.mockRejectedValue(Error('forbidden'));await expect(s.run()).rejects.toThrow('forbidden');expect(s.create).not.toHaveBeenCalled();expect(s.navigate).not.toHaveBeenCalled()
 })
 it('не запускает неподдерживаемое содержимое',async()=>{
  const s=setup();mocks.decode.mockRejectedValue(Error('invalid'));await expect(s.run()).rejects.toThrow('invalid');expect(s.create).not.toHaveBeenCalled()
 })
})
