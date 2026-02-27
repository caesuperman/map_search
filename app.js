(function(){
'use strict';

var LS_PLACES='trip_places_v1';
var LS_KEY='gmaps_api_key_v1';
var $=function(id){return document.getElementById(id);};

var el={
  apiKey:$('apiKey'),saveKey:$('saveKey'),clearKey:$('clearKey'),keyStatus:$('keyStatus'),
  q:$('q'),search:$('search'),cand:$('cand'),confirm:$('confirm'),searchStatus:$('searchStatus'),
  list:$('list'),clearAll:$('clearAll'),
  method:$('method'),mode:$('mode'),start:$('start'),end:$('end'),round:$('round'),opt:$('opt'),
  routeStatus:$('routeStatus'),it:$('it'),map:$('map')
};

var map=null, geocoder=null, ds=null, dr=null;
var markers=[], previewMarker=null, localPolyline=null;
var candidates=[]; // {name,address,lat,lng,placeId}
var places=[];     // {id,name,address,lat,lng,placeId}
var orderIds=null; // optimized ids for numbering

function uid(){return 'p_'+Math.random().toString(16).slice(2)+'_'+Date.now().toString(16);}
function st(node,msg){node.textContent=msg||'';}
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}

function loadPlaces(){
  try{
    var raw=localStorage.getItem(LS_PLACES);
    if(!raw) return;
    var arr=JSON.parse(raw);
    if(!Array.isArray(arr)) return;
    places=arr.filter(function(p){return p&&typeof p.name==='string'&&typeof p.lat==='number'&&typeof p.lng==='number';})
      .map(function(p){return {id:String(p.id||uid()),name:String(p.name),address:String(p.address||''),lat:Number(p.lat),lng:Number(p.lng),placeId:p.placeId?String(p.placeId):null};});
  }catch(e){}
}
function savePlaces(){try{localStorage.setItem(LS_PLACES,JSON.stringify(places));}catch(e){} }

function mapsUrl(p){
  var q=encodeURIComponent(p.lat+','+p.lng);
  return 'https://www.google.com/maps/search/?api=1&query='+q+(p.placeId?('&query_place_id='+encodeURIComponent(p.placeId)):'');
}

function placeById(id){for(var i=0;i<places.length;i++) if(places[i].id===id) return places[i]; return null;}
function idxInOrder(id){if(!orderIds) return null; var i=orderIds.indexOf(id); return i>=0?i:null;}

function clearMarkers(){markers.forEach(function(m){m.setMap(null);}); markers=[];}
function renderMarkers(){
  if(!map) return;
  clearMarkers();
  places.forEach(function(p,i){
    var label = idxInOrder(p.id); label = (label==null)?String(i+1):String(label+1);
    markers.push(new google.maps.Marker({map:map,position:{lat:p.lat,lng:p.lng},label:{text:label,color:'#081022',fontWeight:'900'}}));
  });
}

function fitBounds(){
  if(!map||places.length===0) return;
  var b=new google.maps.LatLngBounds();
  places.forEach(function(p){b.extend({lat:p.lat,lng:p.lng});});
  map.fitBounds(b,64);
}

function renderList(){
  el.list.innerHTML='';
  if(places.length===0){el.list.innerHTML='<div class="status">尚未加入任何景點。</div>'; return;}
  places.forEach(function(p,i){
    var n = idxInOrder(p.id); n=(n==null)?String(i+1):String(n+1);
    var div=document.createElement('div'); div.className='item';
    div.innerHTML=
      '<div class="n">'+esc(n)+'</div>'+
      '<div><div class="t">'+esc(p.name)+'</div>'+
      '<div class="s">'+(p.address?esc(p.address)+'<br>':'')+
      '<code>'+esc(p.lat.toFixed(6)+', '+p.lng.toFixed(6))+'</code> · '+
      '<a href="'+esc(mapsUrl(p))+'" target="_blank" rel="noreferrer">Google Maps</a></div></div>';
    var act=document.createElement('div');
    var rm=document.createElement('button'); rm.className='btn danger'; rm.type='button'; rm.textContent='移除';
    rm.addEventListener('click',function(){places=places.filter(function(x){return x.id!==p.id;}); orderIds=null; savePlaces(); syncUI();});
    act.appendChild(rm); div.appendChild(act);
    el.list.appendChild(div);
  });
}

function fillSel(sel, selected){
  sel.innerHTML='';
  places.forEach(function(p,i){var o=document.createElement('option'); o.value=p.id; o.textContent=String(i+1)+'. '+p.name; sel.appendChild(o);});
  if(selected) sel.value=selected;
}

function syncStartEnd(){
  if(places.length===0){el.start.disabled=true; el.end.disabled=true; el.start.innerHTML=''; el.end.innerHTML=''; return;}
  var startId=el.start.value||(places[0]&&places[0].id);
  var endId=el.end.value||(places[places.length-1]&&places[places.length-1].id);
  fillSel(el.start,startId); fillSel(el.end,endId);
  el.start.disabled=places.length<2;
  el.end.disabled=places.length<2||el.round.checked;
}

function syncUI(){
  renderList();
  syncStartEnd();
  el.opt.disabled=places.length<2;
  if(dr) dr.set('directions',null);
  if(localPolyline){ localPolyline.setMap(null); localPolyline=null; }
  el.it.innerHTML=''; st(el.routeStatus,'');
  renderMarkers();
  fitBounds();
}

function renderCandidates(){
  el.cand.innerHTML='';
  if(candidates.length===0){
    var o0=document.createElement('option'); o0.value=''; o0.textContent='請先搜尋';
    el.cand.appendChild(o0);
    el.cand.disabled=true; el.confirm.disabled=true;
    return;
  }
  candidates.forEach(function(c,i){
    var o=document.createElement('option'); o.value=String(i);
    o.textContent=c.name+' ('+c.lat.toFixed(6)+', '+c.lng.toFixed(6)+')';
    el.cand.appendChild(o);
  });
  el.cand.disabled=false; el.confirm.disabled=false; el.cand.value='0';
  previewCandidate();
}

function previewCandidate(){
  if(!map||candidates.length===0) return;
  var i=Number(el.cand.value); var c=candidates[i]; if(!c) return;
  if(previewMarker) previewMarker.setMap(null);
  previewMarker=new google.maps.Marker({
    map:map, position:{lat:c.lat,lng:c.lng},
    icon:{path:google.maps.SymbolPath.CIRCLE,scale:7,fillColor:'#7ab7ff',fillOpacity:0.95,strokeWeight:0}
  });
  map.panTo({lat:c.lat,lng:c.lng});
  map.setZoom(Math.max(map.getZoom(),14));
}

function doSearch(){
  var q=(el.q.value||'').trim();
  if(!q){st(el.searchStatus,'請先輸入地點/地址。'); return;}
  if(!geocoder){st(el.searchStatus,'地圖尚未載入（請先設定 API key）。'); return;}

  st(el.searchStatus,'搜尋中…');
  el.search.disabled=true;
  geocoder.geocode({address:q}, function(results,status){
    el.search.disabled=false;
    if(status!=='OK'||!results||results.length===0){
      candidates=[]; renderCandidates();
      st(el.searchStatus,'查無結果（'+String(status)+'）');
      return;
    }
    candidates=results.slice(0,12).map(function(r){
      var loc=r.geometry&&r.geometry.location;
      return {
        name:(r.address_components&&r.address_components[0]&&r.address_components[0].long_name)?r.address_components[0].long_name:(r.formatted_address||q),
        address:r.formatted_address||'',
        lat:loc?loc.lat():0,
        lng:loc?loc.lng():0,
        placeId:r.place_id||null
      };
    });
    renderCandidates();
    st(el.searchStatus,'找到 '+String(candidates.length)+' 個可能位置。');
  });
}

function confirmCandidate(){
  var i=Number(el.cand.value); var c=candidates[i]; if(!c) return;
  places.push({id:uid(),name:c.name||'未命名地點',address:c.address,lat:c.lat,lng:c.lng,placeId:c.placeId});
  savePlaces(); orderIds=null; syncUI();
  st(el.searchStatus,'已加入：'+c.name);
}

function havKm(a,b){
  var R=6371,toRad=function(x){return x*Math.PI/180;};
  var dLat=toRad(b.lat-a.lat), dLng=toRad(b.lng-a.lng);
  var la1=toRad(a.lat), la2=toRad(b.lat);
  var s=Math.sin(dLat/2)**2+Math.cos(la1)*Math.cos(la2)*Math.sin(dLng/2)**2;
  return 2*R*Math.atan2(Math.sqrt(s),Math.sqrt(1-s));
}

function localOptimize(){
  if(places.length<2||!map) return;
  var start=placeById(el.start.value)||places[0];
  var isRound=!!el.round.checked;
  var end=isRound?start:(placeById(el.end.value)||places[places.length-1]);
  if(!start||!end) return;
  if(!isRound&&start.id===end.id){st(el.routeStatus,'起點與終點相同，請改用環狀。'); return;}

  var pts=places.slice();
  var si=pts.findIndex(function(p){return p.id===start.id;});
  var ei=isRound?null:pts.findIndex(function(p){return p.id===end.id;});

  var n=pts.length;
  var dm=Array.from({length:n}, function(){return Array.from({length:n}, function(){return 0;});});
  for(var i=0;i<n;i++) for(var j=i+1;j<n;j++){var d=havKm(pts[i],pts[j]); dm[i][j]=d; dm[j][i]=d;}

  var un=[];
  for(i=0;i<n;i++){ if(i==si) continue; if(ei!=null && i==ei) continue; un.push(i); }

  var ord=[si], cur=si;
  while(un.length){
    var bestK=0,bestD=Infinity;
    for(var k=0;k<un.length;k++){var idx=un[k], dd=dm[cur][idx]; if(dd<bestD){bestD=dd; bestK=k;}}
    cur=un.splice(bestK,1)[0]; ord.push(cur);
  }
  if(ei!=null) ord.push(ei);

  var improved=true;
  while(improved){
    improved=false;
    for(var a=1;a<ord.length-2;a++){
      for(var b=a+1;b<ord.length-1;b++){
        var p0=ord[a-1], p1=ord[a], p2=ord[b], p3=ord[b+1];
        var curC=dm[p0][p1]+dm[p2][p3];
        var newC=dm[p0][p2]+dm[p1][p3];
        if(newC+1e-9 < curC){
          var mid=ord.slice(a,b+1).reverse();
          ord=ord.slice(0,a).concat(mid).concat(ord.slice(b+1));
          improved=true;
        }
      }
    }
  }

  if(isRound) ord=ord.concat([ord[0]]);
  orderIds=ord.map(function(x){return pts[x].id;});
  renderMarkers(); renderList();

  if(dr) dr.set('directions',null);
  if(localPolyline) localPolyline.setMap(null);
  var path=ord.map(function(x){return {lat:pts[x].lat,lng:pts[x].lng};});
  localPolyline=new google.maps.Polyline({map:map,path:path,geodesic:true,strokeColor:'#48d7b2',strokeOpacity:0.85,strokeWeight:4});

  el.it.innerHTML='';
  var total=0;
  for(i=0;i<ord.length-1;i++){
    var A=pts[ord[i]], B=pts[ord[i+1]], dk=havKm(A,B); total+=dk;
    var row=document.createElement('div'); row.className='leg';
    row.innerHTML='<strong>'+esc((i+1)+'. '+A.name)+'</strong> → <strong>'+esc(B.name)+'</strong><div class="status">距離：約 '+esc(dk.toFixed(2))+' km（直線）</div>';
    el.it.appendChild(row);
  }
  var tail=document.createElement('div'); tail.className='leg';
  tail.innerHTML='<strong>總距離</strong><div class="status">約 '+esc(total.toFixed(2))+' km（直線）</div>';
  el.it.appendChild(tail);

  st(el.routeStatus,'已完成本地最佳化（直線距離）。');
}

function fmtSec(s){
  s=Math.max(0,Math.floor(s||0));
  var h=Math.floor(s/3600), m=Math.floor((s%3600)/60);
  if(h<=0) return String(m)+' 分';
  if(m<=0) return String(h)+' 小時';
  return String(h)+' 小時 '+String(m)+' 分';
}

function googleOptimize(){
  if(!ds||!dr){st(el.routeStatus,'地圖尚未載入。'); return;}
  if(places.length<2) return;

  var start=placeById(el.start.value)||places[0];
  var isRound=!!el.round.checked;
  var end=isRound?start:(placeById(el.end.value)||places[places.length-1]);
  if(!start||!end) return;
  if(!isRound&&start.id===end.id){st(el.routeStatus,'起點與終點相同，請改用環狀。'); return;}

  var wps=places.filter(function(p){return p.id!==start.id && p.id!==end.id;})
    .map(function(p){return {location:{lat:p.lat,lng:p.lng},stopover:true,_id:p.id};});

  if(wps.length>25){st(el.routeStatus,'點太多：Google Directions 一次最多 25 個 waypoints（目前 '+wps.length+'）。請分批。'); return;}

  st(el.routeStatus,'向 Google 計算路線中…');
  el.opt.disabled=true;

  ds.route({
    origin:{lat:start.lat,lng:start.lng},
    destination:{lat:end.lat,lng:end.lng},
    waypoints:wps.map(function(w){return {location:w.location,stopover:true};}),
    optimizeWaypoints:true,
    travelMode:String(el.mode.value||'DRIVING')
  }, function(res,status){
    el.opt.disabled=false;
    if(status!=='OK'||!res||!res.routes||!res.routes[0]){st(el.routeStatus,'Google 路線計算失敗（'+String(status)+'）。可改用本地計算。'); return;}

    if(localPolyline){ localPolyline.setMap(null); localPolyline=null; }
    dr.setDirections(res);
    var route=res.routes[0];
    var order=route.waypoint_order||[];
    var ids=[start.id].concat(order.map(function(i){return wps[i]._id;})).concat([end.id]);
    orderIds=ids;
    renderMarkers(); renderList();

    el.it.innerHTML='';
    var legs=route.legs||[];
    var totalM=0,totalS=0;
    for(var i=0;i<legs.length;i++){
      var from=placeById(ids[i]), to=placeById(ids[i+1]);
      var leg=legs[i];
      if(leg.distance&&typeof leg.distance.value==='number') totalM+=leg.distance.value;
      if(leg.duration&&typeof leg.duration.value==='number') totalS+=leg.duration.value;
      var distT=leg.distance?leg.distance.text:'-';
      var durT=leg.duration?leg.duration.text:'-';
      var row=document.createElement('div'); row.className='leg';
      row.innerHTML='<strong>'+esc((i+1)+'. '+(from?from.name:'起點'))+'</strong> → <strong>'+esc(to?to.name:'終點')+'</strong><div class="status">距離：'+esc(distT)+' · 時間：'+esc(durT)+'</div>';
      el.it.appendChild(row);
    }

    var tail=document.createElement('div'); tail.className='leg';
    tail.innerHTML='<strong>總計</strong><div class="status">距離：約 '+esc((totalM/1000).toFixed(2))+' km · 時間：約 '+esc(fmtSec(totalS))+'</div>';
    el.it.appendChild(tail);

    st(el.routeStatus,'已完成 Google 最佳化（依道路/時間）。');
  });
}

function optimize(){
  el.end.disabled = places.length<2 || el.round.checked;
  el.it.innerHTML=''; st(el.routeStatus,'');
  if(String(el.method.value)==='local') return localOptimize();
  return googleOptimize();
}

function loadKey(){try{return (localStorage.getItem(LS_KEY)||'').trim();}catch(e){return '';}}
function saveKey(k){try{localStorage.setItem(LS_KEY,(k||'').trim());}catch(e){}}
function clearKey(){try{localStorage.removeItem(LS_KEY);}catch(e){}}

function loadGoogleMaps(){
  var key=loadKey();
  if(!key){st(el.keyStatus,'尚未設定 API key。'); return;}
  st(el.keyStatus,'載入 Google Maps…');
  if(window.google && window.google.maps){st(el.keyStatus,'Google Maps 已載入。'); if(window.initMap) window.initMap(); return;}
  var s=document.createElement('script');
  s.async=true; s.defer=true;
  s.src='https://maps.googleapis.com/maps/api/js?key='+encodeURIComponent(key)+'&callback=initMap&v=weekly';
  s.onerror=function(){st(el.keyStatus,'Google Maps 載入失敗（請確認 key / 網域限制 / 配額）。');};
  document.head.appendChild(s);
}

window.initMap=function(){
  map=new google.maps.Map(el.map,{center:{lat:25.033968,lng:121.564468},zoom:12,mapTypeControl:false,streetViewControl:false,fullscreenControl:true});
  geocoder=new google.maps.Geocoder();
  ds=new google.maps.DirectionsService();
  dr=new google.maps.DirectionsRenderer({map:map,suppressMarkers:true,polylineOptions:{strokeColor:'#7ab7ff',strokeOpacity:0.85,strokeWeight:5}});
  st(el.keyStatus,'Google Maps 已就緒。');
  syncUI();
};

function bind(){
  el.saveKey.addEventListener('click',function(){
    var k=(el.apiKey.value||'').trim();
    if(!k){st(el.keyStatus,'請貼上 API key。'); return;}
    saveKey(k); st(el.keyStatus,'已儲存 key，載入地圖中…');
    loadGoogleMaps();
  });
  el.clearKey.addEventListener('click',function(){clearKey(); el.apiKey.value=''; st(el.keyStatus,'已清除 key。');});

  el.search.addEventListener('click',doSearch);
  el.q.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault(); doSearch();}});
  el.cand.addEventListener('change',previewCandidate);
  el.confirm.addEventListener('click',confirmCandidate);

  el.round.addEventListener('change',function(){el.end.disabled=el.round.checked||places.length<2;});
  el.opt.addEventListener('click',optimize);

  el.clearAll.addEventListener('click',function(){
    places=[]; candidates=[]; orderIds=null; savePlaces();
    if(localPolyline){ localPolyline.setMap(null); localPolyline=null; }
    renderCandidates(); syncUI(); st(el.searchStatus,'已清空。');
  });
}

// boot
loadPlaces();
bind();
renderCandidates();
syncStartEnd();
el.opt.disabled=places.length<2;
loadGoogleMaps();

})();
