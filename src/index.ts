process.env.TZ = 'America/Sao_Paulo';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { UPLOAD_DIR } from './lib/upload';

// Importação dos Módulos
import AuthRoutes from './modules/Auth';
import OperationsRoutes from './modules/Operations';
import MeetingsRoutes from './modules/Meetings';
import DashboardRoutes from './modules/Dashboard';
import ProductsRoutes from './modules/Products';
import OrdersRoutes from './modules/Orders';
import PeopleRoutes from './modules/People';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: '*' }));
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(express.json({ limit: '10mb' }));
app.use(morgan('dev'));

// Arquivos Estáticos (Imagens da Psalms)
app.use('/uploads', express.static(UPLOAD_DIR));

// Registro das Rotas
app.use('/auth', AuthRoutes);
app.use('/operations', OperationsRoutes);
app.use('/meetings', MeetingsRoutes);
app.use('/dashboard', DashboardRoutes);
app.use('/products', ProductsRoutes);
app.use('/orders', OrdersRoutes);
app.use('/people', PeopleRoutes);


app.get('/', (req, res) => {
  res.json({ status: 'API Online 🚀', system: 'Ekklesia v2.0' });
});

app.listen(PORT, () => console.log(`🔥 ECOSSISTEMA ATIVO NA PORTA ${PORT}`));

export default app;