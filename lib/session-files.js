// Session forms uploaded by PhysioWay (one PDF per session). Stored in Postgres when it's
// configured, otherwise as files under data/uploads (local development).
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const PDFDocument = require('pdfkit');
const db = require('./db');

const MAX_PAGES = 12;

function newFileId() {
  return `FILE-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
}

function uploadsDir() {
  const base = process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME
    ? path.join(os.tmpdir(), 'uploads')
    : path.join(__dirname, '..', 'data', 'uploads');
  fs.mkdirSync(base, { recursive: true });
  return base;
}

// Turns what the browser sent into one PDF: a PDF is kept as it is; photos (JPEG/PNG) become
// one A4 page each, scaled to fit.
async function toPdf(files) {
  if (!Array.isArray(files) || files.length === 0) throw new Error('Please attach the session form');
  const decoded = files.map((f) => ({
    type: String(f.type || ''),
    name: String(f.name || 'form'),
    data: Buffer.from(String(f.data || ''), 'base64'),
  }));
  const pdfs = decoded.filter((f) => f.type === 'application/pdf');
  if (pdfs.length) {
    if (decoded.length > 1) throw new Error('Attach either one PDF, or photos of the form -- not both');
    const pdf = pdfs[0].data;
    if (pdf.subarray(0, 5).toString() !== '%PDF-') throw new Error("That file isn't a valid PDF");
    return pdf;
  }
  if (decoded.length > MAX_PAGES) throw new Error(`Please attach at most ${MAX_PAGES} photos`);
  for (const f of decoded) {
    const isJpeg = f.data[0] === 0xff && f.data[1] === 0xd8;
    const isPng = f.data.subarray(1, 4).toString() === 'PNG';
    if (!isJpeg && !isPng) throw new Error(`"${f.name}" isn't a photo CareBridge can read (use JPG, PNG or PDF)`);
  }
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 24, autoFirstPage: false });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      for (const f of decoded) {
        doc.addPage();
        const w = doc.page.width - 48;
        const h = doc.page.height - 48;
        doc.image(f.data, 24, 24, { fit: [w, h], align: 'center', valign: 'center' });
      }
      doc.end();
    } catch (err) {
      reject(new Error('One of the photos could not be read. Please retake it and try again.'));
    }
  });
}

async function saveFile({ caseId, fileName, data, uploadedBy }) {
  const id = newFileId();
  if (db.isConfigured()) {
    await db.getPool().query(
      `INSERT INTO session_files (id, case_id, file_name, content_type, size_bytes, data, uploaded_by)
       VALUES ($1, $2, $3, 'application/pdf', $4, $5, $6)`,
      [id, caseId, fileName, data.length, data, uploadedBy]
    );
  } else {
    const dir = uploadsDir();
    fs.writeFileSync(path.join(dir, `${id}.pdf`), data);
    fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({ id, caseId, fileName, uploadedBy, createdAt: new Date().toISOString() }));
  }
  return { id, fileName };
}

async function getFile(id) {
  if (!/^FILE-[0-9A-F]{12}$/.test(String(id))) return null;
  if (db.isConfigured()) {
    const { rows } = await db.getPool().query('SELECT id, case_id, file_name, data FROM session_files WHERE id = $1', [id]);
    return rows[0] ? { id: rows[0].id, caseId: rows[0].case_id, fileName: rows[0].file_name, data: rows[0].data } : null;
  }
  const dir = uploadsDir();
  const metaPath = path.join(dir, `${id}.json`);
  if (!fs.existsSync(metaPath)) return null;
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  return { ...meta, data: fs.readFileSync(path.join(dir, `${id}.pdf`)) };
}

// Postgres removes these with the case (ON DELETE CASCADE); the local folder needs a sweep.
async function deleteForCase(caseId) {
  if (db.isConfigured()) return;
  const dir = uploadsDir();
  for (const name of fs.readdirSync(dir).filter((n) => n.endsWith('.json'))) {
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
      if (meta.caseId === caseId) {
        fs.rmSync(path.join(dir, name), { force: true });
        fs.rmSync(path.join(dir, `${meta.id}.pdf`), { force: true });
      }
    } catch {}
  }
}

module.exports = { toPdf, saveFile, getFile, deleteForCase };
