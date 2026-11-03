/* Googleドライブ連携
 * 端末内（IndexedDB）を正とし、ユーザーのGoogleドライブ「上達ノート」フォルダと双方向に同期する。
 * - スコープは drive.file（このアプリが作ったファイルだけを扱う）
 * - 作品1点 = 記録/<id>.json（＋ 作品/<id>.<拡張子>）。同じ作品を両端末で編集したら updatedAt が新しい方を採用
 * - 削除は「削除済み」の記録（tombstone）を残して他の端末に伝える
 * index.html のグローバル（store, works, settings, applySettings, render, toast, esc, fmtFull など）を使う。
 */
(function () {
  "use strict";
  const SCOPE = "https://www.googleapis.com/auth/drive.file";
  const API = "https://www.googleapis.com/drive/v3";
  const UP = "https://www.googleapis.com/upload/drive/v3";
  const ROOT = "上達ノート", WORKS = "作品", RECS = "記録", SETTINGS_FILE = "設定.json";
  const K = { linked: "un-drive-linked", folders: "un-drive-folders", last: "un-drive-last", tomb: "un-drive-tomb", meta: "un-drive-meta", email: "un-drive-email", token: "un-drive-token" };

  const lget = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lset = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} };
  const jget = (k, d) => { try { return JSON.parse(lget(k) || "null") || d; } catch (e) { return d; } };
  const jset = (k, v) => lset(k, JSON.stringify(v));

  let token = null, tokenExp = 0, syncing = false, again = false, debounce = null;
  let status = "idle", lastError = "", panelEl = null;
  try {
    const t = JSON.parse(sessionStorage.getItem(K.token) || "null");
    if (t && t.exp > Date.now() + 60000) { token = t.token; tokenExp = t.exp; }
  } catch (e) {}

  const clientId = () => (window.JOUTATSU_CONFIG && window.JOUTATSU_CONFIG.googleClientId) || "";
  const configured = () => /\.apps\.googleusercontent\.com$/.test(clientId()) && !clientId().startsWith("YOUR_");
  const linked = () => lget(K.linked) === "1";
  const hhmm = (iso) => { if (!iso) return "—"; const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

  function setStatus(s, err) { status = s; lastError = err || ""; paint(); }

  /* ---------- 認証（Google Identity Services のトークン方式） ---------- */
  function waitGis() {
    return new Promise((res, rej) => {
      let n = 0;
      const t = setInterval(() => {
        if (window.google && google.accounts && google.accounts.oauth2) { clearInterval(t); res(); }
        else if (++n > 100) { clearInterval(t); rej({ code: "gis_unavailable" }); }
      }, 100);
    });
  }
  async function getToken(interactive) {
    if (token && tokenExp > Date.now() + 60000) return token;
    if (!interactive) throw { code: "need_login" };
    await waitGis();
    return new Promise((res, rej) => {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: clientId(),
        scope: SCOPE,
        callback: (r) => {
          if (r.error) return rej({ code: r.error });
          if (!google.accounts.oauth2.hasGrantedAllScopes(r, SCOPE)) return rej({ code: "scope_denied" });
          token = r.access_token; tokenExp = Date.now() + (Number(r.expires_in) || 3600) * 1000;
          try { sessionStorage.setItem(K.token, JSON.stringify({ token, exp: tokenExp })); } catch (e) {}
          res(token);
        },
        error_callback: (e) => rej({ code: (e && e.type) || "popup_failed" }),
      });
      const email = lget(K.email);
      client.requestAccessToken(Object.assign({ prompt: linked() ? "" : "consent" }, email ? { login_hint: email } : {}));
    });
  }
  function dropToken() { token = null; tokenExp = 0; try { sessionStorage.removeItem(K.token); } catch (e) {} }

  async function api(url, opts) {
    const t = await getToken(false);
    const o = opts || {};
    const r = await fetch(url, Object.assign({}, o, { headers: Object.assign({}, o.headers || {}, { Authorization: "Bearer " + t }) }));
    if (r.status === 401) { dropToken(); throw { code: "need_login" }; }
    if (!r.ok) { let m = ""; try { m = await r.text(); } catch (e) {} throw { code: "http_" + r.status, message: m }; }
    return r;
  }

  /* ---------- ドライブ操作 ---------- */
  const q = (s) => encodeURIComponent(s);
  async function findFolder(name, parent) {
    const query = `name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false and '${parent}' in parents`;
    const j = await (await api(`${API}/files?q=${q(query)}&fields=files(id)&spaces=drive`)).json();
    return j.files && j.files[0] ? j.files[0].id : null;
  }
  async function createFolder(name, parent) {
    const j = await (await api(`${API}/files?fields=id`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parent] }) })).json();
    return j.id;
  }
  async function alive(id) {
    try { const j = await (await api(`${API}/files/${id}?fields=id,trashed`)).json(); return !j.trashed; } catch (e) { if (e.code === "need_login") throw e; return false; }
  }
  async function folders() {
    const f = jget(K.folders, null);
    if (f && f.root && (await alive(f.root))) return f;
    const root = (await findFolder(ROOT, "root")) || (await createFolder(ROOT, "root"));
    const out = { root, works: (await findFolder(WORKS, root)) || (await createFolder(WORKS, root)), records: (await findFolder(RECS, root)) || (await createFolder(RECS, root)) };
    jset(K.folders, out);
    return out;
  }
  async function listDir(folderId) {
    const out = []; let pt = "";
    do {
      const j = await (await api(`${API}/files?q=${q(`'${folderId}' in parents and trashed=false`)}&fields=nextPageToken,files(id,name,appProperties)&pageSize=1000${pt ? "&pageToken=" + pt : ""}`)).json();
      out.push(...(j.files || [])); pt = j.nextPageToken || "";
    } while (pt);
    return out;
  }
  async function putFile({ id, name, parent, blob, mime, props }) {
    const meta = { name, mimeType: mime, appProperties: props || {} };
    if (!id) meta.parents = [parent];
    const fd = new FormData();
    fd.append("metadata", new Blob([JSON.stringify(meta)], { type: "application/json" }));
    fd.append("file", blob);
    const j = await (await api(`${UP}/files${id ? "/" + id : ""}?uploadType=multipart&fields=id`, { method: id ? "PATCH" : "POST", body: fd })).json();
    return j.id;
  }
  async function trash(id) {
    try { await api(`${API}/files/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trashed: true }) }); } catch (e) { if (e.code === "need_login") throw e; }
  }
  const getJson = async (id) => (await api(`${API}/files/${id}?alt=media`)).json();
  const getBlob = async (id) => (await api(`${API}/files/${id}?alt=media`)).blob();
  const extOf = (t) => (t === "image/png" ? "png" : t === "image/webp" ? "webp" : "jpg");

  /* ---------- 同期 ---------- */
  async function sync(interactive) {
    if (!linked() || !configured() || typeof store === "undefined" || !store) return;
    if (syncing) { again = true; return; }
    syncing = true; setStatus("syncing");
    try {
      await getToken(!!interactive);
      const f = await folders();
      const meta = jget(K.meta, {});        // workId -> { rec, img, imgFor }
      const tomb = jget(K.tomb, {});        // workId -> 削除した日時
      const remote = {};
      for (const x of await listDir(f.records)) {
        const p = x.appProperties || {};
        const id = p.workId || x.name.replace(/\.json$/, "");
        remote[id] = { fileId: x.id, at: p.updatedAt || "" };
      }
      const local = {};
      works.forEach((w) => { local[w.id] = w; });
      const ids = new Set([...Object.keys(remote), ...Object.keys(local), ...Object.keys(tomb)]);
      let pulled = 0, pushed = 0;

      for (const id of ids) {
        const L = local[id], R = remote[id], T = tomb[id], m = meta[id] || {};
        const lAt = L ? L.updatedAt || "0" : T || "";
        const rAt = R ? R.at : "";

        if (R && rAt > lAt) {
          // ドライブの方が新しい → 取り込む
          const data = await getJson(R.fileId);
          if (data.deleted) {
            if (L) await store.remove(L, { fromSync: true });
            delete tomb[id]; meta[id] = { rec: R.fileId };
          } else {
            const w = Object.assign({}, data); delete w.driveImage; delete w.imageUrl;
            if (data.driveImage) {
              if (L && L.imageId && m.img === data.driveImage) w.imageId = L.imageId;
              else { const up = await store.upload(await getBlob(data.driveImage)); w.imageId = up.imageId; }
            } else delete w.imageId;
            await store.save(w, { fromSync: true });
            delete tomb[id]; meta[id] = { rec: R.fileId, img: data.driveImage, imgFor: w.imageId };
          }
          pulled++;
        } else if ((lAt && lAt > rAt) || (L && !R)) {
          // 端末の方が新しい → ドライブへ送る
          if (!L && T) {
            const body = new Blob([JSON.stringify({ id, deleted: true, updatedAt: T })], { type: "application/json" });
            const rec = await putFile({ id: (R && R.fileId) || m.rec, name: id + ".json", parent: f.records, blob: body, mime: "application/json", props: { workId: id, updatedAt: T } });
            if (m.img) await trash(m.img);
            meta[id] = { rec }; delete tomb[id];
          } else if (L) {
            let img = m.img;
            if (L.imageId && m.imgFor !== L.imageId) {
              const blob = await store.getImage(L.imageId);
              if (blob) img = await putFile({ id: m.img, name: `${id}.${extOf(blob.type)}`, parent: f.works, blob, mime: blob.type || "image/jpeg", props: { workId: id } });
            } else if (!L.imageId && m.img) { await trash(m.img); img = undefined; }
            const out = Object.assign({}, L); delete out.imageId; delete out.imageUrl;
            if (img) out.driveImage = img;
            if (!out.updatedAt) out.updatedAt = "0";
            const rec = await putFile({ id: (R && R.fileId) || m.rec, name: id + ".json", parent: f.records, blob: new Blob([JSON.stringify(out, null, 2)], { type: "application/json" }), mime: "application/json", props: { workId: id, updatedAt: out.updatedAt } });
            meta[id] = { rec, img, imgFor: L.imageId };
          }
          pushed++;
        }
        jset(K.meta, meta); jset(K.tomb, tomb);
      }

      // 設定（自己評価の項目・作業時間・工程の初期値）
      const sMeta = meta.__settings || {};
      const rootFiles = await listDir(f.root);
      const sf = rootFiles.find((x) => x.name === SETTINGS_FILE);
      const rS = sf ? (sf.appProperties || {}).updatedAt || "" : "";
      const lS = settings.updatedAt || "";
      if (sf && rS > lS) {
        const v = await getJson(sf.id);
        await store.saveSettings(v, { fromSync: true });
        meta.__settings = { rec: sf.id };
      } else if (lS && lS > rS) {
        const rec = await putFile({ id: (sf && sf.id) || sMeta.rec, name: SETTINGS_FILE, parent: f.root, blob: new Blob([JSON.stringify(settings, null, 2)], { type: "application/json" }), mime: "application/json", props: { updatedAt: lS } });
        meta.__settings = { rec };
      }
      jset(K.meta, meta);
      lset(K.last, new Date().toISOString());
      setStatus("idle");
      if (interactive && (pulled || pushed)) toast(`同期しました（受信 ${pulled}件・送信 ${pushed}件）`);
    } catch (e) {
      if (e && e.code === "need_login") setStatus("need_login");
      else { console.error("drive sync", e); setStatus("error", (e && e.code) || "unknown"); }
    } finally {
      syncing = false;
      if (again) { again = false; setTimeout(() => sync(false), 400); }
    }
  }

  /* ---------- 連携・解除 ---------- */
  async function link() {
    if (!configured()) { toast("まだ連携の準備中です（GoogleのクライアントIDが未設定）"); return; }
    try {
      setStatus("syncing");
      await getToken(true);
      lset(K.linked, "1");
      try { const j = await (await api(`${API}/about?fields=user(emailAddress)`)).json(); if (j.user && j.user.emailAddress) lset(K.email, j.user.emailAddress); } catch (e) {}
      lset("un-storage", "gdrive");
      await sync(true);
      toast("Googleドライブと連携しました");
    } catch (e) {
      lset(K.linked, null);
      setStatus("idle");
      toast(e && (e.code === "popup_closed" || e.code === "access_denied") ? "連携をキャンセルしました" : "連携できませんでした。もう一度お試しください");
    }
  }
  function unlink() {
    try { if (token && window.google && google.accounts && google.accounts.oauth2) google.accounts.oauth2.revoke(token, () => {}); } catch (e) {}
    dropToken();
    [K.linked, K.folders, K.meta, K.tomb, K.last, K.email].forEach((k) => lset(k, null));
    lset("un-storage", "local");
    setStatus("idle");
    toast("連携を解除しました。ドライブ内のデータはそのまま残っています");
  }

  /* ---------- index.html から呼ばれるフック ---------- */
  window.onLocalChange = function () {
    if (!linked()) return;
    clearTimeout(debounce);
    debounce = setTimeout(() => sync(false), 1500);
  };
  window.onLocalDelete = function (id) {
    if (!linked()) return;
    const t = jget(K.tomb, {}); t[id] = new Date().toISOString(); jset(K.tomb, t);
  };
  window.driveBoot = function () {
    paint();
    if (!linked()) return;
    sync(false);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") sync(false); });
    setInterval(() => { if (document.visibilityState === "visible") sync(false); }, 120000);
  };

  /* ---------- 表示 ---------- */
  function paint() {
    const el = document.getElementById("syncStat");
    if (el) {
      if (!linked()) el.innerHTML = "";
      else if (status === "syncing") el.innerHTML = " ・ Googleドライブと同期中…";
      else if (status === "need_login") el.innerHTML = ` ・ <button type="button" class="linkbtn" id="syncLogin">Googleにログインして同期</button>`;
      else if (status === "error") el.innerHTML = ` ・ 同期できませんでした <button type="button" class="linkbtn" id="syncRetry">再試行</button>`;
      else el.innerHTML = ` ・ Googleドライブ：同期済み ${hhmm(lget(K.last))}`;
      const a = document.getElementById("syncLogin"), b = document.getElementById("syncRetry");
      if (a) a.onclick = () => sync(true);
      if (b) b.onclick = () => sync(true);
    }
    if (panelEl && document.body.contains(panelEl)) renderPanel(panelEl);
  }

  function renderPanel(el) {
    panelEl = el;
    if (linked()) {
      el.innerHTML = `
        <div class="opt" style="cursor:default;border-color:var(--accent)"><span style="display:flex;flex-direction:column;gap:4px">
          <b>Googleドライブと連携中<span class="chip">PCでも使う</span></b>
          <span class="hint">アカウント：${esc(lget(K.email) || "—")}</span>
          <span class="hint">最終同期：${hhmm(lget(K.last))}${status === "syncing" ? "（同期中…）" : status === "need_login" ? "（ログインが必要です）" : status === "error" ? `（同期できませんでした：${esc(lastError)}）` : ""}</span>
        </span></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" type="button" id="dvSync" ${status === "syncing" ? "disabled" : ""}>${status === "need_login" ? "ログインして同期" : "今すぐ同期"}</button><button class="btn ghost" type="button" id="dvUnlink">連携を解除</button></div>
        <p class="note">作品はGoogleドライブの「上達ノート」フォルダに保存されています。PCではブラウザで上達ノートを開き、同じGoogleアカウントで連携すると同じ作品が表示されます。</p>
        <div id="dvConfirm" hidden class="prev-box"><b>連携を解除しますか？</b><span class="hint">この端末の作品はそのまま残り、以後はこの端末だけに保存されます。ドライブ内のデータも消えません。</span>
          <div style="display:flex;gap:8px;margin-top:6px"><button class="btn sm" type="button" id="dvNo">やめる</button><button class="btn sm danger" type="button" id="dvYes">解除する</button></div></div>`;
      el.querySelector("#dvSync").onclick = () => sync(true);
      el.querySelector("#dvUnlink").onclick = () => { el.querySelector("#dvConfirm").hidden = false; };
      el.querySelector("#dvNo").onclick = () => { el.querySelector("#dvConfirm").hidden = true; };
      el.querySelector("#dvYes").onclick = () => { unlink(); };
      return;
    }
    el.innerHTML = `
      <label class="opt"><input type="radio" name="stor" value="local" checked><span><b>この端末のみ<span class="chip plain">標準</span></b><span class="hint">スマホだけで使う場合。作品と記録はこの端末の中に保存されます。端末の故障や機種変更に備えて、ときどきバックアップを書き出してください。</span></span></label>
      <label class="opt"><input type="radio" name="stor" value="gdrive"><span><b>Googleドライブと連携<span class="chip">PCでも使う</span></b><span class="hint">作品と記録をあなたのGoogleドライブに保存し、スマホとPCの両方から使えるようにします。</span></span></label>
      <label class="opt" style="cursor:default;opacity:.6"><input type="radio" disabled><span><b>OneDrive・Dropbox<span class="chip plain">今後対応予定</span></b></span></label>
      <div id="gdGuide" hidden style="display:flex;flex-direction:column;gap:10px">
        <span class="label">PCと連携する手順</span>
        <ol class="steps">
          <li>下の「Googleドライブと連携」を押して、Googleアカウントでログインします。</li>
          <li>「上達ノートがファイルを作成・管理することを許可」を承認します。</li>
          <li>これまでの作品と記録がドライブに保存されます（作品数によって数分かかります）。</li>
          <li>PCのブラウザで上達ノートを開き、同じ手順で<b>同じGoogleアカウント</b>と連携すれば完了です。</li>
        </ol>
        <p class="note">作品はあなたのGoogleドライブの「上達ノート」フォルダに保存され、運営側のサーバーには保存されません。上達ノートが触れるのは、このアプリが作ったファイルだけです。連携を解除しても、ドライブ内のデータはそのまま残ります。</p>
        ${configured() ? "" : `<p class="note">GoogleのクライアントIDがまだ設定されていないため、連携できません（config.js）。</p>`}
        <div><button class="btn primary" type="button" id="gdLink">Googleドライブと連携</button></div>
      </div>`;
    el.querySelectorAll('input[name="stor"]').forEach((r) => (r.onchange = () => { el.querySelector("#gdGuide").hidden = r.value !== "gdrive"; }));
    el.querySelector("#gdLink").onclick = link;
  }

  window.drive = { sync, link, unlink, linked, configured, renderPanel };
})();
