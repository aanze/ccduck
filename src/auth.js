'use strict';
// OAuth token renewal — the "auto-reauth" mode, OFF by default.
//
// Same mechanism Claude Code itself uses: POST /v1/oauth/token on
// platform.claude.com, `grant_type=refresh_token`, with the CLI public
// client_id. The response carries a NEW refresh token: Anthropic rotates it on
// every use. It has to be written back, otherwise the next renewal would go out
// with a dead token — that is the whole risk of this mode, and the reason it
// never arms itself.
//
// Writing to ~/.claude/.credentials.json means touching Claude Code's own
// file. Three non-negotiable safeguards:
//   1. a full backup before the very first write (.ccduck-backup);
//   2. merge, never replace — `mcpOAuth` (the MCP servers) and
//      `organizationUuid` must survive untouched;
//   3. atomic write (temp file + rename), and giving up when the file changed
//      between the read and the write: another process rotated the token
//      before us, and its version is the one that counts.

const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

const HOST = 'platform.claude.com';
const TOKEN_PATH = '/v1/oauth/token';
// Claude Code CLI public client_id (read from the binary, paired with platform.claude.com)
const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';

function fail(code, msg) {
  return Object.assign(new Error(msg || code), { code });
}

// The file Claude Code actually uses, in the order it looks for it.
function credsPath(env) {
  if (env.CLAUDE_CONFIG_DIR) {
    const p = path.join(env.CLAUDE_CONFIG_DIR, '.credentials.json');
    if (fs.existsSync(p)) return p;
  }
  return path.join(os.homedir(), '.claude', '.credentials.json');
}

function post(body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request({
      host: HOST,
      path: TOKEN_PATH,
      method: 'POST',
      // Same agent as the usage calls: fresh connection, plus the system CA
      // store. Behind a corporate proxy that re-signs TLS, Node's bundled roots
      // do not know the issuer and the renewal died on
      // UNABLE_TO_GET_ISSUER_CERT_LOCALLY while the gauges kept working.
      agent: require('./data').getAgent(),
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'ccduck',
        'Content-Length': Buffer.byteLength(payload),
        'Connection': 'close',
      },
    }, (res) => {
      let out = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { out += d; });
      res.on('end', () => resolve({ status: res.statusCode, body: out }));
    });
    req.setTimeout(timeoutMs, () => req.destroy(fail('timeout')));
    req.on('error', reject);
    req.end(payload);
  });
}

// Renews the token and rewrites the file. Returns {token, expiresAt}.
async function refresh(env, timeoutMs) {
  const p = credsPath(env);
  let raw, st;
  try {
    st = fs.statSync(p);
    raw = fs.readFileSync(p, 'utf8');
  } catch (e) {
    // macOS keeps the token in the Keychain: no file to renew here
    throw fail('no credentials file');
  }
  let j;
  try { j = JSON.parse(raw); } catch (e) { throw fail('bad credentials file'); }
  const o = j.claudeAiOauth;
  if (!o || typeof o.refreshToken !== 'string' || !o.refreshToken) throw fail('no refresh token');

  const res = await post({ grant_type: 'refresh_token', refresh_token: o.refreshToken, client_id: CLIENT_ID }, timeoutMs);
  let data = null;
  try { data = JSON.parse(res.body); } catch (e) { /* unreadable response */ }
  if (res.status !== 200) {
    // invalid_grant = the refresh token is dead (already rotated elsewhere, or revoked):
    // insisting is pointless, only `claude auth login` fixes it
    throw fail((data && data.error) || 'http ' + res.status);
  }
  if (!data || typeof data.access_token !== 'string') throw fail('no access_token');

  const expiresAt = data.expires_at ? Number(data.expires_at) * (String(data.expires_at).length > 12 ? 1 : 1000)
    : Date.now() + (Number(data.expires_in) || 8 * 3600) * 1000;

  // Backup before the first write: if anything goes wrong, the original file
  // can still be restored by hand.
  const backup = p + '.ccduck-backup';
  try { if (!fs.existsSync(backup)) fs.writeFileSync(backup, raw); } catch (e) { /* not blocking */ }

  // Re-read right before writing: if the file moved since, another process
  // renewed on its side — its version wins, we do not overwrite it.
  let cur, curSt;
  try {
    curSt = fs.statSync(p);
    cur = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) { throw fail('reread failed'); }
  if (curSt.mtimeMs !== st.mtimeMs) throw fail('rotated elsewhere');

  const merged = {
    ...cur,
    claudeAiOauth: {
      ...(cur.claudeAiOauth || {}),
      accessToken: data.access_token,
      refreshToken: typeof data.refresh_token === 'string' && data.refresh_token ? data.refresh_token : o.refreshToken,
      expiresAt,
      ...(data.scope ? { scopes: String(data.scope).split(' ') } : {}),
    },
  };
  const tmp = p + '.ccduck.tmp';
  fs.writeFileSync(tmp, JSON.stringify(merged, null, 2));
  fs.renameSync(tmp, p);   // atomic: nobody ever sees a half-written file

  return { token: data.access_token, expiresAt, mtime: fs.statSync(p).mtimeMs };
}

module.exports = { refresh, credsPath, CLIENT_ID };
