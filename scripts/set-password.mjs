import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {randomBytes,scryptSync} from 'node:crypto';
import path from 'node:path';

const password=process.env.INITIAL_PASSWORD;
if(!password){console.error('请先设置 INITIAL_PASSWORD');process.exit(1);}
const dataDir=process.env.DATA_DIR||'./data';
mkdirSync(dataDir,{recursive:true});
const db=new DatabaseSync(path.join(dataDir,'rafa.sqlite'));
db.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
const salt=randomBytes(16).toString('hex');
const hash=`${salt}:${scryptSync(password,salt,64).toString('hex')}`;
db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').run('passwordHash',hash);
db.close();
console.log('密码哈希已写入数据库；请重启服务，使原有登录会话失效。');
