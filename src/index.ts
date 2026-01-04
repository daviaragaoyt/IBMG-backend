import express, { Request, Response } from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import { startOfDay, endOfDay } from 'date-fns';

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: '*' }));
app.use(express.json());

// --- CONFIGURAÇÕES ---
const CHURCHES = [
  "Ibmg Alphaville", "Ibmg Orlando", "Ibmg Sede", "Ibmg Santa Maria", "Ibmg Caldas", "Outra"
];

app.get('/', (req, res) => { res.send("Ekklesia API Online (Neon DB) 🚀"); });
app.get('/config/churches', (req, res) => res.json(CHURCHES));

// --- 1. AUTENTICAÇÃO STAFF ---
app.post('/auth/login', async (req: Request, res: Response) => {
  const { email } = req.body;
  try {
    const user = await prisma.person.findUnique({ where: { email: String(email) } });
    if (!user) return res.status(404).json({ error: "E-mail não encontrado." });
    if (user.role !== 'STAFF') return res.status(403).json({ error: "Acesso negado. Apenas Staff." });
    res.json(user);
  } catch (error) { res.status(500).json({ error: "Erro interno." }); }
});

// --- 2. CONTADOR MANUAL ---
app.post('/count', async (req: Request, res: Response) => {
  const { checkpointId, type, church, quantity, ageGroup } = req.body;
  if (!checkpointId || !type) return res.status(400).json({ error: "Dados faltando" });

  try {
    const entry = await prisma.manualEntry.create({
      data: {
        checkpointId,
        type, church, ageGroup: ageGroup || 'ADULTO',
        quantity: quantity || 1,
        timestamp: new Date()
      }
    });

    // Total de HOJE
    const todayStart = startOfDay(new Date());
    const todayEnd = endOfDay(new Date());
    const totalToday = await prisma.manualEntry.count({
      where: { checkpointId, timestamp: { gte: todayStart, lte: todayEnd } }
    });

    res.json({ success: true, totalToday, entry });
  } catch (error) { res.status(500).json({ error: "Erro ao contar" }); }
});

// --- 3. TRACKING QR CODE ---
app.post('/track', async (req: Request, res: Response) => {
  const { personId, checkpointId } = req.body;
  const todayStart = startOfDay(new Date());
  const todayEnd = endOfDay(new Date());

  try {
    const existing = await prisma.movement.findFirst({
      where: {
        personId, checkpointId,
        timestamp: { gte: todayStart, lte: todayEnd }
      },
      include: { person: true, checkpoint: true }
    });

    if (existing) {
      return res.json({ success: true, status: 'REENTRY', person: existing.person, message: `⚠️ Já registrado hoje.` });
    }

    const newMove = await prisma.movement.create({
      data: { personId, checkpointId },
      include: { person: true, checkpoint: true }
    });

    return res.json({ success: true, status: 'SUCCESS', person: newMove.person, message: `✅ Acesso Liberado!` });
  } catch (error) { res.status(500).json({ success: false }); }
});

// --- 4. DASHBOARD ---
app.get('/dashboard', async (req, res) => {
  try {
    const todayStart = startOfDay(new Date());
    const todayEnd = endOfDay(new Date());

    const qrStats = await prisma.movement.groupBy({
      by: ['checkpointId'],
      where: { timestamp: { gte: todayStart, lte: todayEnd } },
      _count: { id: true }
    });

    const manualStats = await prisma.manualEntry.groupBy({
      by: ['checkpointId'],
      where: { timestamp: { gte: todayStart, lte: todayEnd } },
      _sum: { quantity: true }
    });

    const checkpoints = await prisma.checkpoint.findMany();

    const report = checkpoints.map(cp => {
      const qr = qrStats.find(q => q.checkpointId === cp.id)?._count.id || 0;
      const manual = manualStats.find(m => m.checkpointId === cp.id)?._sum.quantity || 0;
      return { name: cp.name, totalToday: qr + manual };
    });

    res.json({ date: new Date(), stats: report });
  } catch (error) { res.status(500).json({ error: "Erro no dashboard" }); }
});

app.get('/setup', async (req, res) => {
  try {
    // 1. Criar os Locais
    await prisma.checkpoint.createMany({
      data: [
        { name: "Recepção / Entrada", category: "GENERAL" },
        { name: "Sala Profética", category: "PROPHETIC" },
        { name: "Consolidação", category: "CONSOLIDATION" },
        { name: "Kombi Evangelista", category: "EVANGELISM" },
        { name: "Tenda de Oração", category: "PRAYER" },
      ],
      skipDuplicates: true
    });

    // 2. Criar o SEU Usuário Admin (Mude os dados aqui se quiser)
    const adminEmail = "davi@ibmg.com"; // <--- SEU EMAIL AQUI

    // O upsert cria se não existir, ou não faz nada se já existir
    const admin = await prisma.person.upsert({
      where: { email: adminEmail },
      update: { role: 'STAFF' }, // Garante que é STAFF
      create: {
        name: "Davi Admin",
        email: adminEmail,
        type: "MEMBER",
        role: "STAFF", // Importante: Dá permissão de acesso
        church: "Ibmg Sede",
        age: 25
      }
    });

    res.send(`✅ Setup Concluído!<br>Locais criados.<br>Admin criado: <b>${admin.email}</b>`);
  } catch (error) {
    res.status(500).send("Erro no setup: " + error);
  }
});
app.post('/register', async (req, res) => {
  const { name, email, type, church, age } = req.body;
  try {
    const user = await prisma.person.create({
      data: { name, email: email || null, type, church, age: age ? parseInt(age) : null }
    });
    res.json(user);
  } catch (e) { res.status(400).json({ error: "Erro no cadastro." }); }
});

// Utilitários
app.get('/checkpoints', async (req, res) => {
  const spots = await prisma.checkpoint.findMany();
  res.json(spots);
});

app.get('/people', async (req, res) => {
  const { search } = req.query;
  if (!search) return res.json([]);
  const people = await prisma.person.findMany({
    where: { name: { contains: String(search), mode: 'insensitive' } }, // Mode insensitive funciona no Postgres
    take: 10
  });
  res.json(people);
});

app.get('/person/by-email', async (req, res) => {
  const { email } = req.query;
  const person = await prisma.person.findUnique({ where: { email: String(email) } });
  person ? res.json(person) : res.status(404).json({ error: "Não encontrado" });
});

app.get('/make-admin', async (req, res) => {
  const { email } = req.query;
  if (!email) return res.send("?email=...");
  await prisma.person.update({ where: { email: String(email) }, data: { role: 'STAFF' } });
  res.send("OK");
});

app.listen(PORT, () => { console.log(`🔥 Servidor Neon rodando na porta ${PORT}`); });

if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`🔥 Servidor local rodando na porta ${PORT}`);
  });
}

// Exporta o app para a Vercel (Isso é obrigatório)
export default app;
