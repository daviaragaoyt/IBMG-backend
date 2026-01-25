// --- 1. CONFIGURAÇÃO ---
process.env.TZ = 'America/Sao_Paulo';

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { UPLOAD_DIR } from './lib/upload';

// --- IMPORTAÇÃO DOS MÓDULOS ---
import AuthRoutes from './modules/Auth';
import OperationsRoutes from './modules/Operations';
import ProductsRoutes from './modules/Products';
// import SalesRoutes from './modules/Sales';
// import CheckoutRoutes from './modules/Checkout';
import MeetingsRoutes from './modules/Meetings';
import DashboardRoutes from './modules/Dashboard';

// 👇 1. ADICIONE ESTA IMPORTAÇÃO (Se não tiver, dá erro)
import OrdersRoutes from './modules/Orders';

const app = express();
const PORT = process.env.PORT || 3001;

// --- MIDDLEWARES ---
app.use(cors({ origin: '*' }));
// IMPORTANTE: crossOriginResourcePolicy: false permite que o frontend carregue as imagens
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(express.json());
app.use(morgan('dev'));

// Permite acessar as fotos em http://localhost:3001/uploads/nome-do-arquivo.jpg
app.use('/uploads', express.static(UPLOAD_DIR));

// --- ROTAS (MODULARES) ---
app.use(AuthRoutes);
app.use(OperationsRoutes);
app.use(ProductsRoutes);
// app.use(SalesRoutes);
// app.use(CheckoutRoutes);
app.use(MeetingsRoutes);
app.use(DashboardRoutes);

// 👇 2. REGISTRE A ROTA AQUI (Onde acontece o erro 404)
app.use(OrdersRoutes);

// Rota Base
app.get('/', (req, res) => {
  res.json({ status: 'online', timestamp: new Date() });
});

if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => console.log(`🔥 API Modular rodando na porta ${PORT}`));
}

export default app;