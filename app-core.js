'use strict';
const crypto = require('crypto');

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

const ALL_TABS = ['sales', 'profit', 'aftersales', 'materials', 'materialrefs', 'samples', 'rules', 'rates', 'options'];
const SEED_USERS = [{
  id:'u_admin',
  name:'管理员',
  phone:'13800000000',
  role:'admin',
  password:'admin123',
  tabs:ALL_TABS.slice(),
}];

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

function sha256(text, salt){
  return crypto.createHash('sha256').update(salt + '|' + text).digest('hex');
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

async function supabaseGet(base, key, id){
  const url = base + '/rest/v1/app_state?select=data&id=eq.' + encodeURIComponent(id);
  const res = await fetch(url, {
    headers: {
      apikey: key,
      Authorization: 'Bearer ' + key,
      Accept: 'application/json',
    },
  });
  if(!res.ok) throw new Error('云数据库读取失败 HTTP ' + res.status);
  const arr = await res.json();
  return Array.isArray(arr) && arr.length ? (arr[0].data || null) : null;
}

async function supabasePut(base, key, id, data){
  const res = await fetch(base + '/rest/v1/app_state', {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify({id: id, data: data}),
  });
  if(!res.ok) throw new Error('云数据库写入失败 HTTP ' + res.status);
}

function makeSupabaseStorage(){
  const base = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_KEY || '';
  if(!base || !key) throw new Error('缺少 SUPABASE_URL / SUPABASE_KEY 环境变量');
  return {
    async getState(){
      const s = await supabaseGet(base, key, 'main');
      return s && typeof s === 'object' ? Object.assign({}, defaultState(), s) : defaultState();
    },
    saveState: function(s){ return supabasePut(base, key, 'main', s); },
    async getUsers(){
      let users = await supabaseGet(base, key, 'users');
      if(!Array.isArray(users)) users = [];
      if(!users.length){
        users = SEED_USERS.map(function(u){ return Object.assign({}, u); });
        await supabasePut(base, key, 'users', users);
      }
      return users;
    },
    saveUsers: function(users){ return supabasePut(base, key, 'users', users); },
    async getSessions(){
      const s = await supabaseGet(base, key, 'sessions');
      return s && typeof s === 'object' ? s : {};
    },
    saveSessions: function(sessions){ return supabasePut(base, key, 'sessions', sessions); },
  };
}

function createApiHandler(storage){

  async function getAuthUser(meta){
    const h = meta.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : '';
    if(!token) return null;
    const sessions = await storage.getSessions();
    const userId = sessions[token];
    if(!userId) return null;
    const users = await storage.getUsers();
    return users.find(function(u){ return u.id === userId; }) || null;
  }

  async function deleteUserSessions(userId){
    const sessions = await storage.getSessions();
    let changed = false;
    Object.keys(sessions).forEach(function(token){
      if(sessions[token] === userId){
        delete sessions[token];
        changed = true;
      }
    });
    if(changed) await storage.saveSessions(sessions);
  }

  return async function handleApiRequest(meta){
    const method = meta.method;
    const p = meta.path;
    const bodyText = meta.bodyText || '';
    const R = function(status, body){ return {status:status, body:body}; };

    if(method === 'POST' && p === '/api/login'){
      let body = {};
      try{ body = bodyText ? JSON.parse(bodyText) : {}; }catch(e){ return R(400, {error:'请求格式错误'}); }
      const phone = String(body.phone || '').trim();
      const password = String(body.password || '');
      const users = await storage.getUsers();
      const u = users.find(function(x){ return x.phone === phone; });
      if(!u || !passwordMatches(u, password)){
        return R(401, {error:'手机号或密码错误'});
      }
      const token = crypto.randomBytes(24).toString('hex');
      const sessions = await storage.getSessions();
      sessions[token] = u.id;
      await storage.saveSessions(sessions);
      return R(200, {token:token, user:publicUser(u)});
    }

    if(method === 'POST' && p === '/api/logout'){
      const h = meta.headers.authorization || '';
      const token = h.startsWith('Bearer ') ? h.slice(7) : '';
      if(token){
        const sessions = await storage.getSessions();
        if(sessions[token]){
          delete sessions[token];
          await storage.saveSessions(sessions);
        }
      }
      return R(200, {ok:true});
    }

    if(method === 'GET' && p === '/api/me'){
      const u = await getAuthUser(meta);
      if(!u) return R(401, {error:'未登录或登录已过期'});
      return R(200, {user:publicUser(u)});
    }

    if(p === '/api/state'){
      const u = await getAuthUser(meta);
      if(!u) return R(401, {error:'未登录或登录已过期'});
      if(method === 'GET'){
        const full = await storage.getState();
        const merged = Object.assign({}, defaultState(), full);
        const tabs = userTabs(u);
        const allowed = viewKeys(tabs);
        const out = {};
        allowed.forEach(function(k){
          out[k] = merged[k];
        });
        return R(200, {state:out});
      }
      if(method === 'PUT'){
        if(u.role === 'viewer'){
          return R(403, {error:'只读账号不能修改数据'});
        }
        let body = {};
        try{ body = bodyText ? JSON.parse(bodyText) : {}; }catch(e){ return R(400, {error:'请求格式错误'}); }
        const s = body.state;
        const tabs = userTabs(u);
        const allowedEdit = editKeys(tabs);
        if(!allowedEdit.size){
          return R(403, {error:'当前账号没有可编辑的数据'});
        }
        if(!s || typeof s !== 'object'){
          return R(400, {error:'数据格式不正确'});
        }
        for(const k of allowedEdit){
          if(s[k] === undefined) continue;
          if(k === 'defaultRate'){
            if(typeof s[k] !== 'number') return R(400, {error:'数据格式不正确'});
          }else if(!Array.isArray(s[k])){
            return R(400, {error:'数据格式不正确'});
          }
        }
        const full = await storage.getState();
        allowedEdit.forEach(function(k){
          if(s[k] !== undefined) full[k] = s[k];
        });
        await storage.saveState(full);
        return R(200, {ok:true});
      }
      return R(405, {error:'不支持的请求方式'});
    }

    if(p === '/api/users'){
      const u = await getAuthUser(meta);
      if(!u || u.role !== 'admin'){
        return R(403, {error:'仅管理员可管理账号'});
      }
      if(method === 'GET'){
        const users = (await storage.getUsers()).map(adminUser);
        return R(200, {users:users});
      }
      if(method === 'POST'){
        let body = {};
        try{ body = bodyText ? JSON.parse(bodyText) : {}; }catch(e){ return R(400, {error:'请求格式错误'}); }
        const name = String(body.name || '').trim();
        const phone = String(body.phone || '').trim();
        const role = String(body.role || '');
        const password = String(body.password || '');
        if(!name || !phone || !password){
          return R(400, {error:'姓名、手机号和初始密码都要填写'});
        }
        if(['admin', 'editor', 'viewer', 'samples'].indexOf(role) === -1){
          return R(400, {error:'角色不正确'});
        }
        if(body.tabs !== undefined && (!Array.isArray(body.tabs) || body.tabs.some(function(t){ return ALL_TABS.indexOf(t) === -1; }))){
          return R(400, {error:'可见表格设置不正确'});
        }
        if(password.length < 4){
          return R(400, {error:'密码至少 4 位'});
        }
        const users = await storage.getUsers();
        if(users.some(function(x){ return x.phone === phone; })){
          return R(400, {error:'该手机号已存在'});
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
        await storage.saveUsers(users);
        return R(200, {ok:true, user:adminUser(nu)});
      }
      return R(405, {error:'不支持的请求方式'});
    }

    if(p.indexOf('/api/users/') === 0){
      const actor = await getAuthUser(meta);
      if(!actor) return R(401, {error:'未登录或登录已过期'});
      const id = p.slice('/api/users/'.length);
      const users = await storage.getUsers();
      const target = users.find(function(x){ return x.id === id; });
      if(!target) return R(404, {error:'账号不存在'});
      if(id !== actor.id && actor.role !== 'admin'){
        return R(403, {error:'仅管理员可管理其他账号'});
      }

      if(method === 'PUT'){
        let body = {};
        try{ body = bodyText ? JSON.parse(bodyText) : {}; }catch(e){ return R(400, {error:'请求格式错误'}); }
        if(body.role !== undefined && actor.role !== 'admin'){
          return R(403, {error:'只有管理员能修改角色'});
        }
        if(body.role !== undefined){
          const role = String(body.role);
          if(['admin', 'editor', 'viewer', 'samples'].indexOf(role) === -1){
            return R(400, {error:'角色不正确'});
          }
          const adminCount = users.filter(function(x){ return x.role === 'admin'; }).length;
          if(target.role === 'admin' && role !== 'admin' && adminCount <= 1){
            return R(400, {error:'至少保留一个管理员'});
          }
          target.role = role;
        }
        if(body.phone !== undefined){
          const phone = String(body.phone).trim();
          if(!phone){
            return R(400, {error:'手机号不能为空'});
          }
          if(users.some(function(x){ return x.id !== id && x.phone === phone; })){
            return R(400, {error:'该手机号已被其他账号使用'});
          }
          target.phone = phone;
        }
        if(body.tabs !== undefined){
          if(actor.role !== 'admin'){
            return R(403, {error:'只有管理员能设置可见表格'});
          }
          if(!Array.isArray(body.tabs) || body.tabs.some(function(t){ return ALL_TABS.indexOf(t) === -1; })){
            return R(400, {error:'可见表格设置不正确'});
          }
          target.tabs = body.tabs.slice();
        }
        if(body.oldPassword !== undefined){
          if(target.id !== actor.id){
            return R(400, {error:'只能修改自己的密码'});
          }
          if(!passwordMatches(target, body.oldPassword)){
            return R(400, {error:'当前密码不正确'});
          }
        }
        if(body.password !== undefined){
          const password = String(body.password);
          if(password.length < 4){
            return R(400, {error:'密码至少 4 位'});
          }
          if(body.oldPassword === undefined && id === actor.id && actor.role !== 'admin'){
            return R(400, {error:'修改自己的密码需要提供当前密码'});
          }
          target.password = password;
          delete target.salt;
          delete target.hash;
          await deleteUserSessions(target.id);
          if(id === actor.id){
            const h = meta.headers.authorization || '';
            const token = h.startsWith('Bearer ') ? h.slice(7) : '';
            if(token){
              const sessions = await storage.getSessions();
              sessions[token] = actor.id;
              await storage.saveSessions(sessions);
            }
          }
        }
        await storage.saveUsers(users);
        return R(200, {ok:true, user:adminUser(target)});
      }

      if(method === 'DELETE'){
        if(actor.role !== 'admin'){
          return R(403, {error:'仅管理员可删除账号'});
        }
        if(target.id === actor.id){
          return R(400, {error:'不能删除自己的账号'});
        }
        const adminCount = users.filter(function(x){ return x.role === 'admin'; }).length;
        if(target.role === 'admin' && adminCount <= 1){
          return R(400, {error:'至少保留一个管理员'});
        }
        await storage.saveUsers(users.filter(function(x){ return x.id !== id; }));
        await deleteUserSessions(id);
        return R(200, {ok:true});
      }
      return R(405, {error:'不支持的请求方式'});
    }

    return R(404, {error:'接口不存在'});
  };
}

module.exports = {
  createApiHandler: createApiHandler,
  makeSupabaseStorage: makeSupabaseStorage,
  supabaseGet: supabaseGet,
  supabasePut: supabasePut,
  defaultState: defaultState,
  MATERIALS: MATERIALS,
  ALL_TABS: ALL_TABS,
  SEED_USERS: SEED_USERS,
};
