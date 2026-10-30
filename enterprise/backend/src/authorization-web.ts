/** Browser sign-in and completion pages; credentials stay with the enterprise authentication service. */
/**
 * @param productName - Deployment-owned display name, escaped for HTML text and attributes.
 * @param oidcName - Configured identity-provider name; null hides OIDC sign-in.
 * @param passwordEnabled - Whether ordinary employees may use email/password sign-in.
 * @returns Shared sign-in and completion document with enterprise branding.
 */
export function authorizationDocument(productName: string, oidcName: string | null = null, passwordEnabled = true): string {
  const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
  const name = escape(productName)
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${name}</title><link rel="icon" type="image/png" href="/dsh/brand.png"><link rel="stylesheet" href="/dsh/auth.css"><script type="module" src="/dsh/auth.js"></script></head>
<body data-product-name="${name}" data-oidc-name="${escape(oidcName ?? '')}" data-password-enabled="${String(passwordEnabled)}"><div id="trust" class="trust"></div><main><section class="content"><div class="brand"><img src="/dsh/brand.png" alt="" width="40" height="40"><span>${name}</span></div><h1 id="title"></h1>
<div id="sign-in-columns"><div id="known" hidden><div class="identity"><span id="avatar" class="avatar"></span><span><strong id="name"></strong><span id="email"></span></span><button id="approve" type="button"></button></div><button id="switch" class="link" type="button"></button></div>
<form id="login" hidden><label><span id="email-label"></span><input id="email-input" type="email" autocomplete="username" required></label><label><span id="password-label"></span><input id="password" type="password" autocomplete="current-password" required maxlength="128"></label><button id="submit" type="submit"></button></form><button id="oidc" type="button" hidden></button></div>
<div id="completed" hidden><p id="success-detail"></p><a id="open" class="button" href="dsh://open"></a></div><p id="notice" role="alert" aria-live="polite"></p></section><aside><p id="tagline"></p></aside></main></body></html>`
}

/** Theme-aware browser layout matching the desktop's welcome typography and controls. */
export const authorizationStyles = `
:root{color-scheme:light;--ink:#0f1115;--muted:#61666b;--page:#fff;--panel:#f5f6f8;--border:#e1e3e5;--button:#0f1115;--button-ink:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
:root[data-theme=dark]{color-scheme:dark;--ink:#f9fafb;--muted:#adb2b8;--page:#18191c;--panel:#24262a;--border:#43454a;--button:#f9fafb;--button-ink:#18191c}
*{box-sizing:border-box}[hidden]{display:none!important}body{margin:0;background:var(--page);color:var(--ink)}button,input,a{font:inherit}button,.button{border:0;border-radius:12px;padding:14px 24px;background:var(--button);color:var(--button-ink);font-weight:500;cursor:pointer;text-decoration:none;text-align:center}button:disabled{opacity:.55;cursor:default}button:focus-visible,a:focus-visible,input:focus-visible{outline:2px solid #477dff;outline-offset:3px}.trust{margin:24px auto;padding:14px 20px;max-width:1180px;border:1px solid var(--border);border-radius:12px;color:var(--muted);font-size:14px;line-height:1.6}main{display:flex;min-height:calc(100vh - 130px)}.content{width:min(100%,700px);margin:auto;padding:64px 48px;display:flex;flex-direction:column;gap:24px}.brand{display:flex;align-items:center;gap:12px;max-width:100%;margin:0 auto 56px;font-size:22px;font-weight:500}.brand img{flex:none;object-fit:contain}.brand span{overflow-wrap:anywhere;min-width:0}h1{font-size:22px;font-weight:500;margin:0;text-align:center}.identity{display:flex;align-items:center;gap:14px;padding:16px;background:var(--panel);border-radius:16px}.identity>span:nth-child(2){min-width:0;flex:1}.identity strong,.identity #email{display:block;overflow-wrap:anywhere}.identity #email{font-size:14px;color:var(--muted);margin-top:4px}.avatar{display:grid;place-items:center;flex:none;width:44px;height:44px;border-radius:50%;background:var(--border);font-size:20px}.link{display:block;margin:24px auto 0;padding:4px;background:transparent;color:var(--muted);text-decoration:underline}form{display:grid;gap:20px}label{display:grid;gap:8px;font-size:14px}input{min-width:0;width:100%;padding:14px;border:1px solid var(--border);border-radius:12px;background:var(--page);color:var(--ink)}#notice{min-height:44px;margin:0;color:var(--muted);font-size:14px;line-height:1.6}#completed{text-align:center}#completed .button{display:block;margin-top:40px}#success-detail{color:var(--muted);line-height:1.7}aside{display:none;background:linear-gradient(145deg,#edf0f6,#cdd7e8);color:#61666b;padding:70px;align-items:center;font-size:28px;line-height:1.8}body[data-complete=true] .trust{display:none}body[data-complete=true] main{min-height:100vh}body[data-complete=true] aside{display:flex;width:40%}body[data-complete=true] .content{width:60%;max-width:760px}@media(max-width:700px){.trust{margin:16px}.content{padding:40px 24px}.brand{margin-bottom:32px}body[data-complete=true] aside{display:none}body[data-complete=true] .content{width:100%}}@media(pointer:coarse){input{font-size:16px}}
#sign-in-columns{display:grid;gap:24px}#oidc{width:100%;margin-top:8px}
`

/** Browser-owned approval uses server-generated OAuth callbacks and never receives upstream tokens. */
export const authorizationScript = `
const productName=document.body.dataset.productName;
const oidcName=document.body.dataset.oidcName;
const passwordEnabled=document.body.dataset.passwordEnabled==='true';
const zh={trust:'请确认你信任当前企业客户端。登录后，它将获取企业分配的模型权限。',title:'使用企业账号登录 '+productName,email:'企业邮箱',password:'密码',signIn:'登录',switch:'切换其他账号登录',success:'登录成功',detail:'你可以关闭此页面，返回桌面端继续工作。',open:'打开应用',tagline:'欢迎对话 '+productName+'，共探智能上限',failed:'登录未能完成，请检查账号和密码后重试。',expired:'授权已失效，请返回桌面端重新点击登录。',oidc:'通过 '+oidcName+' 登录',oidcFailed:'企业统一登录未能完成，请重试或联系管理员。',notProvisioned:'账号尚未开通或绑定，请联系管理员。'};
const en={trust:'Continue only if you trust this enterprise application. Signing in grants access to your assigned models.',title:'Sign in to '+productName+' with your enterprise account',email:'Work email',password:'Password',signIn:'Sign in',switch:'Use another account',success:'Signed in',detail:'You can close this page and continue in the desktop application.',open:'Open application',tagline:'Welcome to '+productName,failed:'Sign-in could not be completed. Check your email and password, then retry.',expired:'Authorization expired. Start sign-in again from the application.',oidc:'Sign in with '+oidcName,oidcFailed:'Company SSO could not be completed. Retry or contact your administrator.',notProvisioned:'Your account has not been provisioned or linked. Contact your administrator.'};
const copy=navigator.language.startsWith('zh')?zh:en;
document.documentElement.lang=navigator.language.startsWith('zh')?'zh-CN':'en';
const params=new URLSearchParams(location.search);const theme=params.get('theme')==='dark'?'dark':'light';document.documentElement.dataset.theme=theme;
const get=id=>document.getElementById(id);for(const [id,key]of Object.entries({trust:'trust',title:'title','email-label':'email','password-label':'password',submit:'signIn',approve:'signIn',switch:'switch','success-detail':'detail',open:'open',tagline:'tagline',oidc:'oidc'}))get(id).textContent=copy[key];
const request=async(path,body)=>{const response=await fetch('/api/auth/'+path,{method:body?'POST':'GET',credentials:'same-origin',headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const result=await response.json();if(!response.ok){const error=new Error('request_failed');error.code=result.code||result.error?.code;throw error;}return result;};
const forward=result=>{const url=new URL(result.callbackUrl);if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||url.pathname!=='/oauth/callback'||url.username||url.password||url.hash)throw new Error('invalid_callback');location.assign(url.href);};
const complete=location.pathname==='/dsh/authorized';
document.title=complete?copy.success+' · '+productName:copy.title;
if(complete){document.body.dataset.complete='true';get('sign-in-columns').hidden=true;get('title').textContent=params.has('error')?copy.failed:copy.success;if(params.has('error'))get('success-detail').textContent=copy.expired;get('completed').hidden=false;get('trust').hidden=true;}else{
const authorizeId=params.get('authorize_id');let busy=false;
const setBusy=value=>{busy=value;for(const id of ['approve','submit','oidc','switch'])get(id).disabled=value;};
const approve=async()=>{if(busy)return;setBusy(true);get('notice').textContent='';try{forward(await request('enterprise/desktop/approve',{authorizeId}));}catch(_error){get('notice').textContent=copy.expired;setBusy(false);}};
get('approve').addEventListener('click',()=>{void approve();});
get('switch').addEventListener('click',()=>{get('known').hidden=true;get('login').hidden=!passwordEnabled;if(passwordEnabled)get('email-input').focus();else get('oidc').focus();});
get('oidc').hidden=!oidcName||!authorizeId;
get('oidc').addEventListener('click',async()=>{if(busy)return;setBusy(true);get('notice').textContent='';try{const result=await request('sign-in/social',{provider:'enterprise-oidc',additionalData:{authorizeId,theme}});const url=new URL(result.url);if(url.protocol!=='https:')throw new Error('invalid_oidc_destination');location.assign(url.href);}catch(error){get('notice').textContent=error.code==='enterprise_authorization_expired'?copy.expired:copy.oidcFailed;setBusy(false);}});
get('login').addEventListener('submit',async event=>{event.preventDefault();if(busy)return;setBusy(true);get('notice').textContent='';try{await request('sign-in/email',{email:get('email-input').value,password:get('password').value});get('password').value='';setBusy(false);await approve();}catch(_error){get('password').value='';get('notice').textContent=copy.failed;setBusy(false);}});
try{const session=await request('get-session');if(session?.user){get('name').textContent=session.user.name;get('email').textContent=session.user.email;get('avatar').textContent=session.user.name.slice(0,1).toUpperCase();get('known').hidden=false;}else get('login').hidden=!passwordEnabled;}catch(_error){get('login').hidden=!passwordEnabled;}
if(params.has('error'))get('notice').textContent=['signup_disabled','account_not_linked','enterprise_oidc_not_provisioned'].includes(params.get('error'))?copy.notProvisioned:params.get('error')==='enterprise_authorization_expired'?copy.expired:copy.oidcFailed;
if(!authorizeId)get('notice').textContent=copy.expired;
}
`
