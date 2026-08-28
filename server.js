'use strict';
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { exec } = require('child_process');

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

const MATERIALS = [
  {id:'m1',  name:'气泡袋 50*65+5', initialStock:0, warning:0, supplier:'', image:''},
  {id:'m2',  name:'气泡袋 44*50+5', initialStock:0, warning:0, supplier:'', image:''},
  {id:'m3',  name:'气泡袋 40*45+5', initialStock:0, warning:0, supplier:'', image:''},
  {id:'m4',  name:'磨砂袋 45*60',   initialStock:0, warning:0, supplier:'', image:''},
  {id:'m5',  name:'磨砂袋 40*45',   initialStock:0, warning:0, supplier:'', image:''},
  {id:'m6',  name:'磨砂袋 35*40',   initialStock:0, warning:0, supplier:'', image:''},
  {id:'m7',  name:'领标 3*6',       initialStock:0, warning:0, supplier:'', image:''},
  {id:'m8',  name:'领标 1*6',       initialStock:0, warning:0, supplier:'', image:''},
  {id:'m9',  name:'尺码标 S',       initialStock:0, warning:0, supplier:'', image:''},
  {id:'m10', name:'尺码标 M',       initialStock:0, warning:0, supplier:'', image:''},
  {id:'m11', name:'尺码标 L',       initialStock:0, warning:0, supplier:'', image:''},
  {id:'m12', name:'尺码标 XL',      initialStock:0, warning:0, supplier:'', image:''},
];

function defaultState(){
  return {
    orders: [],
    samples: [],
    materials: MATERIALS.map(function(m){ return Object.assign({}, m); }),
    rules: [
      {id:'r1', key:'LF-JK-002', bubble:'m1', frosted:'m4', label:'m7'},
    ],
    afterSales: [],
    materialRefs: [],
    supplierOptions: [],
    modelOptions: [],
    colorOptions: [],
    rates: [],
    defaultRate: 7.1,
  };
}

const ALL_TABS = ['sales', 'profit', 'aftersales', 'materials', 'materialrefs', 'samples', 'rules', 'rates', 'options'];

function defaultTabs(role){
  return role === 'samples' ? ['samples'] : ALL_TABS.slice();
}

function userTabs(u){
  return Array.isArray(u.tabs) && u.tabs.length ? u.tabs : defaultTabs(u.role);
}

function viewKeys(tabs){
  const keys = new Set();
  if(tabs.indexOf('sales') > -1){ keys.add('orders'); keys.add('rates'); keys.add('defaultRate'); }
  if(tabs.indexOf('profit') > -1){ keys.add('orders'); keys.add('samples'); keys.add('rates'); keys.add('defaultRate'); }
  if(tabs.indexOf('materials') > -1) keys.add('materials');
  if(tabs.indexOf('materialrefs') > -1) keys.add('materialRefs');
  if(tabs.indexOf('samples') > -1) keys.add('samples');
  if(tabs.indexOf('rules') > -1){ keys.add('rules'); keys.add('materials'); }
  if(tabs.indexOf('aftersales') > -1) keys.add('afterSales');
  if(tabs.indexOf('rates') > -1){ keys.add('rates'); keys.add('defaultRate'); }
  if(tabs.indexOf('options') > -1){ keys.add('supplierOptions'); keys.add('modelOptions'); keys.add('colorOptions'); }
  return keys;
}

function editKeys(tabs){
  const keys = new Set();
  if(tabs.indexOf('sales') > -1) keys.add('orders');
  if(tabs.indexOf('materials') > -1) keys.add('materials');
  if(tabs.indexOf('materialrefs') > -1) keys.add('materialRefs');
  if(tabs.indexOf('samples') > -1) keys.add('samples');
  if(tabs.indexOf('rules') > -1) keys.add('rules');
  if(tabs.indexOf('aftersales') > -1) keys.add('afterSales');
  if(tabs.indexOf('rates') > -1){ keys.add('rates'); keys.add('defaultRate'); }
  if(tabs.indexOf('options') > -1){ keys.add('supplierOptions'); keys.add('modelOptions'); keys.add('colorOptions'); }
  return keys;
}

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

async function cloudGet(id){
  const url = SUPABASE_URL + '/rest/v1/app_state?select=data&id=eq.' + encodeURIComponent(id);
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: 'Bearer ' + SUPABASE_KEY,
      Accept: 'application/json',
    },
  });
  if(!res.ok) throw new Error('云数据库读取失败 HTTP ' + res.status);
  const arr = await res.json();
  return Array.isArray(arr) && arr.length ? (arr[0].data || null) : null;
}

async function cloudPut(id, data){
  const res = await fetch(SUPABASE_URL + '/rest/v1/app_state', {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify({id: id, data: data}),
  });
  if(!res.ok) throw new Error('云数据库写入失败 HTTP ' + res.status);
}

async function loadState(){
  if(CLOUD_MODE){
    try{
      const s = await cloudGet('main');
      if(s && typeof s === 'object') return Object.assign({}, defaultState(), s);
    }catch(e){
      console.warn('[云数据库] 读取业务数据失败，改用本地文件：' + e.message);
    }
  }
  return readJson(STATE_FILE, defaultState());
}

async function saveState(s){
  if(CLOUD_MODE){
    try{
      await cloudPut('main', s);
      try{ writeJsonAtomic(STATE_FILE, s); }catch(e){}
      return;
    }catch(e){
      console.warn('[云数据库] 写入业务数据失败，已改存本地文件：' + e.message);
    }
  }
  writeJsonAtomic(STATE_FILE, s);
}

async function loadUsers(){
  if(CLOUD_MODE){
    try{
      const u = await cloudGet('users');
      if(Array.isArray(u)) return u;
    }catch(e){
      console.warn('[云数据库] 读取账号失败，改用本地文件：' + e.message);
    }
  }
  return readJson(USERS_FILE, []);
}

async function saveUsers(users){
  if(CLOUD_MODE){
    try{
      await cloudPut('users', users);
      try{ writeJsonAtomic(USERS_FILE, users); }catch(e){}
      return;
    }catch(e){
      console.warn('[云数据库] 写入账号失败，已改存本地文件：' + e.message);
    }
  }
  writeJsonAtomic(USERS_FILE, users);
}

function sha256(text, salt){
  return crypto.createHash('sha256').update(salt + '|' + text).digest('hex');
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

function sendJson(res, status, data){
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(data));
}

async function getAuthUser(req){
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if(!token) return null;
  const sessions = readJson(SESSIONS_FILE, {});
  const userId = sessions[token];
  if(!userId) return null;
  const users = await loadUsers();
  return users.find(function(u){ return u.id === userId; }) || null;
}

function publicUser(u){
  return {id:u.id, name:u.name, phone:u.phone, role:u.role, tabs:userTabs(u)};
}

function adminUser(u){
  const p = publicUser(u);
  p.password = u.password || '';
  return p;
}

function passwordMatches(u, password){
  if(u.password !== undefined && u.password !== null){
    return u.password === String(password);
  }
  if(u.salt && u.hash){
    return u.hash === sha256(String(password), u.salt);
  }
  return false;
}

function deleteUserSessions(userId){
  const sessions = readJson(SESSIONS_FILE, {});
  let changed = false;
  Object.keys(sessions).forEach(function(token){
    if(sessions[token] === userId){
      delete sessions[token];
      changed = true;
    }
  });
  if(changed) writeJsonAtomic(SESSIONS_FILE, sessions);
}

async function handleApi(req, res, p, bodyText){
  ensureFiles();
  const method = req.method;

  if(method === 'POST' && p === '/api/login'){
    let body = {};
    try{ body = bodyText ? JSON.parse(bodyText) : {}; }catch(e){ return sendJson(res, 400, {error:'请求格式错误'}); }
    const phone = String(body.phone || '').trim();
    const password = String(body.password || '');
    const users = await loadUsers();
    const u = users.find(function(x){ return x.phone === phone; });
    if(!u || !passwordMatches(u, password)){
      return sendJson(res, 401, {error:'手机号或密码错误'});
    }
    const token = crypto.randomBytes(24).toString('hex');
    const sessions = readJson(SESSIONS_FILE, {});
    sessions[token] = u.id;
    writeJsonAtomic(SESSIONS_FILE, sessions);
    return sendJson(res, 200, {token:token, user:publicUser(u)});
  }

  if(method === 'POST' && p === '/api/logout'){
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : '';
    if(token){
      const sessions = readJson(SESSIONS_FILE, {});
      if(sessions[token]){
        delete sessions[token];
        writeJsonAtomic(SESSIONS_FILE, sessions);
      }
    }
    return sendJson(res, 200, {ok:true});
  }

  if(method === 'GET' && p === '/api/me'){
    const u = await getAuthUser(req);
    if(!u) return sendJson(res, 401, {error:'未登录或登录已过期'});
    return sendJson(res, 200, {user:publicUser(u)});
  }

  if(p === '/api/state'){
    const u = await getAuthUser(req);
    if(!u) return sendJson(res, 401, {error:'未登录或登录已过期'});
    if(method === 'GET'){
      const full = await loadState();
      const merged = Object.assign({}, defaultState(), full);
      const tabs = userTabs(u);
      const allowed = viewKeys(tabs);
      const out = {};
      allowed.forEach(function(k){
        out[k] = merged[k];
      });
      return sendJson(res, 200, {state:out});
    }
    if(method === 'PUT'){
      if(u.role === 'viewer'){
        return sendJson(res, 403, {error:'只读账号不能修改数据'});
      }
      let body = {};
      try{ body = bodyText ? JSON.parse(bodyText) : {}; }catch(e){ return sendJson(res, 400, {error:'请求格式错误'}); }
      const s = body.state;
      const tabs = userTabs(u);
      const allowedEdit = editKeys(tabs);
      if(!allowedEdit.size){
        return sendJson(res, 403, {error:'当前账号没有可编辑的数据'});
      }
      if(!s || typeof s !== 'object'){
        return sendJson(res, 400, {error:'数据格式不正确'});
      }
      for(const k of allowedEdit){
        if(s[k] === undefined) continue;
        if(k === 'defaultRate'){
          if(typeof s[k] !== 'number') return sendJson(res, 400, {error:'数据格式不正确'});
        }else if(!Array.isArray(s[k])){
          return sendJson(res, 400, {error:'数据格式不正确'});
        }
      }
      const full = await loadState();
      allowedEdit.forEach(function(k){
        if(s[k] !== undefined) full[k] = s[k];
      });
      await saveState(full);
      return sendJson(res, 200, {ok:true});
    }
    return sendJson(res, 405, {error:'不支持的请求方式'});
  }

  if(p === '/api/users'){
    const u = await getAuthUser(req);
    if(!u || u.role !== 'admin'){
      return sendJson(res, 403, {error:'仅管理员可管理账号'});
    }
    if(method === 'GET'){
      const users = (await loadUsers()).map(adminUser);
      return sendJson(res, 200, {users:users});
    }
    if(method === 'POST'){
      let body = {};
      try{ body = bodyText ? JSON.parse(bodyText) : {}; }catch(e){ return sendJson(res, 400, {error:'请求格式错误'}); }
      const name = String(body.name || '').trim();
      const phone = String(body.phone || '').trim();
      const role = String(body.role || '');
      const password = String(body.password || '');
      if(!name || !phone || !password){
        return sendJson(res, 400, {error:'姓名、手机号和初始密码都要填写'});
      }
      if(['admin', 'editor', 'viewer', 'samples'].indexOf(role) === -1){
        return sendJson(res, 400, {error:'角色不正确'});
      }
      if(body.tabs !== undefined && (!Array.isArray(body.tabs) || body.tabs.some(function(t){ return ALL_TABS.indexOf(t) === -1; }))){
        return sendJson(res, 400, {error:'可见表格设置不正确'});
      }
      if(password.length < 4){
        return sendJson(res, 400, {error:'密码至少 4 位'});
      }
      const users = await loadUsers();
      if(users.some(function(x){ return x.phone === phone; })){
        return sendJson(res, 400, {error:'该手机号已存在'});
      }
      const nu = {
        id:'u_' + crypto.randomBytes(6).toString('hex'),
        name:name,
        phone:phone,
        role:role,
        password:password,
        tabs: body.tabs !== undefined ? body.tabs.slice() : defaultTabs(role),
      };
      users.push(nu);
      await saveUsers(users);
      return sendJson(res, 200, {ok:true, user:adminUser(nu)});
    }
    return sendJson(res, 405, {error:'不支持的请求方式'});
  }

  if(p.indexOf('/api/users/') === 0){
    const actor = await getAuthUser(req);
    if(!actor) return sendJson(res, 401, {error:'未登录或登录已过期'});
    const id = p.slice('/api/users/'.length);
    const users = await loadUsers();
    const target = users.find(function(x){ return x.id === id; });
    if(!target) return sendJson(res, 404, {error:'账号不存在'});
    if(id !== actor.id && actor.role !== 'admin'){
      return sendJson(res, 403, {error:'仅管理员可管理其他账号'});
    }

    if(method === 'PUT'){
      let body = {};
      try{ body = bodyText ? JSON.parse(bodyText) : {}; }catch(e){ return sendJson(res, 400, {error:'请求格式错误'}); }
      if(body.role !== undefined && actor.role !== 'admin'){
        return sendJson(res, 403, {error:'只有管理员能修改角色'});
      }
      if(body.role !== undefined){
        const role = String(body.role);
        if(['admin', 'editor', 'viewer', 'samples'].indexOf(role) === -1){
          return sendJson(res, 400, {error:'角色不正确'});
        }
        const adminCount = users.filter(function(x){ return x.role === 'admin'; }).length;
        if(target.role === 'admin' && role !== 'admin' && adminCount <= 1){
          return sendJson(res, 400, {error:'至少保留一个管理员'});
        }
        target.role = role;
      }
      if(body.phone !== undefined){
        const phone = String(body.phone).trim();
        if(!phone){
          return sendJson(res, 400, {error:'手机号不能为空'});
        }
        if(users.some(function(x){ return x.id !== id && x.phone === phone; })){
          return sendJson(res, 400, {error:'该手机号已被其他账号使用'});
        }
        target.phone = phone;
      }
      if(body.tabs !== undefined){
        if(actor.role !== 'admin'){
          return sendJson(res, 403, {error:'只有管理员能设置可见表格'});
        }
        if(!Array.isArray(body.tabs) || body.tabs.some(function(t){ return ALL_TABS.indexOf(t) === -1; })){
          return sendJson(res, 400, {error:'可见表格设置不正确'});
        }
        target.tabs = body.tabs.slice();
      }
      if(body.oldPassword !== undefined){
        if(target.id !== actor.id){
          return sendJson(res, 400, {error:'只能修改自己的密码'});
        }
        if(!passwordMatches(target, body.oldPassword)){
          return sendJson(res, 400, {error:'当前密码不正确'});
        }
      }
      if(body.password !== undefined){
        const password = String(body.password);
        if(password.length < 4){
          return sendJson(res, 400, {error:'密码至少 4 位'});
        }
        if(body.oldPassword === undefined && id === actor.id && actor.role !== 'admin'){
          return sendJson(res, 400, {error:'修改自己的密码需要提供当前密码'});
        }
        target.password = password;
        delete target.salt;
        delete target.hash;
        deleteUserSessions(target.id);
        if(id === actor.id){
          const h = req.headers.authorization || '';
          const token = h.startsWith('Bearer ') ? h.slice(7) : '';
          if(token){
            const sessions = readJson(SESSIONS_FILE, {});
            sessions[token] = actor.id;
            writeJsonAtomic(SESSIONS_FILE, sessions);
          }
        }
      }
      await saveUsers(users);
      return sendJson(res, 200, {ok:true, user:adminUser(target)});
    }

    if(method === 'DELETE'){
      if(actor.role !== 'admin'){
        return sendJson(res, 403, {error:'仅管理员可删除账号'});
      }
      if(target.id === actor.id){
        return sendJson(res, 400, {error:'不能删除自己的账号'});
      }
      const adminCount = users.filter(function(x){ return x.role === 'admin'; }).length;
      if(target.role === 'admin' && adminCount <= 1){
        return sendJson(res, 400, {error:'至少保留一个管理员'});
      }
      await saveUsers(users.filter(function(x){ return x.id !== id; }));
      deleteUserSessions(id);
      return sendJson(res, 200, {ok:true});
    }
    return sendJson(res, 405, {error:'不支持的请求方式'});
  }

  return sendJson(res, 404, {error:'接口不存在'});
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
      await handleApi(req, res, p, body);
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
      let users = await loadUsers();
      if(!users.length){
        const seed = [{
          id:'u_admin',
          name:'管理员',
          phone:'13800000000',
          role:'admin',
          password:'admin123',
          tabs:['sales','profit','aftersales','materials','materialrefs','samples','rules','rates','options'],
        }];
        await saveUsers(seed);
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
