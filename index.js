const express = require('express');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// --- KONFIGURASI PENTING (DARI ENV VERCEL) ---
const NOMOR_WA = "601173686870"; 
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

// Konfigurasi GitHub
const GITHUB_TOKEN = process.env.GITHUB_TOKEN; // Token Personal Access Token (Classic)
const GITHUB_REPO = process.env.GITHUB_REPO;   // Format: username/nama-repo
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main'; // Branch utama (main/master)
const FILE_PATH = 'public/data.json'; // Lokasi file di repo

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' })); // Limit besar biar aman saat save banyak data
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Upload Multer (Wajib /tmp/ di Vercel)
const upload = multer({ dest: '/tmp/' });

// --- HELPER: FUNGSI BACA/TULIS KE GITHUB ---

// 1. Baca File dari GitHub
async function getGitHubData() {
    if (!GITHUB_TOKEN || !GITHUB_REPO) throw new Error("GITHUB TOKEN/REPO belum disetting di Vercel!");
    
    const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${FILE_PATH}?ref=${GITHUB_BRANCH}`;
    const res = await axios.get(url, {
        headers: { 
            'Authorization': `token ${GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github.v3+json'
        }
    });
    
    // GitHub kasih konten dalam Base64, kita decode jadi JSON
    const content = Buffer.from(res.data.content, 'base64').toString('utf-8');
    return { 
        sha: res.data.sha, // SHA penting untuk update file nanti
        data: JSON.parse(content) 
    };
}

// 2. Update File ke GitHub
async function updateGitHubData(newData, sha) {
    const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${FILE_PATH}`;
    const contentBase64 = Buffer.from(JSON.stringify(newData, null, 4)).toString('base64');

    await axios.put(url, {
        message: "Update data.json dari Admin Panel",
        content: contentBase64,
        sha: sha, // SHA wajib ada biar gak konflik
        branch: GITHUB_BRANCH
    }, {
        headers: { 
            'Authorization': `token ${GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github.v3+json'
        }
    });
}


// --- ROUTES API ---

// 1. Login Admin
app.post('/api/login', (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) {
        res.json({ status: 'success', message: 'Login Berhasil' });
    } else {
        res.status(401).json({ status: 'error', message: 'Password Salah!' });
    }
});

// 2. Ambil Data (Live dari GitHub)
app.get('/api/data', async (req, res) => {
    try {
        const result = await getGitHubData();
        res.json(result.data);
    } catch (error) {
        console.error("Gagal ambil data GitHub:", error.response?.data || error.message);
        // Fallback: baca file lokal jika GitHub gagal (misal limit habis)
        try {
            const localData = JSON.parse(fs.readFileSync(path.join(__dirname, 'public', 'data.json'), 'utf8'));
            res.json(localData);
        } catch(e) {
            res.status(500).json({ error: "Gagal membaca database (GitHub & Local)" });
        }
    }
});

// 3. Simpan Data (Commit ke GitHub)
app.post('/api/save', async (req, res) => {
    try {
        const newData = req.body;
        
        // Langkah 1: Ambil SHA terbaru dulu (wajib)
        const current = await getGitHubData();
        
        // Langkah 2: Push update ke GitHub
        await updateGitHubData(newData, current.sha);
        
        res.json({ status: 'success', message: 'Berhasil disimpan permanen ke GitHub!' });
    } catch (error) {
        console.error("Gagal simpan ke GitHub:", error.response?.data || error.message);
        res.status(500).json({ status: 'error', message: 'Gagal menyimpan ke GitHub. Cek Log Vercel.' });
    }
});

// 4. Upload Gambar (Catbox)
app.post('/api/upload', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ status: 'error', message: 'No file uploaded' });

        const form = new FormData();
        form.append('reqtype', 'fileupload');
        form.append('fileToUpload', fs.createReadStream(req.file.path));

        const catboxRes = await axios.post('https://catbox.moe/user/api.php', form, {
            headers: { ...form.getHeaders() }
        });

        try { fs.unlinkSync(req.file.path); } catch(e){}
        res.json({ status: 'success', url: catboxRes.data });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Upload failed' });
    }
});

// 5. Transaksi WA
app.post('/api.php', upload.single('payment_proof'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ status: 'error', message: 'Wajib upload bukti' });

        const form = new FormData();
        form.append('reqtype', 'fileupload');
        form.append('fileToUpload', fs.createReadStream(req.file.path));
        const catboxRes = await axios.post('https://catbox.moe/user/api.php', form, { headers: { ...form.getHeaders() } });
        
        const imageUrl = catboxRes.data; 
        const { item_name, item_price, website_url } = req.body;
        
        const date = new Date();
        const options = { timeZone: "Asia/Jakarta", hour12: false };
        const timeStr = date.toLocaleTimeString('id-ID', options);
        const dateStr = date.toLocaleDateString('id-ID', options);

        let message = `*NEW TRANSACTION RECEIVED*\n\n`;
        message += `*ITEM TYPE : ${item_name}*\n`;
        message += `*PRICE : ${item_price}*\n`;
        message += `*RECEIPT : ${imageUrl}*\n`;
        message += `*TIME : ${timeStr}*\n`;
        message += `*DATE : ${dateStr}*\n`;
        message += `*WEBSITE : ${website_url}*\n\n`;
        message += `\`©️ RAYY SETTING 7 - RS7\``;

        const waUrl = `https://wa.me/${NOMOR_WA}?text=${encodeURIComponent(message)}`;
        try { fs.unlinkSync(req.file.path); } catch(e){}

        res.json({ status: 'success', whatsapp_url: waUrl });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Server Error' });
    }
});

// Serve Frontend
app.get('/admin', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'admin.html')); });
app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

app.listen(PORT, () => { console.log(`Server running on port ${PORT}`); });
