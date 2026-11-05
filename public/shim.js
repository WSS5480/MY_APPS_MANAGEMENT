/* Render host shim: gives the app the same db/downloads interface it uses as an artifact, backed by this server. */
(function(){
 var POLL=15000;
 function J(u,o){return fetch(u,Object.assign({credentials:'same-origin',headers:{'Content-Type':'application/json'}},o||{})).then(function(r){
  if(r.status===401){location.href='/login';throw {code:'revoked',message:'signed out'}}
  if(!r.ok)throw {code:r.status===400?'invalid_argument':'unavailable',message:'HTTP '+r.status};
  return r.status===204?null:r.json()})}
 var meta={fromCache:false,hasPendingWrites:false};var polls=[];window.__dbRefresh=function(){return Promise.all(polls.map(function(f){return f()}))};
 function snap(id,data){return{id:id,exists:data!=null,data:function(){return data==null?undefined:data},metadata:meta}}
 var db={
  doc:function(p){var id=p.split('/').pop();return{id:id,path:p,
   get:function(){return J('/api/doc?path='+encodeURIComponent(p)).then(function(r){return snap(id,r&&r.data)})},
   set:function(d){return J('/api/doc',{method:'PUT',body:JSON.stringify({path:p,data:d})})},
   update:function(d){return this.get().then(function(s){return J('/api/doc',{method:'PUT',body:JSON.stringify({path:p,data:Object.assign({},s.data()||{},d)})})})},
   delete:function(){return J('/api/doc?path='+encodeURIComponent(p),{method:'DELETE'})},
   onSnapshot:function(next){var last,stop=false;function poll(){return J('/api/doc?path='+encodeURIComponent(p)).then(function(r){var s=JSON.stringify(r&&r.data);if(s!==last){last=s;next(snap(id,r&&r.data))}}).catch(function(){})}function tick(){if(stop)return;poll().then(function(){if(!stop)setTimeout(tick,POLL)})}polls.push(poll);tick();return function(){stop=true;polls.splice(polls.indexOf(poll),1)}}}},
  collection:function(c){return{onSnapshot:function(next){var prev=null,stop=false;function poll(){return J('/api/col?c='+encodeURIComponent(c)).then(function(rows){
    var cur={},docs=rows.map(function(r){cur[r.id]=JSON.stringify(r.data);return snap(r.id,r.data)}),ch=[],p0=prev||{};
    rows.forEach(function(r,i){if(!(r.id in p0))ch.push({type:'added',doc:docs[i]});else if(p0[r.id]!==cur[r.id])ch.push({type:'modified',doc:docs[i]})});
    Object.keys(p0).forEach(function(id){if(!(id in cur))ch.push({type:'removed',doc:snap(id,JSON.parse(p0[id]))})});
    var first=prev===null;prev=cur;if(first||ch.length)next({docs:docs,size:docs.length,empty:!docs.length,docChanges:function(){return ch},metadata:meta})}).catch(function(){})}function tick(){if(stop)return;poll().then(function(){if(!stop)setTimeout(tick,POLL)})}polls.push(poll);tick();return function(){stop=true;polls.splice(polls.indexOf(poll),1)}}}}
 };
 var downloads={save:function(o){return new Promise(function(res){var b=o.data instanceof Blob?o.data:new Blob([o.data]);var a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=o.filename;document.body.appendChild(a);a.click();setTimeout(function(){URL.revokeObjectURL(a.href);a.remove()},2000);res({status:'saved'})})}};
 window.claude={use:function(n){return Promise.resolve(n==='db'?db:n==='downloads'?downloads:null)}};
 window.__RENDER_HOST=true;
})();
