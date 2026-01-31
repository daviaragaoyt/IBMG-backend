// src/server.ts
process.env.TZ = 'America/Sao_Paulo';

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { UPLOAD_DIR } from './lib/upload';

// IMPORTANTE: Importar os Módulos das Rotas
import AuthRoutes from './modules/Auth';
import OperationsRoutes from './modules/Operations';
import MeetingsRoutes from './modules/Meetings';
import DashboardRoutes from './modules/Dashboard';
// 👇 Estes são os que estavam faltando ou mal configurados
import ProductsRoutes from './modules/Products';
import OrdersRoutes from './modules/Orders';

const app = express();
const PORT = process.env.PORT || 3001;

// Configurações de Segurança e Logs
app.use(cors({ origin: '*' })); // Permite acesso do Frontend
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(express.json({ limit: '10mb' }));
app.use(morgan('dev'));

// Arquivos Estáticos (Imagens)
app.use('/uploads', express.static(UPLOAD_DIR));

// === REGISTRO DE ROTAS (AQUI É A CORREÇÃO DO 404) ===
app.use(AuthRoutes);
app.use(OperationsRoutes);
app.use(MeetingsRoutes);
app.use(DashboardRoutes);

// Rotas da Loja e Pagamento
app.use('/products', ProductsRoutes); // Corrige o erro GET /products 404
app.use('/orders', OrdersRoutes);     // Corrige o erro POST /orders 500 (agora aponta pro lugar certo)

// Rota de Teste (Health Check)
app.get('/', (req, res) => {
  res.json({ status: 'API Online 🚀', system: 'Ekklesia v2.0' });
});

if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => console.log(`🔥 Servidor rodando na porta ${PORT}`));
}

export default app;