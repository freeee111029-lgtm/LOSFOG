'use strict';
const {
  createApiHandler,
  makeSupabaseStorage,
} = require('./app-core.js');

const handler = createApiHandler(makeSupabaseStorage());

module.exports = async function(req, res){
  try{
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const bodyText = Buffer.concat(chunks).toString('utf8');
    const pathname = req.url ? new URL(req.url, 'http://x').pathname : '/';
    const result = await handler({
      method: req.method,
      path: pathname,
      headers: req.headers,
      bodyText: bodyText,
    });
    res.status(result.status);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(result.body));
  }catch(e){
    res.status(500);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({error: e.message || '服务器错误'}));
  }
};

module.exports.config = {
  api: {
    bodyParser: false,
  },
};
