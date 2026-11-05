import test from 'node:test';
import assert from 'node:assert/strict';
import {estimateBotTraffic,botShareLabel} from '../index.mjs';

const day=i=>new Date(Date.UTC(2026,9,1+i)).toISOString().slice(0,10);
// A post whose engagement tracks views at `rate` and keeps watch time steady.
function post(base,daily,{rate=.05,avp=60,account='acc',platform='youtube',override={}}={}){
  let views=0;
  return daily.map((gain,i)=>{
    views+=gain;
    const row={base,platform,account_id:account,day:day(i),views,likes:Math.round(views*rate*.8),comments:Math.round(views*rate*.1),shares:Math.round(views*rate*.1),average_view_percentage:avp};
    return {...row,...(override[i]||{})};
  });
}
// Five ordinary posts so the channel has a known usual rate (5%).
const baseline=()=>[1,2,3,4,5].flatMap(n=>post('b'+n,[2000,1500,1000,800]));

test('steady organic posts show 0%',()=>{
  const r=estimateBotTraffic(baseline());
  assert.equal(r.estimatedBotViews,0);assert.equal(r.label,'0%');assert.equal(r.checkedPosts,5);
});

test('a real viral surge with engagement and watch time is never counted',()=>{
  const r=estimateBotTraffic([...baseline(),...post('viral',[2000,1500,90000,250000,40000])]);
  assert.equal(r.estimatedBotViews,0);assert.deepEqual(r.flagged,[]);
});

test('a surge with no engagement but steady watch time is not counted',()=>{
  const flat=post('flat',[2000,1500,60000],{override:{2:{likes:160,comments:18,shares:18}}});
  assert.equal(estimateBotTraffic([...baseline(),...flat]).estimatedBotViews,0);
});

test('a surge with no engagement and collapsed watch time counts only the unexplained views',()=>{
  // Day 2 adds 60,000 views but only 40 interactions, and watch time falls 60 → 20.
  const botted=post('botted',[2000,1500,60000],{override:{2:{likes:170,comments:20,shares:26,average_view_percentage:20}}});
  const r=estimateBotTraffic([...baseline(),...botted]);
  assert.equal(r.flagged.length,1);assert.equal(r.flagged[0].base,'botted');
  // 60,000 new views minus the ~800 that 40 interactions explain at the usual ~5%.
  assert.ok(r.estimatedBotViews>59000&&r.estimatedBotViews<59300,String(r.estimatedBotViews));
  assert.ok(r.share>0.01&&r.share<1);
});

test('without watch data the engagement bar tightens to a tenth of normal',()=>{
  // Usual rate ~5%: 200 interactions on 60,000 views is ~7% of normal (flagged),
  // 400 is ~13% (would be flagged with watch data, not without).
  const some=post('some',[2000,1500,60000],{avp:null,override:{2:{likes:340,comments:18,shares:18}}});
  const lots=post('lots',[2000,1500,60000],{avp:null,override:{2:{likes:540,comments:18,shares:18}}});
  assert.equal(estimateBotTraffic([...baseline(),...some]).flagged.length,1);
  assert.equal(estimateBotTraffic([...baseline(),...lots]).flagged.length,0);
});

test('small posts, missing engagement and unknown channel norms are never judged',()=>{
  const small=post('small',[100,100,900],{override:{2:{likes:5,comments:1,shares:1,average_view_percentage:5}}});
  assert.equal(estimateBotTraffic([...baseline(),...small]).estimatedBotViews,0);
  const blind=post('blind',[2000,1500,60000],{override:{2:{likes:null,comments:null,shares:null,average_view_percentage:20}}});
  assert.equal(estimateBotTraffic([...baseline(),...blind]).estimatedBotViews,0);
  const lonely=post('lonely',[2000,1500,60000],{account:'other',platform:'tiktok',override:{2:{likes:150,comments:18,shares:18,average_view_percentage:20}}});
  assert.equal(estimateBotTraffic([...baseline(),...lonely]).checkedPosts,5,'one TikTok post has no norm to compare against');
});

test('labels round tiny shares up to <1% and never show a false 0 when something was found',()=>{
  assert.equal(botShareLabel(0),'0%');assert.equal(botShareLabel(.0004),'<1%');assert.equal(botShareLabel(.034),'3.4%');
});
