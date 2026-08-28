'use strict';
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { exec } = require('child_process');
const {
  createApiHandler,
  supabaseGet,
  supabasePut,
  defaultState,
} = require('./app-core.js');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = process.env.LOSFOG_DATA_DIR ? path.resolve(process.env.LOSFOG_DATA_DIR) : path.join(ROOT, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const MAX_BODY = 25 * 1024 * 1024;

const SUPABASE_URL = process.env.SUPABASE_URL ? String(process.env.SUPABASE_URL).replace(/\/+$/, '') : '';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';
const CLOUD_MODE = !!(SUPABASE_URL && SUPABASE_KEY);

function readJson(file, fallback){
  try{
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }catch(e){
    return fallback;
  }
}

function writeJsonAtomic(file, data){
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function makeLocalStorage(){
  return {
    async getState(){
      if(CLOUD_MODE){
        try{
          const s = await supabaseGet(SUPABASE_URL, SUPABASE_KEY, 'main');
          if(s && typeof s === 'object') return Object.assign({}, defaultState(), s);
        }catch(e){
          console.warn('[云数据库] 读取业务数据失败，改用本地文件：' + e.message);
        }
      }
      return readJson(STATE_FILE, defaultState());
    },
    async saveState(s){
      if(CLOUD_MODE){
        try{
          await supabasePut(SUPABASE_URL, SUPABASE_KEY, 'main', s);
          try{ writeJsonAtomic(STATE_FILE, s); }catch(e){}
          return;
        }catch(e){
          console.warn('[云数据库] 写入业务数据失败，已改存本地文件：' + e.message);
        }
      }
      writeJsonAtomic(STATE_FILE, s);
    },
    async getUsers(){
      if(CLOUD_MODE){
        try{
          const u = await supabaseGet(SUPABASE_URL, SUPABASE_KEY, 'users');
          if(Array.isArray(u)) return u;
        }catch(e){
          console.warn('[云数据库] 读取账号失败，改用本地文件：' + e.message);
        }
      }
      return readJson(USERS_FILE, []);
    },
    async saveUsers(users){
      if(CLOUD_MODE){
        try{
          await supabasePut(SUPABASE_URL, SUPABASE_KEY, 'users', users);
          try{ writeJsonAtomic(USERS_FILE, users); }catch(e){}
          return;
        }catch(e){
          console.warn('[云数据库] 写入账号失败，已改存本地文件：' + e.message);
        }
      }
      writeJsonAtomic(USERS_FILE, users);
    },
    async getSessions(){
      return readJson(SESSIONS_FILE, {});
    },
    async saveSessions(sessions){
      writeJsonAtomic(SESSIONS_FILE, sessions);
    },
  };
}

function ensureFiles(){
  fs.mkdirSync(DATA_DIR, {recursive:true});
  if(!fs.existsSync(STATE_FILE)){
    fs.writeFileSync(STATE_FILE, JSON.stringify(defaultState(), null, 2), 'utf8');
  }
  if(!fs.existsSync(USERS_FILE)){
    const users = [
      {id:'u_admin', name:'管理员', phone:'13800000000', role:'admin', password:'admin123'},
    ];
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
  }
  if(!fs.existsSync(SESSIONS_FILE)){
    fs.writeFileSync(SESSIONS_FILE, '{}', 'utf8');
  }
}

function readBody(req, limit){
  return new Promise(function(resolve, reject){
    let size = 0;
    const chunks = [];
    req.on('data', function(c){
      size += c.length;
      if(size > limit){
        reject(new Error('请求数据过大'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', function(){
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });
}

function getLanIps(){
  const ips = [];
  const ifaces = os.networkInterfaces();
  Object.keys(ifaces).forEach(function(name){
    (ifaces[name] || []).forEach(function(iface){
      if(iface.family === 'IPv4' && !iface.internal){
        ips.push(iface.address);
      }
    });
  });
  return ips;
}

ensureFiles();

const storage = makeLocalStorage();
const handleApiRequest = createApiHandler(storage);

const server = http.createServer(async function(req, res){
  try{
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    if(req.method === 'GET' && p === '/'){
      const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'));
      res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'});
      res.end(html);
      return;
    }
    if(req.method === 'GET' && p === '/favicon.ico'){
      res.writeHead(204);
      res.end();
      return;
    }
    if(p.indexOf('/api/') === 0){
      const body = await readBody(req, MAX_BODY);
      const result = await handleApiRequest({
        method: req.method,
        path: p,
        headers: req.headers,
        bodyText: body,
      });
      res.writeHead(result.status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'});
      res.end(JSON.stringify(result.body));
      return;
    }
    res.writeHead(404, {'Content-Type': 'text/plain; charset=utf-8'});
    res.end('404 Not Found');
  }catch(e){
    if(!res.headersSent){
      res.writeHead(500, {'Content-Type': 'text/plain; charset=utf-8'});
    }
    res.end('服务器错误: ' + e.message);
  }
});

function startServer(port){
  server.once('error', function(err){
    if(err && err.code === 'EADDRINUSE'){
      console.log('端口 ' + port + ' 被占用，自动改用 ' + (port + 1));
      if(port < PORT + 20){
        startServer(port + 1);
      }else{
        console.log('3000-' + (PORT + 19) + ' 端口都被占用，无法启动。请关闭占用这些端口的程序后重试。');
        process.exit(1);
      }
    }else{
      console.error('启动失败：', err && err.message ? err.message : err);
      process.exit(1);
    }
  });
  server.listen(port, '0.0.0.0', async function(){
    console.log('LOSFOG 跨境女装运营工作台已启动（端口 ' + port + '）');
    console.log('本机访问:   http://localhost:' + port);
    getLanIps().forEach(function(ip){
      console.log('局域网访问: http://' + ip + ':' + port + '（同事在同一个网络下打开这个地址）');
    });
    try{
      let users = await storage.getUsers();
      if(!users.length){
        const seed = [{
          id:'u_admin',
          name:'管理员',
          phone:'13800000000',
          role:'admin',
          password:'admin123',
          tabs:['sales','profit','aftersales','materials','materialrefs','samples','rules','rates','options'],
        }];
        await storage.saveUsers(seed);
        users = seed;
      }
      const admins = users.filter(function(x){ return x.role === 'admin'; });
      if(admins.length){
        const adm = admins[0];
        console.log('管理员账号: ' + adm.phone + (adm.password ? '  密码: ' + adm.password : '（密码已加密，可在账号管理里重置）') + '（登录后可在账号管理里修改）');
      }
    }catch(e){
      console.log('读取账号信息失败：' + e.message);
    }
    if(process.platform === 'win32' && !process.env.LOSFOG_NO_OPEN){
      try{
        exec('cmd /c start "" http://localhost:' + port);
      }catch(e){}
    }
  });
}

startServer(PORT);
