process.env.TZ = 'America/Sao_Paulo';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { z } from 'zod';
import { PersonType, Role } from '@prisma/client';
import { UPLOAD_DIR } from './lib/upload';
import { prisma } from './lib/prisma';

// --- IMPORTAÇÃO DOS MÓDULOS ---
import OperationsRoutes from './modules/Operations';
import MeetingsRoutes from './modules/Meetings';
import DashboardRoutes from './modules/Dashboard';
import ProductsRoutes from './modules/Products';
import OrdersRoutes from './modules/Orders'; // 👈 IMPORTANTE: Módulo de Pedidos

const app = express();
const PORT = process.env.PORT || 3001;

// --- MIDDLEWARES ---
app.use(cors({ origin: '*' }));
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(express.json({ limit: '10mb' }));
app.use(morgan('dev'));

// Pasta de Uploads Pública
app.use('/uploads', express.static(UPLOAD_DIR));

// =========================================================
// 🔐 AUTENTICAÇÃO E REGISTRO (Rotas Base)
// =========================================================

// 1. LOGIN STAFF
app.post('/auth/login', async (req, res) => {
  const { email } = req.body;
  console.log(`🔑 Tentativa de Login: ${email}`);

  try {
    if (!email) return res.status(400).json({ error: "E-mail obrigatório" });

    const user = await prisma.person.findFirst({
      where: {
        email: { equals: String(email).trim(), mode: 'insensitive' },
        role: 'STAFF'
      }
    });

    if (!user) {
      console.log("❌ Negado: Usuário não encontrado ou não é STAFF.");
      return res.status(404).json({ error: "Acesso negado. E-mail não é Staff." });
    }

    console.log(`✅ Logado: ${user.name}`);
    res.json(user);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erro interno." });
  }
});

// 2. SCHEMA DE VALIDAÇÃO
const RegisterSchema = z.object({
  name: z.string().min(3),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional().nullable(),
  type: z.enum(['MEMBER', 'VISITOR', 'LEADER', 'PASTOR', 'STAFF']).default('VISITOR'),
  department: z.string().optional(),
  church: z.string().optional(),
  gender: z.string().optional(),
  marketingSource: z.string().optional(),
  age: z.union([z.string(), z.number()]).optional(),
  isStaff: z.boolean().optional()
});

app.post('/register', async (req, res) => {
  try {
    const d = RegisterSchema.parse(req.body);
    const user = await prisma.person.create({
      data: {
        ...d,
        age: Number(d.age) || null,
        type: d.type as PersonType,
        role: d.isStaff ? Role.STAFF : Role.PARTICIPANT
      }
    });
    res.json(user);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: "Erro nos dados de registro" });
  }
});

// 4. BUSCAR PESSOA POR EMAIL
app.get('/person/by-email', async (req, res) => {
  const { email } = req.query;
  try {
    const person = await prisma.person.findFirst({
      where: { email: { equals: String(email).trim(), mode: 'insensitive' } }
    });
    if (!person) return res.status(404).json({ error: "Não encontrado." });
    res.json(person);
  } catch (error) { res.status(500).json({ error: "Erro interno." }); }
});
// Redirecionamento de segurança para checkpoints
app.get('/checkpoints', (req, res) => res.redirect(307, '/operations/checkpoints'));

app.use('/dashboard', DashboardRoutes);
app.use('/operations', OperationsRoutes);
app.use('/meetings', MeetingsRoutes);
app.use('/products', ProductsRoutes);
app.use('/orders', OrdersRoutes); // 👈 AQUI! Isso faz a tela de Pedidos funcionar.


// Rota de Teste Base
app.get('/', (req, res) => {
  res.json({ status: 'API Online 🚀', system: 'Ekklesia v2.0 - Full Features' });
});

// Inicialização
app.listen(PORT, () => console.log(`🔥 ECOSSISTEMA ATIVO NA PORTA ${PORT}`));

export default app;