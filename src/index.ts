process.env.TZ = 'America/Sao_Paulo';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { UPLOAD_DIR } from './lib/upload';

import AuthRoutes from './modules/Auth';
import OperationsRoutes from './modules/Operations';
import MeetingsRoutes from './modules/Meetings';
import DashboardRoutes from './modules/Dashboard';
import ProductsRoutes from './modules/Products';
import OrdersRoutes from './modules/Orders';
import PeopleRoutes from './modules/People'; // ✅ Módulo novo importado

const app = express();
const PORT = process.env.PORT || 3001;

// Configuração de Middlewares
app.use(cors({ origin: '*' }));
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(express.json({ limit: '10mb' })); // Aumentado para suportar fotos
app.use(morgan('dev'));

app.use('/uploads', express.static(UPLOAD_DIR));

app.use('/', PeopleRoutes);

app.use('/auth', AuthRoutes);             // Auth Legado (se houver)
app.use('/operations', OperationsRoutes); // Escalas e Cultos
app.use('/meetings', MeetingsRoutes);     // Reuniões
app.use('/dashboard', DashboardRoutes);   // Gráficos
app.use('/products', ProductsRoutes);     // Produtos
app.use('/orders', OrdersRoutes);         // Vendas e Webhook

// Rota de Teste (Health Check)
app.get('/', (req, res) => {
  res.json({ status: 'API Online 🚀', system: 'Ekklesia v2.0' });
});

app.listen(PORT, () => console.log(`🔥 ECOSSISTEMA ATIVO NA PORTA ${PORT}`));

export default app;