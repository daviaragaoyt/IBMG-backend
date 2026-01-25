import multer from 'multer';
import path from 'path';
import fs from 'fs';

// Define onde salvar (pasta 'uploads' na raiz do projeto)
export const UPLOAD_DIR = path.resolve(__dirname, '..', '..', 'uploads');

// Cria a pasta se não existir
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {

        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, `proof-${uniqueSuffix}${ext}`);
    }
});

export const upload = multer({ storage });