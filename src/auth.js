'use strict';
// Renouvellement du token OAuth — mode « auto-reauth », DÉSACTIVÉ par défaut.
//
// Même mécanisme que Claude Code lui-même : POST /v1/oauth/token sur
// platform.claude.com, `grant_type=refresh_token`, avec le client_id public du
// CLI. La réponse renvoie un NOUVEAU refresh token : chez Anthropic il tourne à
// chaque usage. Il faut donc le réécrire, sinon le renouvellement suivant
// partirait avec un jeton mort — c'est tout le risque de ce mode, et c'est
// pour ça qu'il ne s'active pas tout seul.
//
// Écrire dans ~/.claude/.credentials.json, c'est toucher au fichier de Claude
// Code. Trois précautions non négociables :
//   1. sauvegarde intégrale avant la toute première écriture (.ccduck-backup) ;
//   2. fusion, jamais remplacement — `mcpOAuth` (les serveurs MCP) et
//      `organizationUuid` doivent survivre intacts ;
//   3. écriture atomique (fichier temporaire + rename), et abandon si le
//      fichier a changé entre la lecture et l'écriture : un autre process a
//      fait tourner le jeton avant nous, c'est le sien qui fait foi.

const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

const HOST = 'platform.claude.com';
const TOKEN_PATH = '/v1/oauth/token';
// client_id public du CLI Claude Code (lu dans le binaire, appairé à platform.claude.com)
const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';

function fail(code, msg) {
  return Object.assign(new Error(msg || code), { code });
}

// Le fichier que Claude Code utilise réellement, dans l'ordre où il le cherche.
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

// Renouvelle le token et réécrit le fichier. Renvoie {token, expiresAt}.
async function refresh(env, timeoutMs) {
  const p = credsPath(env);
  let raw, st;
  try {
    st = fs.statSync(p);
    raw = fs.readFileSync(p, 'utf8');
  } catch (e) {
    // macOS range le token dans le Trousseau : pas de fichier à renouveler ici
    throw fail('no credentials file');
  }
  let j;
  try { j = JSON.parse(raw); } catch (e) { throw fail('bad credentials file'); }
  const o = j.claudeAiOauth;
  if (!o || typeof o.refreshToken !== 'string' || !o.refreshToken) throw fail('no refresh token');

  const res = await post({ grant_type: 'refresh_token', refresh_token: o.refreshToken, client_id: CLIENT_ID }, timeoutMs);
  let data = null;
  try { data = JSON.parse(res.body); } catch (e) { /* réponse illisible */ }
  if (res.status !== 200) {
    // invalid_grant = le refresh token est mort (déjà tourné ailleurs, ou révoqué) :
    // insister ne sert à rien, seul un `claude auth login` répare
    throw fail((data && data.error) || 'http ' + res.status);
  }
  if (!data || typeof data.access_token !== 'string') throw fail('no access_token');

  const expiresAt = data.expires_at ? Number(data.expires_at) * (String(data.expires_at).length > 12 ? 1 : 1000)
    : Date.now() + (Number(data.expires_in) || 8 * 3600) * 1000;

  // Sauvegarde avant la première écriture : si quoi que ce soit tourne mal, le
  // fichier d'origine reste récupérable à la main.
  const backup = p + '.ccduck-backup';
  try { if (!fs.existsSync(backup)) fs.writeFileSync(backup, raw); } catch (e) { /* pas bloquant */ }

  // Relecture juste avant d'écrire : si le fichier a bougé depuis, un autre
  // process a renouvelé de son côté — sa version fait foi, on ne l'écrase pas.
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
  fs.renameSync(tmp, p);   // atomique : personne ne voit un fichier à moitié écrit

  return { token: data.access_token, expiresAt, mtime: fs.statSync(p).mtimeMs };
}

module.exports = { refresh, credsPath, CLIENT_ID };
