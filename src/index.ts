import express, { Request, Response } from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import { startOfDay, endOfDay } from 'date-fns';

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: '*' }));
app.use(express.json());

const CHURCHES = ["Ibmg Alphaville", "Ibmg Orlando", "Ibmg Sede", "Ibmg Santa Maria", "Ibmg Caldas", "Outra"];

app.get('/', (req, res) => { res.send("Ekklesia API Online 🚀"); });
app.get('/config/churches', (req, res) => res.json(CHURCHES));

app.post('/auth/login', async (req: Request, res: Response) => {
  const { email } = req.body;
  try {
    const user = await prisma.person.findUnique({ where: { email: String(email) } });
    if (!user || user.role !== 'STAFF') return res.status(403).json({ error: "Acesso negado." });
    res.json(user);
  } catch (error) { res.status(500).json({ error: "Erro interno." }); }
});

app.post('/count', async (req: Request, res: Response) => {
  const { checkpointId, type, church, quantity, ageGroup, gender, marketingSource } = req.body;
  try {
    const entry = await prisma.manualEntry.create({
      data: {
        checkpointId, type, church,
        ageGroup: ageGroup || 'ADULTO', gender: gender || 'M', quantity: quantity || 1,
        marketingSource: marketingSource || null, timestamp: new Date()
      }
    });
    res.json({ success: true, entry });
  } catch (error) { res.status(500).json({ error: "Erro ao contar" }); }
});

app.post('/track', async (req: Request, res: Response) => {
  const { personId, checkpointId } = req.body;
  const todayStart = startOfDay(new Date());
  const todayEnd = endOfDay(new Date());

  try {
    // 1. VERIFICA SE JÁ ENTROU NESTE LOCAL HOJE (Lógica Anti-Duplicidade)
    const existing = await prisma.movement.findFirst({
      where: { personId, checkpointId, timestamp: { gte: todayStart, lte: todayEnd } },
      include: { person: true }
    });

    if (existing) {
      // Retorna REENTRY e NÃO CRIA registro novo. O dashboard não somará +1.
      return res.json({ success: true, status: 'REENTRY', person: existing.person, message: `⚠️ Já registrado hoje.` });
    }

    const newMove = await prisma.movement.create({
      data: { personId, checkpointId },
      include: { person: true, checkpoint: true }
    });

    return res.json({ success: true, status: 'SUCCESS', person: newMove.person, message: `✅ Acesso Liberado!` });
  } catch (error) { res.status(500).json({ success: false }); }
});

app.get('/dashboard', async (req, res) => {
  try {
    const eventStart = new Date('2025-01-01T00:00:00');
    const eventEnd = new Date('2026-12-31T23:59:59');

    const [manualEntries, scannerEntries] = await Promise.all([
      prisma.manualEntry.findMany({
        where: { timestamp: { gte: eventStart, lte: eventEnd } },
        include: { checkpoint: { select: { name: true } } }
      }),
      prisma.movement.findMany({
        where: { timestamp: { gte: eventStart, lte: eventEnd } },
        select: {
          timestamp: true,
          checkpoint: { select: { name: true } },
          person: { select: { type: true, gender: true, age: true, church: true, marketingSource: true } }
        }
      })
    ]);

    // Unifica e Normaliza dados para o Frontend
    const allEntries = [
      ...manualEntries.map(e => ({
        timestamp: e.timestamp, quantity: e.quantity, type: e.type, gender: e.gender, ageGroup: e.ageGroup,
        church: e.church, marketing: e.marketingSource, checkpointName: e.checkpoint?.name || 'Indefinido'
      })),
      ...scannerEntries.map(e => ({
        timestamp: e.timestamp, quantity: 1, type: e.person.type, gender: e.person.gender,
        ageGroup: e.person.age ? (e.person.age < 12 ? 'CRIANCA' : e.person.age < 18 ? 'JOVEM' : 'ADULTO') : 'ADULTO',
        church: e.person.church, marketing: e.person.marketingSource, checkpointName: e.checkpoint?.name || 'Indefinido'
      }))
    ];

    // Agrupa dados por Dia > Local para o Frontend processar
    const timeline: Record<string, Record<string, number>> = {};
    const checkpointsData: Record<string, Record<string, any>> = {};

    allEntries.forEach(e => {
      const date = new Date(e.timestamp);
      const day = date.getDate().toString();
      const hour = date.getHours().toString();
      const local = e.checkpointName;

      // Timeline
      if (!timeline[day]) timeline[day] = {};
      if (!timeline[day][hour]) timeline[day][hour] = 0;
      timeline[day][hour] += e.quantity;

      // Checkpoints Data
      if (!checkpointsData[day]) checkpointsData[day] = {};
      if (!checkpointsData[day][local]) {
        checkpointsData[day][local] = {
          total: 0, gender: { M: 0, F: 0 }, age: { CRIANCA: 0, JOVEM: 0, ADULTO: 0 },
          type: { MEMBER: 0, VISITOR: 0 }, marketing: {}, church: {}
        };
      }

      const stats = checkpointsData[day][local];
      stats.total += e.quantity;

      if (e.gender === 'M') stats.gender.M += e.quantity; else if (e.gender === 'F') stats.gender.F += e.quantity;
      if (e.ageGroup === 'CRIANCA') stats.age.CRIANCA += e.quantity; else if (e.ageGroup === 'JOVEM') stats.age.JOVEM += e.quantity; else stats.age.ADULTO += e.quantity;
      if (e.type === 'MEMBER') stats.type.MEMBER += e.quantity; else stats.type.VISITOR += e.quantity;

      if (e.marketing) stats.marketing[e.marketing] = (stats.marketing[e.marketing] || 0) + e.quantity;
      if (e.church) stats.church[e.church] = (stats.church[e.church] || 0) + e.quantity;
    });

    res.json({ timeline, checkpointsData });
  } catch (error) { console.error(error); res.status(500).json({ error: "Erro no dashboard" }); }
});

// --- DEMAIS ROTAS (checkpoints, people, register, export, setup) MANTIDAS IGUAIS ---
app.get('/checkpoints', async (req, res) => { const spots = await prisma.checkpoint.findMany(); res.json(spots); });
app.get('/people', async (req, res) => {
  const { search } = req.query;
  if (!search) return res.json([]);
  const todayStart = startOfDay(new Date());
  const todayEnd = endOfDay(new Date());
  const people = await prisma.person.findMany({
    where: { name: { contains: String(search), mode: 'insensitive' } }, take: 10,
    include: { movements: { where: { timestamp: { gte: todayStart, lte: todayEnd } }, select: { id: true } } }
  });
  res.json(people.map(p => ({ ...p, hasEntered: p.movements.length > 0 })));
});
app.get('/people/incomplete', async (req, res) => {
  const people = await prisma.person.findMany({ where: { OR: [{ gender: null }, { phone: null }, { marketingSource: null }, { age: null }] }, orderBy: { name: 'asc' }, take: 50 });
  res.json(people);
});
app.put('/person/:id', async (req, res) => {
  const { id } = req.params;
  try { const updated = await prisma.person.update({ where: { id }, data: req.body }); res.json(updated); }
  catch (e) { res.status(500).json({ error: "Erro update" }); }
});
app.post('/register', async (req, res) => {
  try { const user = await prisma.person.create({ data: { ...req.body, age: req.body.age ? parseInt(req.body.age) : null, role: req.body.isStaff ? 'STAFF' : 'PARTICIPANT' } }); res.json(user); }
  catch (e) { res.status(400).json({ error: "Erro cadastro" }); }
});
app.get('/export', async (req, res) => {
  const people = await prisma.person.findMany({ orderBy: { createdAt: 'desc' } });
  let csv = "Nome,Idade,Tipo,Genero,Igreja,WhatsApp,Origem,Data\n";
  people.forEach(p => { csv += `${p.name.replace(/,/g, '')},${p.age || ''},${p.type},${p.gender || ''},${p.church || ''},${p.phone || ''},${p.marketingSource || ''},${p.createdAt}\n`; });
  res.header('Content-Type', 'text/csv'); res.attachment('relatorio.csv'); res.send(csv);
});
app.get('/setup', async (req, res) => {
  await prisma.checkpoint.createMany({ data: [{ name: "Recepção / Entrada", category: "GENERAL" }, { name: "Salinha Kids", category: "KIDS" }, { name: "Tenda", category: "PRAYER" }], skipDuplicates: true });
  res.send("Setup OK");
});

if (process.env.NODE_ENV !== 'production') app.listen(PORT, () => console.log(`🔥 Server: ${PORT}`));
export default app;