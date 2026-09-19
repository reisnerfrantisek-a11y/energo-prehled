const TOKEN_URL='https://idm.distribuce24.cz/oauth/token';
const DATA_BASE='https://data.distribuce24.cz/rest';
const SCOPE='namerena_data_openapi';
const ALLOWED_ORIGIN='https://reisnerfrantisek-a11y.github.io';
const PROXY_VERSION='1.1.0';

function cors(res,origin){
  if(origin===ALLOWED_ORIGIN){
    res.setHeader('Access-Control-Allow-Origin',ALLOWED_ORIGIN);
    res.setHeader('Vary','Origin');
  }
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  res.setHeader('Cache-Control','no-store');
}
function send(res,status,body){res.status(status).json(body)}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function fetchRetry(url,options={},attempts=2){
  let last;
  for(let i=0;i<attempts;i++){
    try{return await fetch(url,options)}
    catch(e){last=e;if(i<attempts-1)await sleep(350*(i+1))}
  }
  throw last;
}
function validIso(v){return typeof v==='string'&&Number.isFinite(Date.parse(v))}
function validEan(v){return typeof v==='string'&&/^\d{18}$/.test(v)}
function validProfile(v){return typeof v==='string'&&/^[A-Za-z0-9._-]{1,64}$/.test(v)}

async function getToken(clientId,clientSecret){
  const resp=await fetchRetry(TOKEN_URL,{
    method:'POST',
    headers:{'Content-Type':'application/json','Accept':'application/json'},
    body:JSON.stringify({grant_type:'client_credentials',client_id:clientId,client_secret:clientSecret,scope:SCOPE})
  });
  let body=null;try{body=await resp.json()}catch{}
  if(!resp.ok||!body?.access_token){
    const err=new Error('EG.D token request failed');
    err.status=resp.status||502;err.details=body?.error_description||body?.error||null;throw err;
  }
  return body.access_token;
}
async function getJson(path,token,params){
  const url=new URL(DATA_BASE+path);
  if(params)for(const [k,v] of Object.entries(params))if(v!==undefined&&v!==null)url.searchParams.set(k,String(v));
  const resp=await fetchRetry(url,{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},cache:'no-store'});
  const raw=await resp.text();let body=null;
  try{body=raw?JSON.parse(raw):null}catch{body=raw||null}
  if(!resp.ok){
    const err=new Error(`EG.D ${path} failed (HTTP ${resp.status})`);
    err.status=resp.status||502;
    err.details=typeof body==='string'?body.slice(0,500):(body?.message||body?.error_description||body?.error||JSON.stringify(body||{}).slice(0,500));
    throw err;
  }
  return body;
}

export default async function handler(req,res){
  const origin=req.headers.origin||'';
  cors(res,origin);
  if(req.method==='OPTIONS')return res.status(204).end();
  if(req.method==='GET'){
    return send(res,200,{ok:true,service:'energo-egd-proxy',version:PROXY_VERSION,time:new Date().toISOString()});
  }
  if(origin!==ALLOWED_ORIGIN)return send(res,403,{error:'origin_not_allowed'});
  if(req.method!=='POST')return send(res,405,{error:'method_not_allowed'});

  const body=req.body&&typeof req.body==='object'?req.body:{};
  const clientId=String(body.clientId||'').trim(),clientSecret=String(body.clientSecret||'').trim();
  if(!clientId||!clientSecret||clientId.length>200||clientSecret.length>300)return send(res,400,{error:'missing_credentials'});

  try{
    const token=await getToken(clientId,clientSecret);
    if(body.action==='diagnostics'){
      const [om,profily,statusy]=await Promise.all([
        getJson('/om',token),
        getJson('/profily',token),
        getJson('/statusy',token)
      ]);
      return send(res,200,{ok:true,om,profily,statusy});
    }
    if(body.action==='spotreby'){
      const {ean,profile,from,to}=body;
      if(!validEan(ean)||!validProfile(profile)||!validIso(from)||!validIso(to))return send(res,400,{error:'invalid_parameters'});
      const fromMs=Date.parse(from),toMs=Date.parse(to),days=(toMs-fromMs)/86400000;
      if(toMs<fromMs||days>35)return send(res,400,{error:'range_not_allowed'});
      const data=await getJson('/spotreby',token,{ean,profile,from,to,pageStart:1,pageSize:3000});
      return send(res,200,{ok:true,data});
    }
    return send(res,400,{error:'unknown_action'});
  }catch(e){
    const status=Number(e.status)||502;
    return send(res,status,{error:'egd_upstream_error',message:e.message,details:e.details||null});
  }
}
