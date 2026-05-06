/* repo_writer.js — minimal GitHub Contents API client.
 *
 * Used by SB Watcher tab to PUT-update files in the dashboard repo
 * (custom_symbols.json today; potentially other config files later).
 *
 * Auth: a fine-grained PAT stored in localStorage["jb_dashboard_pat"]
 * with "Contents: write" permission on jaybot369369-collab/Ai-Dashboard-Pro.
 * If no PAT is set, writeFile() throws — caller handles UI feedback.
 *
 * Usage:
 *   const writer = RepoWriter.create({
 *     owner: 'jaybot369369-collab',
 *     repo:  'Ai-Dashboard-Pro',
 *     branch: 'main',
 *   });
 *   await writer.writeFile('js/data/custom_symbols.json',
 *                          JSON.stringify(payload, null, 2),
 *                          'Update custom symbols list');
 */
(function (root) {
  'use strict';

  const PAT_KEY = 'jb_dashboard_pat';

  function getPat() {
    const p = localStorage.getItem(PAT_KEY);
    if (!p) {
      throw new Error('GitHub PAT missing. Set it in Pro Tools → Cloud Sync, or click Save PAT in the SB Watcher tab.');
    }
    return p;
  }

  function setPat(pat) {
    localStorage.setItem(PAT_KEY, pat);
  }

  function clearPat() {
    localStorage.removeItem(PAT_KEY);
  }

  function hasPat() {
    return !!localStorage.getItem(PAT_KEY);
  }

  /* Encode UTF-8 string to base64 (browser-safe). */
  function b64enc(str) {
    return btoa(unescape(encodeURIComponent(str)));
  }

  /* Decode base64 → UTF-8 string. */
  function b64dec(b64) {
    return decodeURIComponent(escape(atob(b64.replace(/\s/g, ''))));
  }

  function create(opts) {
    const owner = opts.owner;
    const repo = opts.repo;
    const branch = opts.branch || 'main';
    const apiBase = `https://api.github.com/repos/${owner}/${repo}`;

    async function getFileSha(path) {
      const url = `${apiBase}/contents/${encodeURIComponent(path)}?ref=${branch}`;
      const r = await fetch(url, {
        headers: {
          'Accept': 'application/vnd.github+json',
          'Authorization': 'Bearer ' + getPat(),
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`getFileSha ${r.status}: ${await r.text()}`);
      const j = await r.json();
      return { sha: j.sha, content: b64dec(j.content || '') };
    }

    async function writeFile(path, content, message) {
      const existing = await getFileSha(path);
      const body = {
        message: message || `Update ${path}`,
        content: b64enc(content),
        branch: branch,
      };
      if (existing && existing.sha) body.sha = existing.sha;
      const url = `${apiBase}/contents/${encodeURIComponent(path)}`;
      const r = await fetch(url, {
        method: 'PUT',
        headers: {
          'Accept': 'application/vnd.github+json',
          'Authorization': 'Bearer ' + getPat(),
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        throw new Error(`writeFile ${r.status}: ${await r.text()}`);
      }
      return await r.json();
    }

    return { getFileSha, writeFile };
  }

  root.RepoWriter = {
    create,
    getPat,
    setPat,
    clearPat,
    hasPat,
    PAT_KEY,
  };
})(window);
