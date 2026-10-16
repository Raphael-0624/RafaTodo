import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import {domains,moveEntries} from './src/lib/entries.js';
const dataDir=process.env.DATA_DIR || './data';
mkdirSync(dataDir,{recursive:true}); mkdirSync(path.join(dataDir,'uploads'),{recursive:true});
const db=new DatabaseSync(path.join(dataDir,'rafa.sqlite'));
db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS entries (id TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS activity_daily (date TEXT NOT NULL, domain TEXT NOT NULL, created_count INTEGER NOT NULL DEFAULT 0, completed_count INTEGER NOT NULL DEFAULT 0, updated_count INTEGER NOT NULL DEFAULT 0, removed_count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (date, domain))');
for(const row of db.prepare('SELECT id,data FROM entries').all()){
  const item=JSON.parse(row.data);
  if(item.domain==='Glean'||item.domain==='Idea'){
    item.domain='Glean & Idea';
    db.prepare('UPDATE entries SET data=? WHERE id=?').run(JSON.stringify(item),row.id);
  }
}
const app=express();
app.set('trust proxy','loopback');
app.use(express.json({limit:'12mb'}));
function verifyPassword(password,stored){try{const [salt,hex]=stored.split(':');const actual=scryptSync(password,salt,64);const expected=Buffer.from(hex,'hex');return actual.length===expected.length&&timingSafeEqual(actual,expected);}catch{return false;}}
const sessions=new Map();
const loginFailures=new Map();
function cookie(req,name){return (req.headers.cookie||'').split(';').map(value=>value.trim().split('=')).find(([key])=>key===name)?.[1]||'';}
function setSessionCookie(res,token){res.setHeader('Set-Cookie',`rafa_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${process.env.NODE_ENV==='production'?'; Secure':''}`);}
function isAuthenticated(req){const token=cookie(req,'rafa_session');const expires=sessions.get(token);if(expires&&expires>Date.now())return true;if(token)sessions.delete(token);return false;}
function requireAuth(req,res,next){if(isAuthenticated(req))return next();res.status(401).json({error:'需要登录'});}
app.use('/api',(req,res,next)=>{if(['/auth/status','/auth/login','/auth/logout'].includes(req.path))return next();requireAuth(req,res,next);});
app.get('/api/auth/status',(req,res)=>res.json({authenticated:Boolean(isAuthenticated(req)),configured:Boolean(db.prepare('SELECT 1 FROM settings WHERE key=?').get('passwordHash'))}));
app.post('/api/auth/login',(req,res)=>{const stored=db.prepare('SELECT value FROM settings WHERE key=?').get('passwordHash')?.value;if(!stored)return res.status(503).json({error:'尚未设置登录密码，请运行 scripts/set-password.mjs'});const key=req.ip,now=Date.now(),failure=loginFailures.get(key);if(failure?.until>now&&failure.count>=5)return res.status(429).json({error:'尝试次数过多，请稍后再试'});if(typeof req.body.password!=='string'||!verifyPassword(req.body.password,stored)){const count=failure?.until>now?failure.count+1:1;loginFailures.set(key,{count,until:now+15*60*1000});return res.status(401).json({error:'密码错误'});}loginFailures.delete(key);const token=randomBytes(32).toString('hex');sessions.set(token,Date.now()+30*24*60*60*1000);setSessionCookie(res,token);res.json({authenticated:true});});
app.post('/api/auth/logout',(req,res)=>{const token=cookie(req,'rafa_session');sessions.delete(token);res.setHeader('Set-Cookie','rafa_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');res.json({authenticated:false});});
const types=['todo','text','link','image','group','bullet','divider'];
app.post('/api/link-preview',async(req,res)=>{
  const url=typeof req.body?.url==='string'?req.body.url.trim():'';
  if(!/^https?:\/\//i.test(url))return res.status(400).json({error:'链接必须使用 http 或 https'});
  try{
    const response=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(5000),headers:{'User-Agent':'RafaTodo/1.0'}});
    const type=response.headers.get('content-type')||'';
    if(!type.includes('text/html'))return res.json({title:''});
    const html=(await response.text()).slice(0,512000);
    const match=html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title=(match?.[1]||'').replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'\"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/\s+/g,' ').trim().slice(0,200);
    res.json({title});
  }catch{res.json({title:''});}
});
app.post('/api/ai/parse',async(req,res)=>{
  const input=typeof req.body?.input==='string'?req.body.input.trim():'';
  if(!input)return res.status(400).json({error:'请输入要录入的内容'});
  const key=process.env.DEEPSEEK_API_KEY;
  if(!key)return res.status(503).json({error:'尚未配置 DEEPSEEK_API_KEY'});
  const system=`你是 RafaTodo 的录入助手。把用户输入拆成一条或多条待办事项，只返回 JSON，不要 Markdown。JSON 格式必须是 {"items":[{"title":"任务标题","content":"完整补充说明","domain":"Work|Life|Glean & Idea","owner":"负责人或空字符串","people":"其他参与人，用逗号分隔或空字符串","tags":"标签，用逗号分隔","dueDate":"YYYY-MM-DD 或空字符串","planDate":"YYYY-MM-DD 或空字符串","followupDate":"YYYY-MM-DD 或空字符串","stage":"阶段或空字符串","priority":"normal|high|urgent"}]}。没有明确的信息就留空；不要编造日期、负责人或状态。普通想法也转成一条 todo。`;
  try{
    const response=await fetch(process.env.DEEPSEEK_API_URL||'https://api.deepseek.com/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},body:JSON.stringify({model:process.env.DEEPSEEK_MODEL||'deepseek-flash',messages:[{role:'system',content:system},{role:'user',content:input}],thinking:{type:'enabled'},reasoning_effort:'high',stream:false})});
    const payload=await response.json();
    if(!response.ok)throw new Error(payload.error?.message||'DeepSeek 请求失败');
    const raw=payload.choices?.[0]?.message?.content||'';
    const parsed=JSON.parse(raw.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));
    const items=(Array.isArray(parsed)?parsed:parsed.items).filter(item=>item&&typeof item.title==='string'&&item.title.trim()).slice(0,20).map(item=>({title:item.title.trim().slice(0,1000),content:typeof item.content==='string'?item.content.trim().slice(0,50000):'',domain:domains.includes(item.domain)?item.domain:'Work',owner:typeof item.owner==='string'?item.owner.trim().slice(0,100):'',people:typeof item.people==='string'?item.people.trim().slice(0,500):'',tags:typeof item.tags==='string'?item.tags.slice(0,500):'',dueDate:/^\d{4}-\d{2}-\d{2}$/.test(item.dueDate||'')?item.dueDate:'',planDate:/^\d{4}-\d{2}-\d{2}$/.test(item.planDate||'')?item.planDate:'',followupDate:/^\d{4}-\d{2}-\d{2}$/.test(item.followupDate||'')?item.followupDate:'',stage:typeof item.stage==='string'?item.stage.trim().slice(0,100):'',priority:['normal','high','urgent'].includes(item.priority)?item.priority:'normal',type:'todo',status:'open',parentId:''}));
    if(!items.length)throw new Error('AI 没有识别出可录入的任务');
    res.json({items});
  }catch(error){res.status(502).json({error:error.message||'AI 录入失败'});}
});
function activityDate(value=new Date()){return new Date(value).toISOString().slice(0,10);}
function recordActivity(domain,counts,date=activityDate()){
  if(!domains.includes(domain))return;
  const values={created_count:0,completed_count:0,updated_count:0,removed_count:0,...counts};
  db.prepare(`INSERT INTO activity_daily (date,domain,created_count,completed_count,updated_count,removed_count) VALUES (?,?,?,?,?,?) ON CONFLICT(date,domain) DO UPDATE SET created_count=created_count+excluded.created_count,completed_count=completed_count+excluded.completed_count,updated_count=updated_count+excluded.updated_count,removed_count=removed_count+excluded.removed_count`).run(date,domain,values.created_count,values.completed_count,values.updated_count,values.removed_count);
}
app.delete('/api/entries/:id',(req,res)=>{const row=db.prepare('SELECT data FROM entries WHERE id=?').get(req.params.id);if(!row)return res.status(404).json({error:'条目不存在'});const deleted=JSON.parse(row.data),now=new Date().toISOString();db.exec('BEGIN');try{db.prepare('DELETE FROM entries WHERE id=?').run(deleted.id);for(const row of db.prepare('SELECT id,data FROM entries').all()){const item=JSON.parse(row.data);if(item.parentId===deleted.id||(item.dependencies||[]).includes(deleted.id)||(item.related||[]).includes(deleted.id)){if(item.parentId===deleted.id)item.parentId=deleted.parentId||'';item.dependencies=(item.dependencies||[]).filter(id=>id!==deleted.id);item.related=(item.related||[]).filter(id=>id!==deleted.id);item.updatedAt=now;db.prepare('UPDATE entries SET data=? WHERE id=?').run(JSON.stringify(item),item.id);}}db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}res.json(db.prepare('SELECT data FROM entries').all().map(row=>JSON.parse(row.data)).filter(item=>!item.archivedAt));});
app.get('/api/entries',(req,res)=>res.json(db.prepare('SELECT data FROM entries').all().map(r=>JSON.parse(r.data)).filter(item=>!item.archivedAt).sort((a,b)=>a.createdAt.localeCompare(b.createdAt))));
app.get('/api/archive',(req,res)=>res.json(db.prepare('SELECT data FROM entries WHERE data LIKE ?').all('%"archivedAt"%').map(r=>JSON.parse(r.data)).filter(item=>item.archivedAt).sort((a,b)=>new Date(b.archivedAt)-new Date(a.archivedAt))));
app.post('/api/archive',(req,res)=>{
  const domain=req.body?.domain;
  if(!domains.includes(domain))return res.status(400).json({error:'请选择归档领域'});
  const now=new Date().toISOString(),rows=db.prepare('SELECT id,data FROM entries').all(),items=rows.map(row=>JSON.parse(row.data));
  const children=new Map();for(const item of items){if(!children.has(item.parentId))children.set(item.parentId,[]);children.get(item.parentId).push(item);}
  const eligible=new Map();
  function canArchive(item,visiting=new Set()){
    if(eligible.has(item.id))return eligible.get(item.id);
    if(visiting.has(item.id))return false;
    visiting.add(item.id);
    const allowed=Boolean(item.archivedAt||(['done','removed'].includes(item.status)&&item.domain===domain&&(children.get(item.id)||[]).every(child=>canArchive(child,visiting))));
    visiting.delete(item.id);eligible.set(item.id,allowed);return allowed;
  }
  let count=0;db.exec('BEGIN');try{for(const item of items){if(!item.archivedAt&&canArchive(item)){item.archivedAt=now;item.updatedAt=now;db.prepare('UPDATE entries SET data=? WHERE id=?').run(JSON.stringify(item),item.id);count++;}}db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
  res.json({count,items:items.filter(item=>!item.archivedAt).sort((a,b)=>a.createdAt.localeCompare(b.createdAt))});
});
app.get('/api/activity',(req,res)=>{const from=typeof req.query.from==='string'?req.query.from:'';const to=typeof req.query.to==='string'?req.query.to:'';const domain=domains.includes(req.query.domain)?req.query.domain:'';const rows=db.prepare(`SELECT date,domain,created_count AS created,completed_count AS completed,updated_count AS updated,removed_count AS removed FROM activity_daily WHERE (?='' OR date>=?) AND (?='' OR date<=?) AND (?='' OR domain=?) ORDER BY date`).all(from,from,to,to,domain,domain);res.json(rows);});
app.post('/api/entries',(req,res)=>{const now=new Date().toISOString();const status=req.body.status||'open';const position=typeof req.body.position==='number'?req.body.position:Math.max(-1,...db.prepare('SELECT data FROM entries').all().map(row=>JSON.parse(row.data)).filter(item=>item.domain===req.body.domain&&(item.parentId||'')===(req.body.parentId||'')).map(item=>item.position??0))+1;const item={...req.body,id:randomUUID(),createdAt:now,updatedAt:now,completedAt:req.body.type==='todo'&&status==='done'?now:null,removedAt:status==='removed'?now:null,status,position};save(item,res,()=>recordActivity(item.domain,{created_count:1}));});
app.post('/api/entries/move',(req,res)=>{
  try{
    const old=db.prepare('SELECT data FROM entries').all().map(row=>JSON.parse(row.data));
    const next=moveEntries(old,req.body);
    if(domains.some(domain=>next.filter(item=>!item.archivedAt&&item.domain===domain&&item.pinnedAt).length>3))throw new Error('每个栏目最多置顶 3 条');
    const byId=new Map(next.map(item=>[item.id,item]));
    for(const item of next){const visited=new Set();const reaches=id=>{if(id===item.id)return true;if(visited.has(id))return false;visited.add(id);const entry=byId.get(id);return entry&&[entry.parentId,...(entry.dependencies||[])].filter(Boolean).some(reaches);};if([item.parentId,...(item.dependencies||[])].filter(Boolean).some(reaches))throw new Error('任务关系不能形成循环');}
    const now=new Date().toISOString();
    db.exec('BEGIN');
    try{for(const item of next){const before=old.find(entry=>entry.id===item.id);if(JSON.stringify(item)!==JSON.stringify(before)){item.updatedAt=now;db.prepare('UPDATE entries SET data=? WHERE id=?').run(JSON.stringify(item),item.id);recordActivity(item.domain,{updated_count:1});}}db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
    res.json(next.filter(item=>!item.archivedAt));
  }catch(error){res.status(400).json({error:error.message});}
});
app.put('/api/entries/:id',(req,res)=>{const row=db.prepare('SELECT data FROM entries WHERE id=?').get(req.params.id);if(!row)return res.status(404).json({error:'条目不存在'});const old=JSON.parse(row.data); const now=new Date().toISOString();const item={...old,...req.body,id:old.id,createdAt:old.createdAt,updatedAt:now};item.completedAt=item.type==='todo'?(item.status==='done'?(old.completedAt||now):item.status==='removed'?old.completedAt:null):null;item.removedAt=item.status==='removed'?(old.status==='removed'?old.removedAt:now):null;const counts={updated_count:1};if(old.status!=='done'&&item.status==='done')counts.completed_count=1;if(old.status!=='removed'&&item.status==='removed')counts.removed_count=1;save(item,res,()=>recordActivity(item.domain,counts));});
function save(item,res,onSaved){if(item.type==='todo'&&item.status==='done')item.pinnedAt='';if(item.type!=='divider'&&!(item.title?.trim()||item.content?.trim()||item.url||item.image))return res.status(400).json({error:'请填写内容'});if(!domains.includes(item.domain)||!types.includes(item.type)||!['open','doing','waiting','done','removed'].includes(item.status)||typeof item.title!=='string'||item.title.length>1000||typeof item.content!=='string'||item.content.length>50000)return res.status(400).json({error:'请检查条目内容'});if(item.pinnedAt&&!item.archivedAt&&db.prepare('SELECT data FROM entries').all().map(row=>JSON.parse(row.data)).filter(entry=>entry.id!==item.id&&!entry.archivedAt&&entry.domain===item.domain&&entry.pinnedAt).length>=3)return res.status(400).json({error:'每个栏目最多置顶 3 条'});if(item.url&&!/^https?:\/\//i.test(item.url))return res.status(400).json({error:'链接必须使用 http 或 https'});if(item.parentId===item.id||(item.dependencies||[]).includes(item.id))return res.status(400).json({error:'不能关联自己'});const links=[item.parentId,...(item.dependencies||[])].filter(Boolean);const reaches=(id,seen=new Set())=>{if(id===item.id)return true;if(seen.has(id))return false;seen.add(id);const row=db.prepare('SELECT data FROM entries WHERE id=?').get(id);if(!row)return false;const entry=JSON.parse(row.data);return [entry.parentId,...(entry.dependencies||[])].filter(Boolean).some(next=>reaches(next,seen));};if(links.some(id=>reaches(id)))return res.status(400).json({error:'任务关系不能形成循环'});db.prepare('INSERT OR REPLACE INTO entries VALUES (?,?)').run(item.id,JSON.stringify(item));onSaved?.();res.json(item);}
app.post('/api/upload',(req,res)=>{const {base64,mime}=req.body;const ext={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif'}[mime];if(!ext)return res.status(400).json({error:'支持 PNG、JPEG、WebP、GIF 图片'});const bytes=Buffer.from(base64||'','base64');if(bytes.length>8*1024*1024)return res.status(400).json({error:'图片不能超过 8MB'});const file=randomUUID()+'.'+ext;writeFileSync(path.join(dataDir,'uploads',file),bytes);res.json({url:'/uploads/'+file});});
app.use('/uploads',requireAuth,express.static(path.join(dataDir,'uploads')));
app.use(express.static('dist')); app.get('/{*splat}',(req,res)=>res.sendFile(path.resolve('dist/index.html')));
app.use((err,req,res,next)=>res.status(500).json({error:'保存失败，请重试'}));
app.listen(process.env.PORT||3001,process.env.HOST||'127.0.0.1',()=>console.log('RafaTodo http://localhost:'+(process.env.PORT||3001)));
