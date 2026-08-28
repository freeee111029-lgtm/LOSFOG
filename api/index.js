const { createApiHandler, makeSupabaseStorage } = require('../app-core');

const storage = makeSupabaseStorage();

export const config = {
  api: {
    bodyParser: false
  }
};

export default async function handler(req, res) {
  const meta = {
    method: req.method,
    path: req.url,
    headers: req.headers,
    bodyText: await new Promise((resolve) => {
      let buf = '';
      req.on('data', chunk => buf += chunk.toString());
      req.on('end', () => resolve(buf));
    })
  };

  const result = await createApiHandler(storage)(meta);
  res.status(result.statusCode).json(result.body);
}
