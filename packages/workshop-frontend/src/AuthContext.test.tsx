// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { RpcStub, RpcTarget } from 'capnweb'
import { afterEach, expect, it } from 'vitest'
import type { AiChatAuthorInfo, AuthenticatedApi } from '@gadgets/workshop-shared/api'
import { AuthProvider, useAuthenticatedApi } from './AuthContext'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const sessions: RpcStub<AuthenticatedApi>[] = []
const cleanups: (() => void)[] = []
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); for (const session of sessions.splice(0)) session[Symbol.dispose]() })
function deferred<T>() {
  let resolve!: (value:T)=>void, reject!: (reason:Error)=>void
  const promise = new Promise<T>((yes,no)=>{resolve=yes;reject=no})
  return {promise,resolve,reject}
}
function session(profile:Promise<AiChatAuthorInfo>, admin:Promise<boolean>) {
  class Account extends RpcTarget {
    whoami() { return profile }
    amIAdmin() { return admin }
  }
  const stub = new RpcStub(new Account()) as RpcStub<AuthenticatedApi>
  sessions.push(stub)
  return stub
}
function fixture() {
  const container=document.createElement('div');document.body.append(container)
  const root=createRoot(container)
  const observations: ReturnType<typeof useAuthenticatedApi>[]=[]
  function Probe() {observations.push(useAuthenticatedApi());return null}
  cleanups.push(()=>{act(()=>root.unmount());container.remove()})
  return {observations,render:async(api:RpcStub<AuthenticatedApi>)=>{await act(async()=>root.render(<AuthProvider authenticatedApi={api} onLogout={()=>{}}><Probe /></AuthProvider>))},current:()=>observations.at(-1)!}
}
const firstUser:AiChatAuthorInfo={type:'user',id:'first',name:'First'}
const nextUser:AiChatAuthorInfo={type:'user',id:'next',name:'Next'}

it('hides the former user and admin controls on the first render of a new session', async()=>{
  const f=fixture()
  await f.render(session(Promise.resolve(firstUser),Promise.resolve(true)))
  expect(f.current()).toMatchObject({currentUser:firstUser,isAdmin:true,initialization:'ready'})
  const profile=deferred<AiChatAuthorInfo>(), admin=deferred<boolean>()
  const index=f.observations.length
  await f.render(session(profile.promise,admin.promise))
  for(const state of f.observations.slice(index)) expect(state).toMatchObject({currentUser:null,isAdmin:false,initialization:'loading'})
  await act(async()=>profile.resolve(nextUser))
  expect(f.current()).toMatchObject({currentUser:nextUser,isAdmin:false,initialization:'loading'})
  await act(async()=>admin.resolve(false))
  expect(f.current()).toMatchObject({currentUser:nextUser,isAdmin:false,initialization:'ready'})
})

it('ignores late identity and admin responses from a superseded session', async()=>{
  const f=fixture(), oldProfile=deferred<AiChatAuthorInfo>(), oldAdmin=deferred<boolean>()
  await f.render(session(oldProfile.promise,oldAdmin.promise))
  await f.render(session(Promise.resolve(nextUser),Promise.resolve(false)))
  await act(async()=>{oldProfile.resolve(firstUser);oldAdmin.resolve(true)})
  expect(f.current()).toMatchObject({currentUser:nextUser,isAdmin:false,initialization:'ready'})
})

it('does not report readiness when an identity lookup fails, and recovers in a new session', async()=>{
  const f=fixture(), profile=deferred<AiChatAuthorInfo>()
  await f.render(session(profile.promise,Promise.resolve(false)))
  await act(async()=>profile.reject(new Error('unavailable')))
  expect(f.current()).toMatchObject({currentUser:null,isAdmin:false,initialization:'error'})
  await f.render(session(Promise.resolve(nextUser),Promise.resolve(false)))
  expect(f.current()).toMatchObject({currentUser:nextUser,isAdmin:false,initialization:'ready'})
})
