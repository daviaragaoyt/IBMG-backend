// --- 1. CONFIGURAÇÃO ---
process.env.TZ = 'America/Sao_Paulo';

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { prisma } from './lib/prisma';
import { UPLOAD_DIR } from './lib/upload';

// --- IMPORTAÇÃO DOS MÓDULOS ---
import AuthRoutes from './modules/Auth';
import OperationsRoutes from './modules/Operations';
import ProductsRoutes from './modules/Products';
import SalesRoutes from './modules/Sales';
import CheckoutRoutes from './modules/Checkout';
import MeetingsRoutes from './modules/Meetings';
import DashboardRoutes from './modules/Dashboard';

const app = express();
const PORT = process.env.PORT || 3001;

// --- MIDDLEWARES ---
app.use(cors({ origin: '*' }));
app.use(helmet({ crossOriginResourcePolicy: false })); // Permite imagens
app.use(express.json());
app.use(morgan('dev'));
app.use('/uploads', express.static(UPLOAD_DIR)); // Serve os comprovantes

// --- ROTAS (MODULARES) ---
app.use(AuthRoutes);
app.use(OperationsRoutes);
app.use(ProductsRoutes);
app.use(SalesRoutes);
app.use(CheckoutRoutes);
app.use(MeetingsRoutes);
app.use(DashboardRoutes);

// Rota Base
app.get('/', (req, res) => {
  res.json({ status: 'online', timestamp: new Date() });
});

// Setup Inicial (Opcional, pode manter aqui ou mover para um módulo System)
app.get('/setup', async (req, res) => {
  // ... (Sua lógica de setup pode ficar aqui ou em um arquivo separado)
  res.send("Setup deve ser rodado via 'npx ts-node prisma/seed.ts'");
});

if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => console.log(`🔥 API Modular rodando na porta ${PORT}`));
}

export default app;