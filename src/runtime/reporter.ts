/**
 * The petri reporter snippet — inlined into each variant's <head> at publish time.
 *
 * Reads `data-run`, `data-variant`, and `data-endpoint` from its own <script> tag.
 * Auto-instruments: impression on load, clicks (with derived selector), throttled
 * scroll-depth tracking, pagehide flush with session duration + max scroll.
 *
 * Designed to NEVER throw into the host page. Every fallible op is try/catch'd to
 * a no-op. Uses sendBeacon for the pagehide event (delivery on tab close), fetch
 * with keepalive for everything else.
 *
 * Server-side this is a string constant, served inline. The TS file exists only
 * so a future build step could re-bundle/minify it without changing the import
 * shape elsewhere in the codebase.
 */

export const REPORTER_JS = `(function(){try{
var s=document.currentScript;
if(!s){var arr=document.getElementsByTagName('script');s=arr[arr.length-1];}
if(!s)return;
var run=s.getAttribute('data-run');
var variant=s.getAttribute('data-variant');
var endpoint=s.getAttribute('data-endpoint')||'/api/events';
if(!run||!variant)return;
var sessKey='petri_session_'+run;
var sess;
try{sess=sessionStorage.getItem(sessKey);if(!sess){sess=Math.random().toString(36).slice(2)+Date.now().toString(36);sessionStorage.setItem(sessKey,sess);}}
catch(e){sess=Math.random().toString(36).slice(2)+Date.now().toString(36);}
var startTs=Date.now();
var maxScroll=0;
function send(name,payload,useBeacon){
  var body;
  try{body=JSON.stringify({run_id:run,variant_id:variant,session_id:sess,event_name:name,payload:payload||{},ts:Date.now()});}
  catch(e){return;}
  try{
    if(useBeacon&&navigator.sendBeacon){
      navigator.sendBeacon(endpoint,new Blob([body],{type:'application/json'}));
    }else{
      fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:body,keepalive:true}).catch(function(){});
    }
  }catch(e){}
}
send('impression',{ua:navigator.userAgent,w:innerWidth,h:innerHeight,ref:document.referrer||''});
document.addEventListener('click',function(e){
  var t=e.target;if(!t||!t.tagName)return;
  var sel;
  try{
    var parts=[];var node=t;
    while(node&&node.nodeType===1&&parts.length<4){
      var n=node.tagName.toLowerCase();
      if(node.id){parts.unshift('#'+node.id);break;}
      if(node.className&&typeof node.className==='string'){
        var cls=node.className.split(/\\s+/).filter(Boolean).slice(0,2).join('.');
        if(cls)n+='.'+cls;
      }
      parts.unshift(n);node=node.parentNode;
    }
    sel=parts.join(' > ');
  }catch(e){sel='?';}
  send('click',{selector:sel,text:(t.textContent||'').trim().slice(0,60)});
},{capture:true,passive:true});
var lastScroll=0;
document.addEventListener('scroll',function(){
  var now=Date.now();if(now-lastScroll<250)return;lastScroll=now;
  var d=Math.max(document.body.scrollHeight,document.documentElement.scrollHeight)-innerHeight;
  var p=d>0?Math.round((scrollY/d)*100):100;
  if(p>maxScroll)maxScroll=p;
},{passive:true});
function flush(){send('pagehide',{duration_ms:Date.now()-startTs,max_scroll:maxScroll},true);}
window.addEventListener('pagehide',flush);
window.addEventListener('beforeunload',flush);
}catch(e){}})();`;
