// services/tests/e2e_cloud_vault/helpers/mockS3Server.js
// =============================================================================
// Loopback AWS S3 (SigV4 Path-Style) + WebDAV HTTP Simulator
// =============================================================================
// - Pure Node built-ins (node:http, node:crypto)
// - Implements full AWS4-HMAC-SHA256 SigningKey derivation + timingSafeEqual
// - Supports S3 (HeadBucket, PutBucket, PutObject, GetObject + Range 206,
//   HeadObject, ListObjectsV2 XML, CopyObject, DeleteObject) & WebDAV
//   (OPTIONS, MKCOL, PROPFIND 207 XML, PUT, GET, HEAD, MOVE, COPY, DELETE)
// =============================================================================

import crypto from 'node:crypto';
import http from 'node:http';

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data || Buffer.alloc(0)).digest('hex');
}

function hmacSha256(key, data) {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

function encodeS3UriPath(pathname) {
  return pathname
    .split('/')
    .map((seg) =>
      encodeURIComponent(decodeURIComponentSafe(seg)).replace(
        /[!'()*]/g,
        (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    )
    .join('/');
}

function decodeURIComponentSafe(str) {
  try {
    return decodeURIComponent(str);
  } catch {
    return str;
  }
}

function buildCanonicalQueryString(searchParams) {
  const entries = [];
  for (const [k, v] of searchParams.entries()) {
    entries.push([
      encodeURIComponent(k).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`),
      encodeURIComponent(v).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`),
    ]);
  }
  entries.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));
  return entries.map(([k, v]) => `${k}=${v}`).join('&');
}

function formatAmzDate(date = new Date()) {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

function parseAmzDateMs(amzDate) {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(String(amzDate || '').trim());
  if (!m) return NaN;
  return Date.UTC(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6]),
  );
}

function deriveSigV4SigningKey(secretKey, dateStamp, region, service = 's3') {
  const kDate = hmacSha256(`AWS4${secretKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  return hmacSha256(kService, 'aws4_request');
}

export function signS3Request({
  method = 'GET',
  url,
  headers = {},
  body = Buffer.alloc(0),
  accessKey,
  secretKey,
  region = 'us-east-1',
  service = 's3',
  date = new Date(),
} = {}) {
  const u = new URL(url);
  const rawBody = Buffer.isBuffer(body)
    ? body
    : typeof body === 'string'
      ? Buffer.from(body, 'utf8')
      : body instanceof Uint8Array
        ? Buffer.from(body)
        : Buffer.alloc(0);

  const { amzDate } = formatAmzDate(date);
  const payloadHash = headers['x-amz-content-sha256'] || sha256Hex(rawBody);

  const normalizedHeaders = new Map();
  for (const [k, v] of Object.entries(headers)) {
    normalizedHeaders.set(k.toLowerCase(), String(v).trim().replace(/\s+/g, ' '));
  }
  normalizedHeaders.set('host', u.host);
  normalizedHeaders.set('x-amz-date', normalizedHeaders.get('x-amz-date') || amzDate);
  normalizedHeaders.set('x-amz-content-sha256', payloadHash);

  const signedHeaderNames = Array.from(normalizedHeaders.keys()).sort();
  const canonicalHeaders = signedHeaderNames.map((k) => `${k}:${normalizedHeaders.get(k)}\n`).join('');
  const signedHeaders = signedHeaderNames.join(';');

  const canonicalUri = encodeS3UriPath(u.pathname || '/');
  const canonicalQuery = buildCanonicalQueryString(u.searchParams);

  const canonicalRequest = [
    String(method).toUpperCase(),
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const usedAmzDate = normalizedHeaders.get('x-amz-date');
  const usedDateStamp = usedAmzDate.slice(0, 8);
  const credentialScope = `${usedDateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', usedAmzDate, credentialScope, sha256Hex(canonicalRequest)].join('\n');

  const signingKey = deriveSigV4SigningKey(secretKey, usedDateStamp, region, service);
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

  const outHeaders = {};
  for (const [k, v] of normalizedHeaders.entries()) {
    outHeaders[k] = v;
  }
  outHeaders.authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return outHeaders;
}

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function sendXml(res, statusCode, xml, extraHeaders = {}) {
  const buf = Buffer.from(xml, 'utf8');
  res.writeHead(statusCode, {
    'content-type': 'application/xml; charset=utf-8',
    'content-length': buf.length,
    ...extraHeaders,
  });
  res.end(buf);
}

function sendS3Error(res, statusCode, code, message) {
  return sendXml(
    res,
    statusCode,
    `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${escapeXml(code)}</Code><Message>${escapeXml(message)}</Message></Error>`,
  );
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function safeEqualString(a, b) {
  const bufA = Buffer.from(String(a || ''), 'utf8');
  const bufB = Buffer.from(String(b || ''), 'utf8');
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

export async function startMockS3Server({
  accessKey = 'nexus-test-ak',
  secretKey = 'nexus-test-sk-secret-key',
  bucket = 'nexus-vault',
  region = 'us-east-1',
  allowWebDav = true,
} = {}) {
  const buckets = new Map();
  buckets.set(bucket, new Map());

  const webdavStore = new Map(); // normalized path -> { body, isDir, contentType, lastModified }
  webdavStore.set('/', { body: Buffer.alloc(0), isDir: true, contentType: 'inode/directory', lastModified: new Date().toUTCString() });

  const requestLog = [];

  function verifySigV4(req, parsedUrl, rawBody) {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('AWS4-HMAC-SHA256')) {
      return { ok: false, status: 403, code: 'AccessDenied', message: 'Missing AWS4-HMAC-SHA256 Authorization' };
    }

    const credMatch = /Credential=([^,\s]+)/.exec(auth);
    const signedMatch = /SignedHeaders=([^,\s]+)/.exec(auth);
    const sigMatch = /Signature=([0-9a-f]+)/i.exec(auth);
    if (!credMatch || !signedMatch || !sigMatch) {
      return { ok: false, status: 403, code: 'AuthorizationHeaderMalformed', message: 'Malformed Authorization header' };
    }

    const [reqAk, dateStamp, reqRegion, reqService, term] = credMatch[1].split('/');
    if (!safeEqualString(reqAk, accessKey)) {
      return { ok: false, status: 403, code: 'InvalidAccessKeyId', message: 'Invalid Access Key' };
    }
    if (term !== 'aws4_request' || reqService !== 's3') {
      return { ok: false, status: 403, code: 'AuthorizationHeaderMalformed', message: 'Invalid Credential scope' };
    }

    const amzDate = req.headers['x-amz-date'];
    const amzMs = parseAmzDateMs(amzDate);
    if (!Number.isFinite(amzMs) || Math.abs(Date.now() - amzMs) > 15 * 60 * 1000) {
      return { ok: false, status: 403, code: 'RequestTimeTooSkewed', message: 'x-amz-date skewed or missing' };
    }

    const payloadHeader = req.headers['x-amz-content-sha256'];
    const actualBodyHash = sha256Hex(rawBody);
    if (payloadHeader && payloadHeader !== 'UNSIGNED-PAYLOAD' && !safeEqualString(payloadHeader.toLowerCase(), actualBodyHash)) {
      return { ok: false, status: 403, code: 'XAmzContentSHA256Mismatch', message: 'Payload hash mismatch' };
    }

    const signedHeaderList = signedMatch[1].split(';').map((h) => h.trim().toLowerCase());
    const canonicalHeaders = signedHeaderList
      .map((name) => `${name}:${String(req.headers[name] ?? '').trim().replace(/\s+/g, ' ')}\n`)
      .join('');

    const canonicalRequest = [
      req.method.toUpperCase(),
      encodeS3UriPath(parsedUrl.pathname || '/'),
      buildCanonicalQueryString(parsedUrl.searchParams),
      canonicalHeaders,
      signedHeaderList.join(';'),
      payloadHeader || actualBodyHash,
    ].join('\n');

    const scope = `${dateStamp}/${reqRegion}/${reqService}/aws4_request`;
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
    const signingKey = deriveSigV4SigningKey(secretKey, dateStamp, reqRegion, reqService);
    const expectedSig = crypto.createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

    if (!safeEqualString(sigMatch[1].toLowerCase(), expectedSig)) {
      return { ok: false, status: 403, code: 'SignatureDoesNotMatch', message: 'Signature mismatch' };
    }

    return { ok: true };
  }

  function verifyWebDavAuth(req) {
    const auth = req.headers.authorization || '';
    if (auth.startsWith('Basic ')) {
      const decoded = Buffer.from(auth.slice(6).trim(), 'base64').toString('utf8');
      const colonIdx = decoded.indexOf(':');
      if (colonIdx > 0) {
        const u = decoded.slice(0, colonIdx);
        const p = decoded.slice(colonIdx + 1);
        if (safeEqualString(u, accessKey) && safeEqualString(p, secretKey)) {
          return true;
        }
      }
    } else if (auth.startsWith('Bearer ')) {
      if (safeEqualString(auth.slice(7).trim(), secretKey)) {
        return true;
      }
    }
    return false;
  }

  function normalizeWebDavPath(pathname) {
    let p = pathname.startsWith('/webdav') ? pathname.slice('/webdav'.length) || '/' : pathname;
    if (!p.startsWith('/')) p = `/${p}`;
    p = decodeURIComponentSafe(p);
    return p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p;
  }

  async function handleWebDav(req, res, parsedUrl, rawBody) {
    if (!verifyWebDavAuth(req)) {
      res.writeHead(401, {
        'www-authenticate': 'Basic realm="NexusWebDAV"',
        'content-length': '0',
      });
      res.end();
      return 401;
    }

    const method = req.method.toUpperCase();
    const targetPath = normalizeWebDavPath(parsedUrl.pathname);

    if (method === 'OPTIONS') {
      res.writeHead(200, {
        dav: '1, 2',
        allow: 'OPTIONS, PROPFIND, MKCOL, GET, HEAD, PUT, DELETE, COPY, MOVE',
        'content-length': '0',
      });
      res.end();
      return 200;
    }

    if (method === 'MKCOL') {
      webdavStore.set(targetPath, {
        body: Buffer.alloc(0),
        isDir: true,
        contentType: 'inode/directory',
        lastModified: new Date().toUTCString(),
      });
      res.writeHead(201, { 'content-length': '0' });
      res.end();
      return 201;
    }

    if (method === 'PUT') {
      webdavStore.set(targetPath, {
        body: rawBody,
        isDir: false,
        contentType: req.headers['content-type'] || 'application/octet-stream',
        lastModified: new Date().toUTCString(),
      });
      res.writeHead(201, { 'content-length': '0' });
      res.end();
      return 201;
    }

    if (method === 'GET' || method === 'HEAD') {
      const entry = webdavStore.get(targetPath);
      if (!entry || entry.isDir) {
        res.writeHead(404, { 'content-length': '0' });
        res.end();
        return 404;
      }
      res.writeHead(200, {
        'content-type': entry.contentType,
        'content-length': entry.body.length,
        'last-modified': entry.lastModified,
      });
      if (method === 'HEAD') res.end();
      else res.end(entry.body);
      return 200;
    }

    if (method === 'DELETE') {
      if (!webdavStore.has(targetPath)) {
        res.writeHead(404, { 'content-length': '0' });
        res.end();
        return 404;
      }
      const prefix = targetPath === '/' ? '/' : `${targetPath}/`;
      for (const k of Array.from(webdavStore.keys())) {
        if (k === targetPath || k.startsWith(prefix)) {
          webdavStore.delete(k);
        }
      }
      res.writeHead(204, { 'content-length': '0' });
      res.end();
      return 204;
    }

    if (method === 'MOVE' || method === 'COPY') {
      const destHeader = req.headers.destination;
      if (!destHeader) {
        res.writeHead(400, { 'content-length': '0' });
        res.end();
        return 400;
      }
      const destUrl = new URL(destHeader, 'http://127.0.0.1');
      const destPath = normalizeWebDavPath(destUrl.pathname);
      const entry = webdavStore.get(targetPath);
      if (!entry) {
        res.writeHead(404, { 'content-length': '0' });
        res.end();
        return 404;
      }
      const prefix = targetPath === '/' ? '/' : `${targetPath}/`;
      for (const [k, val] of Array.from(webdavStore.entries())) {
        if (k === targetPath) {
          webdavStore.set(destPath, { ...val, body: Buffer.from(val.body) });
          if (method === 'MOVE') webdavStore.delete(k);
        } else if (k.startsWith(prefix)) {
          const suffix = k.slice(targetPath.length);
          webdavStore.set(`${destPath}${suffix}`, { ...val, body: Buffer.from(val.body) });
          if (method === 'MOVE') webdavStore.delete(k);
        }
      }
      res.writeHead(201, { 'content-length': '0' });
      res.end();
      return 201;
    }

    if (method === 'PROPFIND') {
      const depth = String(req.headers.depth ?? '1');
      const baseEntry = webdavStore.get(targetPath);
      if (!baseEntry) {
        res.writeHead(404, { 'content-length': '0' });
        res.end();
        return 404;
      }

      const items = [[targetPath, baseEntry]];
      if (depth !== '0' && baseEntry.isDir) {
        const prefix = targetPath === '/' ? '/' : `${targetPath}/`;
        for (const [k, v] of webdavStore.entries()) {
          if (k === targetPath) continue;
          if (k.startsWith(prefix)) {
            const rel = k.slice(prefix.length);
            if (!rel.includes('/')) {
              items.push([k, v]);
            }
          }
        }
      }

      const responsesXml = items
        .map(([itemPath, item]) => {
          const href = `/webdav${itemPath === '/' ? '' : itemPath}${item.isDir ? '/' : ''}`;
          const resourceType = item.isDir ? '<D:resourcetype><D:collection/></D:resourcetype>' : '<D:resourcetype/>';
          return `<D:response><D:href>${escapeXml(href)}</D:href><D:propstat><D:prop>${resourceType}<D:getcontentlength>${item.body.length}</D:getcontentlength><D:getlastmodified>${escapeXml(item.lastModified)}</D:getlastmodified></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`;
        })
        .join('');

      sendXml(
        res,
        207,
        `<?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:">${responsesXml}</D:multistatus>`,
      );
      return 207;
    }

    res.writeHead(405, { 'content-length': '0' });
    res.end();
    return 405;
  }

  const server = http.createServer(async (req, res) => {
    const rawBody = await readRawBody(req);
    const parsedUrl = new URL(req.url, 'http://127.0.0.1');
    const method = req.method.toUpperCase();

    const isWebDavMethod = ['OPTIONS', 'PROPFIND', 'MKCOL', 'MOVE', 'COPY'].includes(method);
    const isWebDavPath = parsedUrl.pathname.startsWith('/webdav');

    if (allowWebDav && (isWebDavMethod || isWebDavPath)) {
      const code = await handleWebDav(req, res, parsedUrl, rawBody);
      requestLog.push({ ts: Date.now(), protocol: 'webdav', method, url: req.url, status: code });
      return;
    }

    const sigCheck = verifySigV4(req, parsedUrl, rawBody);
    if (!sigCheck.ok) {
      requestLog.push({ ts: Date.now(), protocol: 's3', method, url: req.url, status: sigCheck.status, errorCode: sigCheck.code });
      return sendS3Error(res, sigCheck.status, sigCheck.code, sigCheck.message);
    }

    const parts = parsedUrl.pathname.split('/').filter(Boolean);
    if (parts.length === 0) {
      requestLog.push({ ts: Date.now(), protocol: 's3', method, url: req.url, status: 400 });
      return sendS3Error(res, 400, 'InvalidURI', 'Bucket name required');
    }

    const bucketName = decodeURIComponentSafe(parts[0]);
    const key = parts.slice(1).map(decodeURIComponentSafe).join('/');

    // Bucket-level operations
    if (!key) {
      if (method === 'PUT') {
        if (!buckets.has(bucketName)) buckets.set(bucketName, new Map());
        requestLog.push({ ts: Date.now(), protocol: 's3', method, url: req.url, status: 200 });
        res.writeHead(200, { 'content-length': '0' });
        return res.end();
      }
      if (!buckets.has(bucketName)) {
        requestLog.push({ ts: Date.now(), protocol: 's3', method, url: req.url, status: 404, errorCode: 'NoSuchBucket' });
        return sendS3Error(res, 404, 'NoSuchBucket', `Bucket ${bucketName} does not exist`);
      }
      if (method === 'HEAD') {
        requestLog.push({ ts: Date.now(), protocol: 's3', method, url: req.url, status: 200 });
        res.writeHead(200, { 'content-length': '0' });
        return res.end();
      }
      if (method === 'GET') {
        const prefix = parsedUrl.searchParams.get('prefix') || '';
        const delimiter = parsedUrl.searchParams.get('delimiter') || '';
        const maxKeys = Math.max(1, Number(parsedUrl.searchParams.get('max-keys') || 1000));
        const store = buckets.get(bucketName);

        const contents = [];
        const commonPrefixes = new Set();

        for (const [k, obj] of Array.from(store.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
          if (prefix && !k.startsWith(prefix)) continue;
          if (delimiter) {
            const rest = k.slice(prefix.length);
            const idx = rest.indexOf(delimiter);
            if (idx >= 0) {
              commonPrefixes.add(prefix + rest.slice(0, idx + delimiter.length));
              continue;
            }
          }
          contents.push([k, obj]);
        }

        const sliced = contents.slice(0, maxKeys);
        const contentsXml = sliced
          .map(
            ([k, obj]) =>
              `<Contents><Key>${escapeXml(k)}</Key><LastModified>${escapeXml(obj.lastModified)}</LastModified><ETag>${escapeXml(obj.etag)}</ETag><Size>${obj.body.length}</Size><StorageClass>STANDARD</StorageClass></Contents>`,
          )
          .join('');
        const prefixesXml = Array.from(commonPrefixes)
          .sort()
          .map((p) => `<CommonPrefixes><Prefix>${escapeXml(p)}</Prefix></CommonPrefixes>`)
          .join('');

        requestLog.push({ ts: Date.now(), protocol: 's3', method, url: req.url, status: 200 });
        return sendXml(
          res,
          200,
          `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>${escapeXml(bucketName)}</Name><Prefix>${escapeXml(prefix)}</Prefix><KeyCount>${sliced.length}</KeyCount><MaxKeys>${maxKeys}</MaxKeys><IsTruncated>${contents.length > maxKeys}</IsTruncated>${contentsXml}${prefixesXml}</ListBucketResult>`,
        );
      }
    }

    // Object-level operations
    if (!buckets.has(bucketName)) {
      requestLog.push({ ts: Date.now(), protocol: 's3', method, url: req.url, status: 404, errorCode: 'NoSuchBucket' });
      return sendS3Error(res, 404, 'NoSuchBucket', `Bucket ${bucketName} does not exist`);
    }
    const store = buckets.get(bucketName);

    if (method === 'PUT') {
      const copySource = req.headers['x-amz-copy-source'];
      if (copySource) {
        const cleanSrc = decodeURIComponentSafe(String(copySource).replace(/^\/+/, ''));
        const slashIdx = cleanSrc.indexOf('/');
        const srcBucket = slashIdx >= 0 ? cleanSrc.slice(0, slashIdx) : bucketName;
        const srcKey = slashIdx >= 0 ? cleanSrc.slice(slashIdx + 1) : cleanSrc;
        const srcObj = buckets.get(srcBucket)?.get(srcKey);
        if (!srcObj) {
          requestLog.push({ ts: Date.now(), protocol: 's3', method, url: req.url, status: 404, errorCode: 'NoSuchKey' });
          return sendS3Error(res, 404, 'NoSuchKey', 'Copy source does not exist');
        }
        const copied = {
          body: Buffer.from(srcObj.body),
          contentType: srcObj.contentType,
          etag: srcObj.etag,
          lastModified: new Date().toISOString(),
        };
        store.set(key, copied);
        requestLog.push({ ts: Date.now(), protocol: 's3', method, url: req.url, status: 200 });
        return sendXml(
          res,
          200,
          `<?xml version="1.0" encoding="UTF-8"?><CopyObjectResult><LastModified>${escapeXml(copied.lastModified)}</LastModified><ETag>${escapeXml(copied.etag)}</ETag></CopyObjectResult>`,
        );
      }

      const md5 = crypto.createHash('md5').update(rawBody).digest('hex');
      const etag = `"${md5}"`;
      store.set(key, {
        body: rawBody,
        contentType: req.headers['content-type'] || 'application/octet-stream',
        etag,
        lastModified: new Date().toISOString(),
      });
      requestLog.push({ ts: Date.now(), protocol: 's3', method, url: req.url, status: 200 });
      res.writeHead(200, { etag, 'content-length': '0' });
      return res.end();
    }

    if (method === 'HEAD' || method === 'GET') {
      const obj = store.get(key);
      if (!obj) {
        requestLog.push({ ts: Date.now(), protocol: 's3', method, url: req.url, status: 404, errorCode: 'NoSuchKey' });
        if (method === 'HEAD') {
          res.writeHead(404, { 'content-length': '0' });
          return res.end();
        }
        return sendS3Error(res, 404, 'NoSuchKey', `Key ${key} does not exist`);
      }

      if (method === 'GET' && req.headers.range) {
        const match = /^bytes=(\d*)-(\d*)$/i.exec(String(req.headers.range).trim());
        const size = obj.body.length;
        if (!match || (!match[1] && !match[2]) || size === 0) {
          requestLog.push({ ts: Date.now(), protocol: 's3', method, url: req.url, status: 416 });
          res.writeHead(416, { 'content-range': `bytes */${size}` });
          return res.end();
        }
        let start;
        let end;
        if (!match[1] && match[2]) {
          const suffixLength = Number(match[2]);
          if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
            requestLog.push({ ts: Date.now(), protocol: 's3', method, url: req.url, status: 416 });
            res.writeHead(416, { 'content-range': `bytes */${size}` });
            return res.end();
          }
          start = Math.max(0, size - suffixLength);
          end = size - 1;
        } else {
          start = Number(match[1]);
          end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
        }
        if (Number.isNaN(start) || Number.isNaN(end) || start < 0 || start > end || start >= size) {
          requestLog.push({ ts: Date.now(), protocol: 's3', method, url: req.url, status: 416 });
          res.writeHead(416, { 'content-range': `bytes */${size}` });
          return res.end();
        }
        const slice = obj.body.subarray(start, end + 1);
        requestLog.push({ ts: Date.now(), protocol: 's3', method, url: req.url, status: 206 });
        res.writeHead(206, {
          'content-type': obj.contentType,
          'accept-ranges': 'bytes',
          'content-range': `bytes ${start}-${end}/${obj.body.length}`,
          'content-length': slice.length,
          etag: obj.etag,
          'last-modified': new Date(obj.lastModified).toUTCString(),
        });
        return res.end(slice);
      }

      requestLog.push({ ts: Date.now(), protocol: 's3', method, url: req.url, status: 200 });
      res.writeHead(200, {
        'content-type': obj.contentType,
        'accept-ranges': 'bytes',
        'content-length': obj.body.length,
        etag: obj.etag,
        'last-modified': new Date(obj.lastModified).toUTCString(),
      });
      if (method === 'HEAD') return res.end();
      return res.end(obj.body);
    }

    if (method === 'DELETE') {
      store.delete(key);
      requestLog.push({ ts: Date.now(), protocol: 's3', method, url: req.url, status: 204 });
      res.writeHead(204, { 'content-length': '0' });
      return res.end();
    }

    requestLog.push({ ts: Date.now(), protocol: 's3', method, url: req.url, status: 405 });
    return sendS3Error(res, 405, 'MethodNotAllowed', `Method ${method} not allowed`);
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const addr = server.address();
  const endpoint = `http://127.0.0.1:${addr.port}`;

  return {
    endpoint,
    bucket,
    region,
    accessKey,
    secretKey,
    getObjects(bucketName = bucket) {
      const store = buckets.get(bucketName);
      if (!store) return {};
      const out = {};
      for (const [k, v] of store.entries()) {
        out[k] = {
          size: v.body.length,
          contentType: v.contentType,
          etag: v.etag,
          body: Buffer.from(v.body),
        };
      }
      return out;
    },
    getRequestLog() {
      return [...requestLog];
    },
    async stop() {
      await new Promise((resolve) => server.close(() => resolve()));
    },
  };
}
