process.env.TZ = 'America/Sao_Paulo';
import express, { Request, Response } from 'express';

import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import {
  PrismaClient,
  PersonType,
  Role,
  CheckpointCategory
} from '@prisma/client';
import { startOfDay, endOfDay } from 'date-fns';
import { z } from 'zod';

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3001;

// --- MIDDLEWARES ---
app.use(cors({ origin: '*' }));
app.use(helmet());
app.use(express.json());
app.use(morgan('dev'));

// --- CONSTANTES ---
const CHURCHES = [
  "Ibmg Alphaville", "Ibmg Orlando", "Ibmg Sede", "Ibmg Santa Maria", "Ibmg Caldas", "Outra"
];

// Categorias que permitem reentrada (Bipar várias vezes no dia)
const SERVICE_CATEGORIES = ['PROPHETIC', 'PRAYER', 'EVANGELISM', 'CONSOLIDATION', 'STORE'];

// --- VALIDAÇÕES ZOD ---
const CountSchema = z.object({
  checkpointId: z.string().min(1),
  type: z.enum(['MEMBER', 'VISITOR']),
  church: z.string().optional(),
  quantity: z.number().min(1).default(1),
  ageGroup: z.string().optional(),
  gender: z.string().optional(),
  marketingSource: z.string().nullable().optional()
});

const RegisterSchema = z.object({
  name: z.string().min(3),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional().nullable(),
  type: z.enum(['MEMBER', 'VISITOR', 'LEADER', 'PASTOR']).default('VISITOR'),
  church: z.string().optional(),
  gender: z.string().optional(),
  marketingSource: z.string().optional(),
  age: z.union([z.string(), z.number()]).optional(),
  isStaff: z.boolean().optional()
});

// --- ROTAS BÁSICAS ---
app.get('/', (req, res) => {
  res.json({ status: 'online', timestamp: new Date() });
});

app.get('/config/churches', (req, res) => res.json(CHURCHES));

app.post('/auth/login', async (req: Request, res: Response) => {
  const { email } = req.body;
  try {
    if (!email) return res.status(400).json({ error: "E-mail obrigatório" });

    const user = await prisma.person.findFirst({
      where: {
        email: {
          equals: String(email).trim(),
          mode: 'insensitive'
        }
      }
    });

    if (!user) return res.status(404).json({ error: "E-mail não encontrado." });

    console.log(`[LOGIN] ${user.name} (${user.role}) acessou.`);
    res.json(user);
  } catch (error) {
    console.error("Erro Login:", error);
    res.status(500).json({ error: "Erro interno no servidor." });
  }
});
app.get('/person/by-email', async (req: Request, res: Response) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: "E-mail obrigatório." });

  try {
    const person = await prisma.person.findFirst({
      where: {
        email: {
          equals: String(email).trim(),
          mode: 'insensitive'
        }
      }
    });

    if (!person) return res.status(404).json({ error: "E-mail não encontrado." });
    res.json(person);
  } catch (error) {
    res.status(500).json({ error: "Erro interno." });
  }
});
app.post('/count', async (req: Request, res: Response) => {
  try {
    const data = CountSchema.parse(req.body);

    // Verifica se o último registro foi idêntico e feito há menos de 2 segundos
    const lastEntry = await prisma.manualEntry.findFirst({
      where: { checkpointId: data.checkpointId, type: data.type as PersonType },
      orderBy: { timestamp: 'desc' }
    });

    if (lastEntry) {
      const diff = new Date().getTime() - new Date(lastEntry.timestamp).getTime();
      if (diff < 2000 && lastEntry.gender === data.gender && lastEntry.ageGroup === data.ageGroup) {
        return res.json({ success: true, message: "Duplicidade evitada", ignored: true });
      }
    }

    const entry = await prisma.manualEntry.create({
      data: {
        checkpointId: data.checkpointId,
        type: data.type as PersonType,
        church: data.church || 'Ibmg Sede',
        ageGroup: data.ageGroup || 'ADULTO',
        gender: data.gender || 'M',
        quantity: data.quantity,
        marketingSource: data.marketingSource || null,
        timestamp: new Date()
      }
    });

    // Retorna o total do dia para feedback visual imediato
    const todayStart = startOfDay(new Date());
    const todayEnd = endOfDay(new Date());
    const totalToday = await prisma.manualEntry.aggregate({
      where: {
        checkpointId: data.checkpointId,
        timestamp: { gte: todayStart, lte: todayEnd }
      },
      _sum: { quantity: true }
    });

    res.json({ success: true, totalToday: totalToday._sum.quantity || 0, entry });
  } catch (error) {
    res.status(400).json({ error: "Erro ao registrar contagem." });
  }
});

// Scanner QR Code (Tracking com lógica de reentrada)
app.post('/track', async (req: Request, res: Response) => {
  const { personId, checkpointId } = req.body;
  if (!personId || !checkpointId) return res.status(400).json({ error: "IDs obrigatórios" });

  try {
    const checkpoint = await prisma.checkpoint.findUnique({ where: { id: checkpointId } });
    if (!checkpoint) return res.status(404).json({ error: "Local não encontrado" });

    const allowReentry = SERVICE_CATEGORIES.includes(String(checkpoint.category));
    const todayStart = startOfDay(new Date());
    const todayEnd = endOfDay(new Date());

    const existing = await prisma.movement.findFirst({
      where: {
        personId,
        checkpointId,
        timestamp: { gte: todayStart, lte: todayEnd }
      },
      include: { person: true }
    });

    // Rate Limit de 60 segundos para evitar leitura dupla acidental
    if (existing) {
      const diff = (new Date().getTime() - new Date(existing.timestamp).getTime()) / 1000;
      if (diff < 60) return res.json({ success: true, status: 'IGNORED', person: existing.person, message: "⏳ Aguarde..." });

      if (!allowReentry) {
        return res.json({
          success: true,
          status: 'REENTRY',
          person: existing.person,
          message: `⚠️ ${existing.person.name.split(' ')[0]} já entrou hoje.`
        });
      }
    }

    const newMove = await prisma.movement.create({
      data: { personId, checkpointId },
      include: { person: true, checkpoint: true }
    });

    return res.json({
      success: true,
      status: 'SUCCESS',
      person: newMove.person,
      message: allowReentry ? "✅ Atendimento registrado!" : "✅ Acesso Liberado!"
    });

  } catch (error) {
    res.status(500).json({ success: false, error: "Erro interno" });
  }
});
app.get('/dashboard', async (req, res) => {
  try {

    const start = new Date('2026-02-01');
    const end = new Date('2026-02-28');

    const [manual, scanner] = await Promise.all([
      prisma.manualEntry.findMany({
        where: { timestamp: { gte: start, lte: end } },
        include: { checkpoint: true }
      }),
      prisma.movement.findMany({
        where: { timestamp: { gte: start, lte: end } },
        select: { timestamp: true, checkpoint: true, person: true }
      })
    ]);
    const all = [
      ...manual.map(e => ({
        ts: e.timestamp, qty: e.quantity, type: e.type, gender: e.gender, age: e.ageGroup,
        church: e.church, mkt: e.marketingSource, loc: e.checkpoint?.name
      })),
      ...scanner.map(e => ({
        ts: e.timestamp, qty: 1, type: e.person.type, gender: e.person.gender,
        age: (e.person.age && e.person.age <= 12) ? 'CRIANCA' : (e.person.age && e.person.age <= 18) ? 'JOVEM' : 'ADULTO',
        church: e.person.church, mkt: e.person.marketingSource, loc: e.checkpoint?.name
      }))
    ];

    const timeline: any = {};
    const checkpointsData: any = {};

    all.forEach(e => {
      const d = new Date(e.ts);
      const day = d.getDate().toString();
      const hour = d.getHours().toString();
      const loc = e.loc || 'Indefinido';

      if (!timeline[day]) timeline[day] = {};
      if (!timeline[day][hour]) timeline[day][hour] = 0;
      timeline[day][hour] += e.qty;

      if (!checkpointsData[day]) checkpointsData[day] = {};
      if (!checkpointsData[day][loc]) checkpointsData[day][loc] = {
        total: 0, type: { MEMBER: 0, VISITOR: 0 }, gender: { M: 0, F: 0 },
        age: { CRIANCA: 0, JOVEM: 0, ADULTO: 0 }, marketing: {}, church: {}
      };

      const st = checkpointsData[day][loc];
      st.total += e.qty;

      if (String(e.type).includes('MEMBER')) st.type.MEMBER += e.qty; else st.type.VISITOR += e.qty;
      if (String(e.gender).startsWith('M')) st.gender.M += e.qty; else st.gender.F += e.qty;
      if (String(e.age).includes('CRIANCA')) st.age.CRIANCA += e.qty; else if (String(e.age).includes('JOVEM')) st.age.JOVEM += e.qty; else st.age.ADULTO += e.qty;
      if (e.mkt) st.marketing[e.mkt] = (st.marketing[e.mkt] || 0) + e.qty;
      if (e.church) st.church[e.church] = (st.church[e.church] || 0) + e.qty;
    });

    res.json({ timeline, checkpointsData });
  } catch (e) {
    res.status(500).json({ error: "Erro dashboard" });
  }
});

app.get('/checkpoints', async (req, res) => {
  const list = await prisma.checkpoint.findMany({ orderBy: { name: 'asc' } });
  res.json(list);
});

app.get('/people', async (req, res) => {
  const { search } = req.query;
  if (!search || String(search).length < 3) return res.json([]);

  const people = await prisma.person.findMany({
    where: { name: { contains: String(search), mode: 'insensitive' } },
    take: 15,
    include: {
      movements: {
        where: { timestamp: { gte: startOfDay(new Date()) } },
        select: { id: true, checkpoint: { select: { name: true } } }
      }
    }
  });

  res.json(people.map(p => ({
    ...p,
    hasEntered: p.movements.length > 0,
    lastLocation: p.movements[0]?.checkpoint.name
  })));
});

app.get('/people/incomplete', async (req, res) => {
  const incomplete = await prisma.person.findMany({
    where: {
      OR: [{ gender: null }, { phone: null }, { marketingSource: null }, { age: null }]
    },
    take: 50
  });
  res.json(incomplete);
});
app.put('/person/:id', async (req, res) => {
  const { id } = req.params;
  const { age, ...rest } = req.body; // Separa a idade do resto dos dados

  try {
    const updated = await prisma.person.update({
      where: { id },
      data: {
        ...rest, // Salva nome, telefone, genero, etc.
        // O PULO DO GATO: Converte idade para Número se ela existir
        age: age ? Number(age) : undefined
      }
    });
    res.json(updated);
  }
  catch (e) {
    console.error("Erro ao atualizar:", e);
    res.status(500).json({ error: "Erro update" });
  }
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
  } catch (e: any) {
    res.status(400).json({ error: e.code === 'P2002' ? "Email duplicado" : "Erro cadastro" });
  }
});

app.get('/export', async (req, res) => {
  try {
    const data = await prisma.person.findMany({ orderBy: { createdAt: 'desc' } });
    let csv = "Nome,Email,Tipo,Genero,Igreja,Origem\n";
    data.forEach(p => csv += `${p.name},${p.email},${p.type},${p.gender},${p.church},${p.marketingSource}\n`);
    res.header('Content-Type', 'text/csv').attachment('dados.csv').send(csv);
  } catch (e) {
    res.status(500).send("Erro exportação");
  }
});

app.get('/setup', async (req, res) => {
  try {
    await prisma.checkpoint.createMany({
      data: [
        { name: "Recepção / Entrada", category: CheckpointCategory.GENERAL },
        { name: "Psalms", category: CheckpointCategory.STORE },
        { name: "Salinha Kids", category: CheckpointCategory.KIDS },
        { name: "Tenda de Oração", category: CheckpointCategory.PRAYER },
        { name: "Cantina", category: CheckpointCategory.PRAYER },
        { name: "Casa dos Mártires", category: CheckpointCategory.PRAYER },
        { name: "Sala Profética", category: CheckpointCategory.PROPHETIC },
        { name: "Livraria", category: CheckpointCategory.STORE }
      ],
      skipDuplicates: true
    });
    res.send("Setup OK");
  } catch (e) { res.status(500).send("Erro setup: " + e); }
});

if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => console.log(`🔥 API rodando na porta ${PORT}`));
}

export default app;