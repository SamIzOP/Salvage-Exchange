import test from 'node:test';
import assert from 'node:assert/strict';
import {isCurrentResponse, snapshotCommand} from '../web/session.js';

const active={code:'ROOMAA',key:'test-a',generation:2};
const state={code:'ROOMAA',version:8,you:{seat:0}};
test('late polling cannot regress a resolved round',()=>{
  assert.equal(isCurrentResponse(state,{...state,version:7},active,active),false);
  assert.equal(isCurrentResponse(state,{...state,version:9},active,active),true);
});
test('old room and old same-room session cannot replace current player',()=>{
  assert.equal(isCurrentResponse(state,state,{...active,generation:1},active),false);
  assert.equal(isCurrentResponse(state,state,{...active,key:'other'},active),false);
  assert.equal(isCurrentResponse(state,state,active,null),false);
  assert.equal(isCurrentResponse(state,{...state,code:'OTHERX'},active,active),false);
});
test('retry payload is independent of editable draft',()=>{
  const draft={allocation:{'0':0},bids:[0,0,0]};
  const cmd=snapshotCommand({kind:'lock',plan:draft});
  draft.allocation['0']=2;draft.bids[2]=120;
  assert.deepEqual(cmd.plan,{allocation:{'0':0},bids:[0,0,0]});
});
