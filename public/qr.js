/* QR phía trình duyệt: bọc thư viện qrcode-generator (MIT, đã đóng gói sẵn trong qrcode-generator.js, không dùng CDN). */
(function (root) {
  var lib = null;
  if (typeof module !== 'undefined' && module.exports) lib = require('./qrcode-generator.js');
  else if (root && root.qrcode) lib = root.qrcode;

  // Trả về ma trận boolean (true = ô tối) cho chuỗi text, mức sửa lỗi M.
  function matrix(text) {
    if (!lib) throw new Error('QR_LIB_MISSING');
    var qr = lib(0, 'M');
    qr.addData(String(text));
    qr.make();
    var n = qr.getModuleCount(), m = [];
    for (var r = 0; r < n; r++) {
      var row = [];
      for (var c = 0; c < n; c++) row.push(!!qr.isDark(r, c));
      m.push(row);
    }
    return m;
  }

  // Vẽ lên canvas, có vùng yên tĩnh 4 ô; size là cạnh canvas (px).
  function draw(canvas, text, size) {
    var m = matrix(text), quiet = 4, n = m.length + quiet * 2;
    var cell = Math.max(1, Math.floor((size || 256) / n));
    canvas.width = canvas.height = cell * n;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#1e1b4b';
    for (var r = 0; r < m.length; r++)
      for (var c = 0; c < m.length; c++)
        if (m[r][c]) ctx.fillRect((c + quiet) * cell, (r + quiet) * cell, cell, cell);
    return canvas;
  }

  var api = { matrix: matrix, draw: draw };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.QR = api;
})(typeof window !== 'undefined' ? window : this);
