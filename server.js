import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import {domains,moveEntries} from './src/lib/entries.js';
const dataDir=process.env.DATA_DIR || './data';
mkdirSync(dataDir,{recursive:true}); mkdirSync(path.join(dataDir,'uploads'),{recursive:true});
const db=new DatabaseSync(path.join(dataDir,'rafa.sqlite'));
db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS entries (id TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
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
const types=['todo','text','link','image'];
app.get('/api/entries',(req,res)=>res.json(db.prepare('SELECT data FROM entries').all().map(r=>JSON.parse(r.data)).sort((a,b)=>a.createdAt.localeCompare(b.createdAt))));
app.post('/api/entries',(req,res)=>{const now=new Date().toISOString();const status=req.body.status||'open';const item={...req.body,id:randomUUID(),createdAt:now,updatedAt:now,completedAt:req.body.type==='todo'&&status==='done'?now:null,removedAt:status==='removed'?now:null,status};save(item,res);});
app.post('/api/entries/move',(req,res)=>{
  try{
    const old=db.prepare('SELECT data FROM entries').all().map(row=>JSON.parse(row.data));
    const next=moveEntries(old,req.body);
    const byId=new Map(next.map(item=>[item.id,item]));
    for(const item of next){const visited=new Set();const reaches=id=>{if(id===item.id)return true;if(visited.has(id))return false;visited.add(id);const entry=byId.get(id);return entry&&[entry.parentId,...(entry.dependencies||[])].filter(Boolean).some(reaches);};if([item.parentId,...(item.dependencies||[])].filter(Boolean).some(reaches))throw new Error('任务关系不能形成循环');}
    const now=new Date().toISOString();
    db.exec('BEGIN');
    try{for(const item of next){const before=old.find(entry=>entry.id===item.id);if(JSON.stringify(item)!==JSON.stringify(before)){item.updatedAt=now;db.prepare('UPDATE entries SET data=? WHERE id=?').run(JSON.stringify(item),item.id);}}db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
    res.json(next);
  }catch(error){res.status(400).json({error:error.message});}
});
app.put('/api/entries/:id',(req,res)=>{const row=db.prepare('SELECT data FROM entries WHERE id=?').get(req.params.id);if(!row)return res.status(404).json({error:'条目不存在'});const old=JSON.parse(row.data); const now=new Date().toISOString();const item={...old,...req.body,id:old.id,createdAt:old.createdAt,updatedAt:now};item.completedAt=item.type==='todo'?(item.status==='done'?(old.completedAt||now):item.status==='removed'?old.completedAt:null):null;item.removedAt=item.status==='removed'?(old.status==='removed'?old.removedAt:now):null;save(item,res);});
function save(item,res){if(!(item.title?.trim()||item.content?.trim()||item.url||item.image))return res.status(400).json({error:'请填写内容'});if(!domains.includes(item.domain)||!types.includes(item.type)||!['open','doing','waiting','done','removed'].includes(item.status)||typeof item.title!=='string'||item.title.length>1000||typeof item.content!=='string'||item.content.length>50000)return res.status(400).json({error:'请检查条目内容'});if(item.url&&!/^https?:\/\//i.test(item.url))return res.status(400).json({error:'链接必须使用 http 或 https'});if(item.parentId===item.id||(item.dependencies||[]).includes(item.id))return res.status(400).json({error:'不能关联自己'});const links=[item.parentId,...(item.dependencies||[])].filter(Boolean);const reaches=(id,seen=new Set())=>{if(id===item.id)return true;if(seen.has(id))return false;seen.add(id);const row=db.prepare('SELECT data FROM entries WHERE id=?').get(id);if(!row)return false;const entry=JSON.parse(row.data);return [entry.parentId,...(entry.dependencies||[])].filter(Boolean).some(next=>reaches(next,seen));};if(links.some(id=>reaches(id)))return res.status(400).json({error:'任务关系不能形成循环'});db.prepare('INSERT OR REPLACE INTO entries VALUES (?,?)').run(item.id,JSON.stringify(item));res.json(item);}
app.post('/api/upload',(req,res)=>{const {base64,mime}=req.body;const ext={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif'}[mime];if(!ext)return res.status(400).json({error:'支持 PNG、JPEG、WebP、GIF 图片'});const bytes=Buffer.from(base64||'','base64');if(bytes.length>8*1024*1024)return res.status(400).json({error:'图片不能超过 8MB'});const file=randomUUID()+'.'+ext;writeFileSync(path.join(dataDir,'uploads',file),bytes);res.json({url:'/uploads/'+file});});
app.use('/uploads',requireAuth,express.static(path.join(dataDir,'uploads')));
app.use(express.static('dist')); app.get('/{*splat}',(req,res)=>res.sendFile(path.resolve('dist/index.html')));
app.use((err,req,res,next)=>res.status(500).json({error:'保存失败，请重试'}));
app.listen(process.env.PORT||3001,process.env.HOST||'127.0.0.1',()=>console.log('RafaTodo http://localhost:'+(process.env.PORT||3001)));
