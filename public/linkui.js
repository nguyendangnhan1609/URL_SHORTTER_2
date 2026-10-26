/* Thành phần giao diện dùng chung cho dashboard và trang chi tiết: modal, QR, sửa, xoá, badge trạng thái.
   Mọi dữ liệu người dùng chỉ được gán qua textContent / value (không ghi HTML thô). */
(function () {
  var t = function (k, p) { return window.I18N.t(k, p); };
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function i18nEl(tag, cls, key) {
    var e = el(tag, cls);
    e.setAttribute('data-i18n', key);
    e.textContent = t(key);
    return e;
  }
  var BTN = 'px-4 py-2 rounded-xl text-sm font-semibold transition disabled:opacity-50 ';
  var BTN_GRAD = BTN + 'text-white bg-gradient-to-r from-indigo-600 via-violet-600 to-cyan-500 shadow-md shadow-indigo-200 hover:opacity-90';
  var BTN_SOFT = BTN + 'text-slate-700 bg-slate-100 hover:bg-slate-200';
  var BTN_DANGER = BTN + 'text-white bg-rose-600 hover:bg-rose-700';
  var INPUT = 'w-full border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-500';

  var BADGES = {
    active: 'bg-emerald-100 text-emerald-700',
    disabled: 'bg-slate-200 text-slate-600',
    expired: 'bg-amber-100 text-amber-700'
  };
  function badge(status) {
    var s = BADGES[status] ? status : 'active';
    var b = i18nEl('span', 'inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ' + BADGES[s], 'status.' + s);
    b.setAttribute('data-status', s);
    return b;
  }

  // Modal có role=dialog, đóng bằng Esc / nền / nút; trả về { body, close }.
  function modal(titleKey, wide) {
    var prevFocus = document.activeElement;
    var overlay = el('div', 'fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4 overflow-y-auto');
    var box = el('div', 'bg-white rounded-3xl shadow-2xl w-full p-6 max-h-full overflow-y-auto ' + (wide ? 'max-w-2xl' : 'max-w-md'));
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
    var head = el('div', 'flex items-center justify-between mb-4');
    var h = i18nEl('h2', 'text-xl font-extrabold', titleKey);
    h.id = 'modal-title-' + Math.random().toString(36).slice(2, 8);
    box.setAttribute('aria-labelledby', h.id);
    var x = el('button', 'p-2 rounded-lg hover:bg-slate-100 text-slate-500', '✕');
    x.type = 'button'; x.setAttribute('aria-label', t('common.close'));
    head.appendChild(h); head.appendChild(x);
    var body = el('div');
    box.appendChild(head); box.appendChild(body); overlay.appendChild(box);
    function close() {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      if (prevFocus && prevFocus.focus) prevFocus.focus();
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    x.addEventListener('click', close);
    overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) close(); });
    document.body.appendChild(overlay);
    x.focus();
    return { body: body, close: close, box: box };
  }

  function download(href, name) {
    var a = document.createElement('a');
    a.download = name; a.href = href;
    document.body.appendChild(a); a.click(); a.remove();
  }
  function fileBase(slug) { return 'qr-' + String(slug).replace(/[^a-zA-Z0-9_-]+/g, '-'); }

  // SVG thuần từ ma trận QR (có vùng yên tĩnh 4 ô).
  function qrSvg(text) {
    var m = window.QR.matrix(text), q = 4, n = m.length + q * 2, d = '';
    for (var r = 0; r < m.length; r++)
      for (var c = 0; c < m.length; c++)
        if (m[r][c]) d += 'M' + (c + q) + ' ' + (r + q) + 'h1v1h-1z';
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + n + ' ' + n + '" shape-rendering="crispEdges">'
      + '<rect width="' + n + '" height="' + n + '" fill="#fff"/><path d="' + d + '" fill="#1e1b4b"/></svg>';
  }

  // Khối QR: canvas + nút tải PNG / SVG. Trả về phần tử gốc.
  function qrBlock(link, size) {
    var wrap = el('div', 'flex flex-col items-center gap-3');
    var canvas = el('canvas', 'rounded-2xl border border-slate-200 max-w-full');
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', t('create.qr'));
    var err = i18nEl('p', 'text-sm text-red-600 hidden', 'create.qrFail');
    try { window.QR.draw(canvas, link.shortUrl, size || 280); } catch (e) { canvas.classList.add('hidden'); err.classList.remove('hidden'); }
    var row = el('div', 'flex gap-2');
    var png = i18nEl('button', BTN_GRAD, 'qr.downloadPng'); png.type = 'button';
    png.addEventListener('click', function () { download(canvas.toDataURL('image/png'), fileBase(link.slug) + '.png'); });
    var svg = i18nEl('button', BTN_SOFT, 'qr.downloadSvg'); svg.type = 'button';
    svg.addEventListener('click', function () {
      var url = URL.createObjectURL(new Blob([qrSvg(link.shortUrl)], { type: 'image/svg+xml' }));
      download(url, fileBase(link.slug) + '.svg');
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    });
    row.appendChild(png); row.appendChild(svg);
    wrap.appendChild(canvas); wrap.appendChild(err); wrap.appendChild(row);
    return wrap;
  }

  function qrModal(link) {
    var m = modal('qr.title');
    m.body.appendChild(qrBlock(link, 280));
    m.body.appendChild(el('p', 'mt-3 text-center text-sm text-slate-500 break-all', link.shortUrl));
  }

  function toLocalInput(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function field(id, key, input) {
    var w = el('div');
    var l = i18nEl('label', 'block text-sm font-medium mb-1', key);
    l.setAttribute('for', id); input.id = id;
    w.appendChild(l); w.appendChild(input);
    return w;
  }

  // Modal sửa link; onSaved(linkMoi) được gọi sau khi lưu thành công.
  function editModal(link, onSaved) {
    var m = modal('edit.title');
    var form = el('form', 'space-y-3'); form.noValidate = true;
    var url = el('input', INPUT); url.type = 'url'; url.value = link.url; url.required = true;
    var title = el('input', INPUT); title.type = 'text'; title.maxLength = 100; title.value = link.title || '';
    var note = el('textarea', INPUT); note.rows = 3; note.maxLength = 500; note.value = link.note || '';
    var exp = el('input', INPUT); exp.type = 'datetime-local'; exp.value = toLocalInput(link.expiresAt);
    var max = el('input', INPUT); max.type = 'number'; max.min = '1'; max.step = '1'; max.value = link.maxClicks == null ? '' : link.maxClicks;
    var act = el('input', 'w-5 h-5 accent-violet-600'); act.type = 'checkbox'; act.checked = link.isActive !== false;
    form.appendChild(field('ed-url', 'create.url', url));
    form.appendChild(field('ed-title', 'edit.titleField', title));
    form.appendChild(field('ed-note', 'edit.note', note));
    form.appendChild(field('ed-exp', 'create.expiresAt', exp));
    form.appendChild(field('ed-max', 'create.maxClicks', max));
    var actRow = el('div', 'flex items-center gap-2');
    var actLab = i18nEl('label', 'text-sm font-medium', 'edit.active'); actLab.setAttribute('for', 'ed-act'); act.id = 'ed-act';
    actRow.appendChild(act); actRow.appendChild(actLab); form.appendChild(actRow);
    var err = el('p', 'text-sm text-red-600 hidden'); err.setAttribute('role', 'alert');
    var btns = el('div', 'flex justify-end gap-2 pt-2');
    var cancel = i18nEl('button', BTN_SOFT, 'common.cancel'); cancel.type = 'button';
    var save = i18nEl('button', BTN_GRAD, 'common.save'); save.type = 'submit';
    btns.appendChild(cancel); btns.appendChild(save);
    form.appendChild(err); form.appendChild(btns);
    cancel.addEventListener('click', m.close);
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      err.classList.add('hidden');
      // Chỉ gửi trường đã đổi (ngày hết hạn phải ở tương lai nên không gửi lại giá trị cũ).
      var body = {};
      if (url.value.trim() !== link.url) body.url = url.value.trim();
      if (title.value.trim() !== (link.title || '')) body.title = title.value.trim();
      if (note.value.trim() !== (link.note || '')) body.note = note.value.trim();
      if (exp.value !== toLocalInput(link.expiresAt)) {
        if (!exp.value) body.expiresAt = null;
        else { var d = new Date(exp.value); body.expiresAt = isNaN(d.getTime()) ? exp.value : d.toISOString(); }
      }
      var mv = max.value.trim();
      if (mv !== (link.maxClicks == null ? '' : String(link.maxClicks))) body.maxClicks = mv === '' ? null : Number(mv);
      if (act.checked !== (link.isActive !== false)) body.isActive = act.checked;
      if (!Object.keys(body).length) { m.close(); return; }
      save.disabled = true;
      try {
        var r = await window.App.api('/api/links/' + encodeURIComponent(link.slug), {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        m.close(); onSaved(r);
      } catch (ex) {
        if (ex.code === 'UNAUTHORIZED') { location.href = '/login'; return; }
        err.textContent = window.App.errText(ex.code); err.classList.remove('hidden'); save.disabled = false;
      }
    });
    m.body.appendChild(form);
    url.focus();
  }

  // Xác nhận xoá; onDeleted() sau khi xoá xong.
  function deleteModal(link, onDeleted) {
    var m = modal('delete.title');
    m.body.appendChild(i18nEl('p', 'text-slate-600', 'delete.confirm'));
    m.body.appendChild(el('p', 'mt-2 font-mono text-sm bg-slate-100 rounded-xl px-3 py-2 break-all', '/' + link.slug));
    var err = el('p', 'text-sm text-red-600 hidden mt-2'); err.setAttribute('role', 'alert');
    var btns = el('div', 'flex justify-end gap-2 pt-4');
    var cancel = i18nEl('button', BTN_SOFT, 'common.cancel'); cancel.type = 'button';
    var ok = i18nEl('button', BTN_DANGER, 'delete.action'); ok.type = 'button';
    btns.appendChild(cancel); btns.appendChild(ok);
    m.body.appendChild(err); m.body.appendChild(btns);
    cancel.addEventListener('click', m.close);
    ok.addEventListener('click', async function () {
      ok.disabled = true; err.classList.add('hidden');
      try {
        await window.App.api('/api/links/' + encodeURIComponent(link.slug), { method: 'DELETE' });
        m.close(); onDeleted();
      } catch (ex) {
        if (ex.code === 'UNAUTHORIZED') { location.href = '/login'; return; }
        err.textContent = window.App.errText(ex.code); err.classList.remove('hidden'); ok.disabled = false;
      }
    });
    cancel.focus();
  }

  async function toggleActive(link) {
    return window.App.api('/api/links/' + encodeURIComponent(link.slug), {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isActive: link.isActive === false }) });
  }

  window.LinkUI = {
    el: el, i18nEl: i18nEl, badge: badge, modal: modal, qrModal: qrModal, qrBlock: qrBlock, qrSvg: qrSvg,
    editModal: editModal, deleteModal: deleteModal, toggleActive: toggleActive,
    BTN_GRAD: BTN_GRAD, BTN_SOFT: BTN_SOFT, BTN_DANGER: BTN_DANGER, INPUT: INPUT
  };
})();
