import { Alert, Card, Image, Space, Table, Tabs, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { User } from "../types";

/**
 * Встроенный гид по системе (подход Steppo/Scribe): ролевые треки, для каждого
 * процесса — цель/кому/где + пошагово «какую кнопку жать → что будет» с
 * реальными скриншотами (public/guide, пересъёмка: node scripts/shoot-guide.mjs)
 * + граф процесса ТДО.
 */

// ----------------------------------------------------------------- примитивы
function ProcMeta({ goal, who, where }: { goal: string; who: string; where: string }): JSX.Element {
  return (
    <Space direction="vertical" size={2} style={{ marginBottom: 12 }}>
      <Typography.Text><b>🎯 Цель:</b> {goal}</Typography.Text>
      <Typography.Text><b>👤 Кому доступно:</b> {who}</Typography.Text>
      <Typography.Text><b>📍 Где в системе:</b> {where}</Typography.Text>
    </Space>
  );
}

interface Step {
  title: string;
  body: JSX.Element | string;
  shot?: string;      // имя файла в public/guide без расширения
  tip?: string;
  warn?: string;
}

function Steppo({ steps }: { steps: Step[] }): JSX.Element {
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      {steps.map((s, i) => (
        <div key={i} style={{ display: "flex", gap: 12 }}>
          <div
            style={{
              flex: "0 0 28px", height: 28, borderRadius: "50%", background: "#1677ff",
              color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
              fontWeight: 600, fontSize: 14, marginTop: 2,
            }}
          >
            {i + 1}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Typography.Text strong>{s.title}</Typography.Text>
            <Typography.Paragraph style={{ margin: "4px 0 8px" }}>{s.body}</Typography.Paragraph>
            {s.shot && (
              <Image
                src={`/guide/${s.shot}.png`}
                alt={s.title}
                style={{ maxWidth: 720, width: "100%", border: "1px solid #e5e7eb", borderRadius: 8 }}
                loading="lazy"
              />
            )}
            {s.tip && <Alert style={{ marginTop: 8 }} type="info" showIcon message={s.tip} />}
            {s.warn && <Alert style={{ marginTop: 8 }} type="warning" showIcon message={s.warn} />}
          </div>
        </div>
      ))}
    </Space>
  );
}

function Kbd({ children }: { children: string }): JSX.Element {
  return (
    <Typography.Text code style={{ background: "#f0f5ff", borderColor: "#adc6ff" }}>
      {children}
    </Typography.Text>
  );
}

// ----------------------------------------------------------------- граф ТДО
function WorkflowGraph(): JSX.Element {
  const box = (x: number, y: number, w: number, label: string, sub: string, fill = "#fff") => (
    <g key={label}>
      <rect x={x} y={y} width={w} height={54} rx={10} fill={fill} stroke="#d0d5dd" />
      <text x={x + w / 2} y={y + 23} textAnchor="middle" fontSize={13} fontWeight={600} fill="#111">{label}</text>
      <text x={x + w / 2} y={y + 41} textAnchor="middle" fontSize={11} fill="#555">{sub}</text>
    </g>
  );
  const arrow = (x1: number, y1: number, x2: number, y2: number, dash = false) => (
    <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#667085" strokeWidth={1.6}
      markerEnd="url(#arr)" strokeDasharray={dash ? "5 4" : undefined} />
  );
  return (
    <div style={{ overflowX: "auto" }}>
      <svg viewBox="0 0 980 320" style={{ minWidth: 900, width: "100%" }} role="img" aria-label="Граф процесса ТДО">
        <defs>
          <marker id="arr" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" fill="#667085" />
          </marker>
        </defs>
        <rect x={8} y={28} width={964} height={118} rx={12} fill="#f6ffed" opacity={0.6} />
        <rect x={8} y={172} width={964} height={118} rx={12} fill="#e6f4ff" opacity={0.6} />
        <text x={20} y={20} fontSize={12} fontWeight={700} fill="#3f6600">ПОДРЯДЧИК (рук. ТДО · разработчик)</text>
        <text x={20} y={166} fontSize={12} fontWeight={700} fill="#003eb3">ЗАКАЗЧИК (LR · R)</text>

        {box(20, 58, 145, "1. Документ в МДР", "рук. ТДО · план сроков")}
        {box(195, 58, 140, "2. Ревизия + PDF", "разработчик · IFR")}
        {box(365, 58, 140, "3. Очередь ТРМ", "рук. ТДО · решение")}
        {box(365, 205, 150, "4. Ревью заказчика", "LR + R · замечания")}
        {box(550, 205, 120, "5. CRS", "LR · отправка")}
        {box(550, 58, 150, "6. Ответ подрядчика", "разработчик · A / I")}
        {box(715, 205, 140, "7. Carry-over", "LR · устранено?")}
        {box(730, 58, 115, "Новая ревизия", "цикл B, C…", "#fffbe6")}
        {box(870, 131, 102, "AFD + AP", "закрыт · 100%", "#f6ffed")}

        {arrow(165, 85, 195, 85)}
        {arrow(335, 85, 365, 85)}
        {arrow(435, 112, 435, 205)}
        {arrow(515, 232, 550, 232)}
        {arrow(610, 205, 615, 112)}
        {arrow(700, 92, 760, 205)}
        {arrow(770, 205, 785, 112, true)}
        {arrow(855, 219, 902, 185)}
        <text x={700} y={168} fontSize={10} fill="#ad6800">не устранено → новый цикл</text>
        <text x={856} y={240} fontSize={10} fill="#3f6600">всё устранено</text>
      </svg>
    </div>
  );
}

// ----------------------------------------------------------------- матрица прав
interface MatrixRow {
  key: string; process: string; tdoLead: boolean; developer: boolean; ownerLr: boolean; ownerReviewer: boolean;
}
const matrixRows: MatrixRow[] = [
  { key: "p1", process: "Создание документа в МДР (PD и SE)", tdoLead: true, developer: false, ownerLr: false, ownerReviewer: false },
  { key: "p2", process: "Создание ревизии и загрузка PDF", tdoLead: true, developer: true, ownerLr: false, ownerReviewer: false },
  { key: "p3", process: "Отправка ревизии в ревью (очередь ТРМ)", tdoLead: true, developer: false, ownerLr: false, ownerReviewer: false },
  { key: "p4", process: "Создание замечаний к PDF", tdoLead: false, developer: false, ownerLr: true, ownerReviewer: true },
  { key: "p5", process: "Согласование/отклонение замечаний", tdoLead: false, developer: false, ownerLr: true, ownerReviewer: false },
  { key: "p6", process: "CRS: сбор и отправка подрядчику", tdoLead: false, developer: false, ownerLr: true, ownerReviewer: false },
  { key: "p7", process: "Ответ на замечания (A / I)", tdoLead: true, developer: true, ownerLr: false, ownerReviewer: false },
  { key: "p8", process: "Carry-over решения и код AP", tdoLead: false, developer: false, ownerLr: true, ownerReviewer: false },
  { key: "p9", process: "Отчётность", tdoLead: false, developer: false, ownerLr: true, ownerReviewer: true },
];
const yesNo = (v: boolean): JSX.Element => (v ? <Tag color="green">Да</Tag> : <Tag color="red">Нет</Tag>);
const matrixColumns: ColumnsType<MatrixRow> = [
  { title: "Процесс", dataIndex: "process", key: "process", width: 320 },
  { title: "Рук. ТДО подрядчика", dataIndex: "tdoLead", key: "tdoLead", render: yesNo },
  { title: "Разработчик", dataIndex: "developer", key: "developer", render: yesNo },
  { title: "LR заказчика", dataIndex: "ownerLr", key: "ownerLr", render: yesNo },
  { title: "R заказчика", dataIndex: "ownerReviewer", key: "ownerReviewer", render: yesNo },
];

// ----------------------------------------------------------------- треки ролей
function CommonTrack(): JSX.Element {
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card title="Вход в систему" size="small">
        <ProcMeta goal="Начать работу под своей учётной записью" who="Все пользователи" where="Стартовая страница" />
        <Steppo steps={[
          { title: "Откройте адрес системы", body: <>В браузере откройте адрес, выданный администратором. Появится форма входа.</>, shot: "01-login" },
          { title: "Введите e-mail и пароль", body: <>Заполните поля и нажмите <Kbd>Войти</Kbd> → откроется «Обзор» с вашими задачами.</>, tip: "Учётную запись создаёт администратор. Забыли пароль — обратитесь к нему." },
        ]} />
      </Card>
      <Card title="Обзор (дашборд)" size="small">
        <ProcMeta goal="Видеть свои задачи и статусы документов" who="Все пользователи" where="Меню: Обзор" />
        <Steppo steps={[
          { title: "Проверьте блок задач", body: <>На «Обзоре» — задачи, ждущие действия именно от вас, просроченные документы и прогресс. Клик по строке ведёт в карточку.</>, shot: "10-tdo-dashboard" },
        ]} />
      </Card>
    </Space>
  );
}

function TdoLeadTrack(): JSX.Element {
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card title="Создание документа в реестре (МДР) — ПД и изыскания (SE)" size="small">
        <ProcMeta goal="Завести документ с корректным шифром и плановым сроком" who="Рук. ТДО подрядчика" where="Проекты → вкладка «Реестр документов»" />
        <Steppo steps={[
          { title: "Откройте реестр документов проекта", body: <>Меню <Kbd>Проекты</Kbd> → выберите проект → вкладка <Kbd>Реестр документов</Kbd>.</>, shot: "12-tdo-mdr" },
          { title: "Нажмите «+ Добавить документ»", body: <>Откроется форма создания. Шифр собирается автоматически из полей ниже — поле «Шифр документа (авто)».</>, shot: "13-tdo-mdr-create" },
          { title: "Выберите категорию документа", body: <><Kbd>PD</Kbd> — проектная документация (раздел из справочника разделов ПД) или <Kbd>SE</Kbd> — инженерные изыскания (вид отчёта из справочника «SE отчеты»). Поле раздела переключается автоматически.</>, shot: "14-tdo-mdr-create-se", tip: "Принцип шифра одинаковый: ПРОЕКТ-РАЗРАБ-КАТЕГОРИЯ-ТИТУЛ-РАЗДЕЛ(.часть)(.книга)." },
          { title: "Заполните поля и создайте", body: <>Титул, раздел/вид отчёта, часть/книга при необходимости, плановая дата выпуска ревизии A, вес → <Kbd>Создать</Kbd>. Документ появится в реестре, разработчик увидит его в «Ревизии».</>, warn: "Шифр уникален — система не даст создать дубль." },
        ]} />
      </Card>
      <Card title="Очередь ТРМ — контроль выпуска" size="small">
        <ProcMeta goal="Проверить ревизию разработчика и отправить заказчику" who="Рук. ТДО подрядчика" where="Меню: Очередь ТРМ" />
        <Steppo steps={[
          { title: "Откройте очередь", body: <>Меню <Kbd>Очередь ТРМ</Kbd> — все ревизии со статусом «Загружен PDF — ждёт ТДО».</>, shot: "15-tdo-queue" },
          { title: "Проверьте и решите", body: <><Kbd>Одобрить</Kbd> → ревизия уходит заказчику («На рассмотрении»), ревьюеры получают уведомления по матрице назначений. <Kbd>Отклонить</Kbd> → возврат разработчику на доработку.</>, tip: "Для SE-документов уведомления получают назначенные на условный раздел «SE» в матрице." },
        ]} />
      </Card>
    </Space>
  );
}

function DeveloperTrack(): JSX.Element {
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card title="Выпуск ревизии: PDF и доп. файлы" size="small">
        <ProcMeta goal="Выпустить ревизию документа на рассмотрение" who="Разработчик подрядчика" where="Меню: Ревизии → Карточка ревизии" />
        <Steppo steps={[
          { title: "Найдите документ в «Ревизии»", body: <>Меню <Kbd>Ревизии</Kbd> → у нужной строки нажмите <Kbd>Карточка ревизии</Kbd>.</>, shot: "20-dev-revisions" },
          { title: "Загрузите PDF", body: <>В карточке — кнопка загрузки PDF. После загрузки статус: «Загружен PDF — ждёт ТДО», дальше решение руководителя ТДО.</>, shot: "21-dev-revision-card", warn: "Принимается только PDF. Цель выпуска: IFR — на рассмотрение (ревизии A, B…), AFD — финальная (ревизия 00)." },
          { title: "Следите за этапами", body: <>В карточке весь путь документа: этапы процесса, статусы, история ревизий, замечания и ответы.</>, shot: "22-dev-revision-card-scroll" },
        ]} />
      </Card>
      <Card title="Ответ на замечания заказчика" size="small">
        <ProcMeta goal="Отработать CRS: согласиться или обосновать несогласие" who="Разработчик / рук. ТДО" where="Карточка ревизии → блок замечаний" />
        <Steppo steps={[
          { title: "Откройте карточку после CRS", body: <>Статус «Замечания направлены» — в карточке замечания заказчика с кодами и привязкой к листам PDF.</> },
          { title: "Ответьте на каждое", body: <><Kbd>A</Kbd> — принято (устраните в следующей ревизии), <Kbd>I</Kbd> — несогласие, обязательно с текстом обоснования (уйдёт на решение LR).</>, tip: "Спор решает LR: снимет замечание или директивно назначит к исполнению." },
        ]} />
      </Card>
    </Space>
  );
}

function LrTrack(): JSX.Element {
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card title="Рассмотрение ревизии и замечания" size="small">
        <ProcMeta goal="Проверить документ и зафиксировать замечания" who="LR (лид-ревьюер) заказчика" where="Документы → Карточка ревизии" />
        <Steppo steps={[
          { title: "Откройте реестр документов", body: <>Меню <Kbd>Документы</Kbd>: документы сгруппированы по категориям — «PD — Проектная документация» и «SE — Инженерные изыскания». Разверните строку — увидите все ревизии документа.</>, shot: "30-lr-registry" },
          { title: "Работайте с PDF", body: <>В карточке ревизии <Kbd>Открыть PDF</Kbd> — просмотр с аннотациями: выделите область на листе и создайте замечание. Либо текстовое <Kbd>+ Вопрос/замечание</Kbd>.</>, shot: "32-lr-revision-card" },
          { title: "Согласуйте замечания специалистов (R)", body: <>Замечания R приходят на ваше решение: опубликовать заказчику, отклонить или вернуть на доработку.</>, tip: "Финальные решения — только у LR (по матрице назначений)." },
        ]} />
      </Card>
      <Card title="CRS: направить замечания подрядчику" size="small">
        <ProcMeta goal="Собрать проверенные замечания и отправить подрядчику" who="LR заказчика" where="Меню: CRS" />
        <Steppo steps={[
          { title: "Откройте CRS", body: <>Меню <Kbd>CRS</Kbd> — очередь замечаний, готовых к отправке.</>, shot: "31-lr-crs" },
          { title: "Сформируйте и отправьте", body: <>Добавьте замечания в CRS → <Kbd>Направить подрядчику</Kbd>. Статус ревизии станет «Замечания направлены», подрядчик получит уведомление.</> },
        ]} />
      </Card>
      <Card title="Carry-over и закрытие документа (AP)" size="small">
        <ProcMeta goal="Решить судьбу замечаний и закрыть цикл" who="LR заказчика" where="Карточка ревизии → блок carry-over" />
        <Steppo steps={[
          { title: "После ответа подрядчика", body: <>По каждому замечанию: <Kbd>Устранено ✓</Kbd> или <Kbd>Не устранено (вернуть)</Kbd> — невыполненные перейдут в следующую ревизию.</> },
          { title: "Финал", body: <>Когда всё устранено и выпущена ревизия 00 с целью AFD — поставьте <Kbd>AP</Kbd>. Документ закрыт: прогресс 100%, новые загрузки блокируются.</>, warn: "AP ставится только при AFD и закрытых замечаниях — система проверит условия и покажет, чего не хватает." },
        ]} />
      </Card>
    </Space>
  );
}

function RTrack(): JSX.Element {
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card title="Замечания специалиста (R)" size="small">
        <ProcMeta goal="Проверить документ по своей дисциплине и дать замечания" who="R (ревьюер) заказчика" where="Документы → Карточка ревизии" />
        <Steppo steps={[
          { title: "Найдите документы на рассмотрении", body: <>Меню <Kbd>Документы</Kbd> → фильтр по статусу «На рассмотрении». Видны документы разделов из матрицы назначений; для изысканий — раздел «SE».</>, shot: "40-r-registry" },
          { title: "Создайте замечания", body: <>В карточке ревизии: <Kbd>Открыть PDF</Kbd> → выделите область → замечание; либо текстовое <Kbd>+ Вопрос/замечание</Kbd>. Ваши замечания уходят на решение LR.</>, tip: "Ваши кнопки carry-over — рекомендации; финальное решение за LR." },
        ]} />
      </Card>
    </Space>
  );
}

function AdminTrack(): JSX.Element {
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card title="Матрица назначений (кто что ревьюит)" size="small">
        <ProcMeta goal="Назначить LR/R на разделы проекта" who="Администратор / право «Матрица ревью»" where="Проекты → вкладка матрицы назначений" />
        <Steppo steps={[
          { title: "Откройте матрицу проекта", body: <>Меню <Kbd>Проекты</Kbd> → вкладка матрицы. Строка = раздел + сотрудник + уровень + роль (LR/R).</>, shot: "50-admin-matrix" },
          { title: "Добавьте строку", body: <><Kbd>+ Добавить строку матрицы</Kbd> → раздел ПД или <Kbd>SE — Инженерные изыскания (все отчёты)</Kbd> → сотрудник заказчика → LR или R.</>, tip: "Назначение на «SE» покрывает все документы категории SE — по отдельным видам отчётов назначать не нужно." },
        ]} />
      </Card>
      <Card title="Пользователи и права" size="small">
        <ProcMeta goal="Завести пользователей и выдать права/модули" who="Администратор" where="Меню: Администрирование" />
        <Steppo steps={[
          { title: "Создайте пользователя и выдайте права", body: <>Меню <Kbd>Администрирование</Kbd> → добавьте пользователя (подрядчик/заказчик) → отметьте права: загрузка файлов, замечания, публикация CRS, очередь ТРМ, доступ к модулям Закупки/FEED.</>, shot: "51-admin-users", warn: "Чтобы попасть в матрицу назначений, пользователь должен быть участником проекта." },
        ]} />
      </Card>
    </Space>
  );
}

// ----------------------------------------------------------------- страница
interface Props {
  currentUser: User;
}

export default function HelpPage({ currentUser }: Props): JSX.Element {
  const defaultTab = currentUser.permissions.can_process_tdo_queue
    ? "tdo-lead"
    : currentUser.permissions.can_publish_comments
      ? "owner-lr"
      : currentUser.company_type === "owner"
        ? "owner-r"
        : currentUser.permissions.can_manage_users
          ? "admin"
          : "developer";

  return (
    <Space direction="vertical" style={{ width: "100%" }} size={16}>
      <Card title="Как устроен процесс ТДО" size="small">
        <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
          Полный цикл документа: от записи в реестре до кода AP. Зелёная дорожка — действия
          подрядчика, синяя — заказчика. Пунктир — возврат на новый цикл, если замечания не устранены.
        </Typography.Paragraph>
        <WorkflowGraph />
      </Card>

      <Card size="small" title="Инструкции по ролям — какую кнопку жать и что будет">
        <Tabs
          defaultActiveKey={defaultTab}
          items={[
            { key: "common", label: "Всем: вход и обзор", children: <CommonTrack /> },
            { key: "tdo-lead", label: "Рук. ТДО подрядчика", children: <TdoLeadTrack /> },
            { key: "developer", label: "Разработчик", children: <DeveloperTrack /> },
            { key: "owner-lr", label: "LR заказчика", children: <LrTrack /> },
            { key: "owner-r", label: "R заказчика", children: <RTrack /> },
            { key: "admin", label: "Администратор", children: <AdminTrack /> },
          ]}
        />
      </Card>

      <Card title="Матрица прав по процессам" size="small">
        <Table columns={matrixColumns} dataSource={matrixRows} pagination={false} size="small" scroll={{ x: 900 }} />
      </Card>
    </Space>
  );
}
