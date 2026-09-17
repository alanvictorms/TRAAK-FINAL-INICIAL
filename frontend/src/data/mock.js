// ==================== MOCK DATA ====================
// All data used by the Taxinexo application

export const cities = ["Austin", "Fênix", "Nova Iorque", "Los Angeles", "Atlanta", "Miami", "Washington", "São Francisco"];

const carImages = [
  "https://customer-assets-gfyr7b9c.emergentagent.net/job_ride-earnings-19/artifacts/7xmuoz57_image.png",
  "https://customer-assets-gfyr7b9c.emergentagent.net/job_ride-earnings-19/artifacts/bayxin3w_image.png",
  "https://customer-assets-gfyr7b9c.emergentagent.net/job_ride-earnings-19/artifacts/37nrvmc9_image.png",
  "https://customer-assets-gfyr7b9c.emergentagent.net/job_ride-earnings-19/artifacts/ufz8zext_image.png",
];

export const vehicles = [
  { id: "1399632260154396681", code: "TA-Austin-061", city: "Austin", status: "Operação", scheduled: "Agendado", profit: "R$ 1.180,00 ~ R$ 1.200,00", type: "táxi", cycle: "3 dias", price: "R$ 200", timeLeft: "11:20:10", returnRate: "590% ~ 600%", dailyIncome: "R$ 393,33-400,00", startPrice: "R$ 30,00", kmRate: "R$ 5,00/km", img: carImages[0] },
  { id: "1399632260154396682", code: "TA-Austin-062", city: "Austin", status: "Operação", scheduled: "Agendado", profit: "R$ 3.060,00 ~ R$ 3.111,00", type: "táxi", cycle: "3 dias", price: "R$ 510", timeLeft: "11:20:10", returnRate: "600% ~ 610%", dailyIncome: "R$ 1.020,00-1.037,00", startPrice: "R$ 50,00", kmRate: "R$ 7,00/km", img: carImages[1] },
  { id: "1399632260154396683", code: "TA-Austin-063", city: "Austin", status: "Operação", scheduled: "Agendado", profit: "R$ 5.795,00 ~ R$ 5.890,00", type: "táxi", cycle: "3 dias", price: "R$ 950", timeLeft: "11:20:10", returnRate: "610% ~ 620%", dailyIncome: "R$ 1.931,67-1.963,33", startPrice: "R$ 80,00", kmRate: "R$ 9,00/km", img: carImages[2] },
  { id: "1399632260154396684", code: "TA-Austin-064", city: "Austin", status: "Operação", scheduled: "Agendado", profit: "R$ 9.300,00 ~ R$ 9.450,00", type: "táxi", cycle: "3 dias", price: "R$ 1.500", timeLeft: "11:20:10", returnRate: "620% ~ 630%", dailyIncome: "R$ 3.100,00-3.150,00", startPrice: "R$ 120,00", kmRate: "R$ 12,00/km", img: carImages[3] },
  { id: "1399632260154396685", code: "TA-Austin-065", city: "Austin", status: "Operação", scheduled: "Agendado", profit: "R$ 18.270,00 ~ R$ 18.560,00", type: "táxi", cycle: "3 dias", price: "R$ 2.900", timeLeft: "11:20:10", returnRate: "630% ~ 640%", dailyIncome: "R$ 6.090,00-6.186,67", startPrice: "R$ 200,00", kmRate: "R$ 15,00/km", img: carImages[0] },
  { id: "1399632260154396686", code: "TA-Austin-066", city: "Austin", status: "Operação", scheduled: "Agendado", profit: "R$ 35.200,00 ~ R$ 35.750,00", type: "táxi", cycle: "3 dias", price: "R$ 5.500", timeLeft: "11:20:10", returnRate: "640% ~ 650%", dailyIncome: "R$ 11.733,33-11.916,67", startPrice: "R$ 350,00", kmRate: "R$ 20,00/km", img: carImages[1] },
];

export const orders = [
  { id: "1391916587630133259", status: "Ativo", product: "TA-CAR-022", value: "R$ 190", date: "26/08/2026 22:27:15", qty: 1, paid: "R$ 190" },
  { id: "1389093608705605909", status: "Ativo", product: "TA-CAR-031", value: "R$ 76", date: "19/08/2026 07:52:39", qty: 1, paid: "R$ 76" },
  { id: "1386919088238428160", status: "Ativo", product: "TA-CAR-033", value: "R$ 320", date: "13/08/2026 11:14:24", qty: 1, paid: "R$ 320" },
];

export const news = [
  { id: "1158317534055518208", title: "Sobre a Taxinexo", date: "15/09/2026", type: "institutional" },
  { id: "n2", title: "A TaxiNexo em São Paulo concluiu a construção e está prestes a iniciar oficialmente suas operações.", date: "14/09/2026" },
  { id: "n3", title: "TaxiNexo Acelera a Construção de um Ecossistema para Veículos de Nova Energia", date: "12/09/2026" },
  { id: "n4", title: "Comunicado Oficial Importante da TaxiNexo", date: "10/09/2026" },
  { id: "n5", title: "A Indústria de Condução Autônoma Entrada na Era das Operações em Grande Escala", date: "08/09/2026" },
  { id: "n6", title: "TaxiNexo Acelera Expansão Global", date: "05/09/2026" },
  { id: "n7", title: "A filial brasileira da TaxiNexo foi oficialmente inaugurada", date: "02/09/2026" },
  { id: "n8", title: "Apresentação de Oportunidade — Taxinexo Brasil", date: "28/08/2026" },
  { id: "n9", title: "TaxiNexo: Tornando o Transporte Sustentável Mais Acessível", date: "25/08/2026" },
  { id: "n10", title: "Redefinindo a Mobilidade Autônoma", date: "22/08/2026" },
  { id: "n11", title: "Taxinexo funciona com Uber para facilitar o trabalho Robotaxi de dirigir Uber", date: "20/08/2026" },
  { id: "n12", title: "Relatório Técnico da Táxi Nexo | Capítulo sobre o Modelo Econômico de Frota Compartilhada", date: "18/08/2026" },
];

export const tripRecords = [
  { id: "1391916656349614421", orderTime: "17/09/2026 12:16:36", endTime: "17/09/2026 12:33:06", duration: "00:16:30", distance: "11,13 km", value: "R$ 0,62" },
  { id: "1391916656349614420", orderTime: "17/09/2026 11:16:09", endTime: "17/09/2026 11:41:25", duration: "00:25:16", distance: "17,44 km", value: "R$ 0,89" },
  { id: "1391916656349614419", orderTime: "17/09/2026 10:30:17", endTime: "17/09/2026 10:43:53", duration: "00:13:36", distance: "8,13 km", value: "R$ 0,48" },
  { id: "1391916656349614412", orderTime: "17/09/2026 03:16:09", endTime: "17/09/2026 04:40:42", duration: "01:24:33", distance: "78,08 km", value: "R$ 3,64" },
  { id: "1391916656349614411", orderTime: "17/09/2026 02:01:44", endTime: "17/09/2026 02:22:10", duration: "00:20:26", distance: "14,20 km", value: "R$ 0,75" },
  { id: "1391916656349614410", orderTime: "17/09/2026 00:45:12", endTime: "17/09/2026 01:15:33", duration: "00:30:21", distance: "22,50 km", value: "R$ 1,12" },
];

export const teamMembers = [
  { phone: "85999718026", date: "26/08/2026 22:04:55", vehicles: "R$ 65,55", level: "B", status: "Eficiente" },
  { phone: "88900001122", date: "16/09/2026 14:37:49", vehicles: "R$ 0", level: "B", status: "Inválido" },
  { phone: "11914869856", date: "19/08/2026 23:35:39", vehicles: "R$ 0", level: "B", status: "Inválido" },
];

export const inviteRewards = [
  { product: "TA-Atlanta-061", multiplier: "X1", value: "+30", user: "85999718026", date: "26/08/2026 22:26:27", status: "Recebido" },
];

export const fragments = [
  { id: "1385563892912521216", name: "Celular", progress: 50, redeemable: 0, items: [
    { name: "Fragmentos de celular(1)", has: 1, need: 1, progress: 100 },
    { name: "Fragmentos de celular(2)", has: 0, need: 1, progress: 0 },
  ]},
];

export const userProfile = {
  phone: "85997967804",
  level: "LV1",
  code: "F8V44T",
  type: "comum",
  balance: "0",
  luckyValue: "0",
  earningsBalance: "0",
  todayEarnings: "0",
  totalEarnings: "0",
  tipIncome: "0",
  incomeValue: "0",
  toTransfer: "0",
};

export const pixAccounts = [
  { type: "TELEFONE", name: "Bruno Luís Fontenele Ferreira Duarte", key: "85986878662" },
];

export const aboutInfo = {
  founder: "James Miller",
  hq: "Boston, Massachusetts, EUA",
  team: [
    { role: "CEO", name: "James Miller" },
    { role: "COO", name: "Robert Davis" },
    { role: "CFO", name: "Victoria Bennett" },
    { role: "Gerente", name: "Elizabeth Taylor" },
    { role: "Diretor", name: "Thomas Wilson" },
    { role: "VP", name: "Ethan Brown" },
  ],
  cnpj: "67.702.335/0001-22",
  address: "66 John St, 2ndar, Nova York, NY 10038",
  emails: ["service@taxinexo.com.mp", "taxinexo@gmail.com"],
};
