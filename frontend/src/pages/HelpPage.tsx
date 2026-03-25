import { Alert, Button, Card, Space, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";

interface MatrixRow {
  key: string;
  process: string;
  main_admin: boolean;
  admin: boolean;
  participant: boolean;
  contractor_author: boolean;
  owner_manager: boolean;
  owner_reviewer: boolean;
  viewer: boolean;
}

const matrixRows: MatrixRow[] = [
  {
    key: "p1",
    process: "Создание карточки проекта",
    main_admin: true,
    admin: false,
    participant: false,
    contractor_author: false,
    owner_manager: false,
    owner_reviewer: false,
    viewer: false,
  },
  {
    key: "p2",
    process: "Удаление карточки проекта (если нет MDR)",
    main_admin: true,
    admin: false,
    participant: false,
    contractor_author: false,
    owner_manager: false,
    owner_reviewer: false,
    viewer: false,
  },
  {
    key: "p3",
    process: "Назначение участников проекта",
    main_admin: true,
    admin: false,
    participant: false,
    contractor_author: false,
    owner_manager: false,
    owner_reviewer: false,
    viewer: false,
  },
  {
    key: "p4",
    process: "Добавление участников в проект",
    main_admin: true,
    admin: false,
    participant: true,
    contractor_author: false,
    owner_manager: false,
    owner_reviewer: false,
    viewer: false,
  },
  {
    key: "p5",
    process: "Удаление участников из проекта",
    main_admin: true,
    admin: false,
    participant: true,
    contractor_author: false,
    owner_manager: false,
    owner_reviewer: false,
    viewer: false,
  },
  {
    key: "p6",
    process: "Редактирование справочников проекта",
    main_admin: true,
    admin: false,
    participant: false,
    contractor_author: false,
    owner_manager: false,
    owner_reviewer: false,
    viewer: false,
  },
  {
    key: "p7",
    process: "Создание MDR",
    main_admin: true,
    admin: true,
    participant: true,
    contractor_author: true,
    owner_manager: false,
    owner_reviewer: false,
    viewer: false,
  },
  {
    key: "p8",
    process: "Загрузка PDF в ревизию",
    main_admin: true,
    admin: true,
    participant: true,
    contractor_author: true,
    owner_manager: false,
    owner_reviewer: false,
    viewer: false,
  },
  {
    key: "p9",
    process: "Создание комментария",
    main_admin: true,
    admin: true,
    participant: true,
    contractor_author: true,
    owner_manager: true,
    owner_reviewer: true,
    viewer: false,
  },
  {
    key: "p10",
    process: "Ответ на комментарий",
    main_admin: true,
    admin: true,
    participant: true,
    contractor_author: true,
    owner_manager: false,
    owner_reviewer: false,
    viewer: false,
  },
];

const yesNo = (value: boolean): JSX.Element =>
  value ? <Tag color="green">Да</Tag> : <Tag color="red">Нет</Tag>;

const columns: ColumnsType<MatrixRow> = [
  { title: "Процесс", dataIndex: "process", key: "process", width: 320, fixed: "left" },
  { title: "Главный админ", dataIndex: "main_admin", key: "main_admin", render: yesNo },
  { title: "Админ", dataIndex: "admin", key: "admin", render: yesNo },
  {
    title: "Участник проекта",
    dataIndex: "participant",
    key: "participant",
    render: yesNo,
  },
  { title: "Автор подрядчика", dataIndex: "contractor_author", key: "contractor_author", render: yesNo },
  { title: "Менеджер заказчика / Owner manager", dataIndex: "owner_manager", key: "owner_manager", render: yesNo },
  { title: "Ревьюер заказчика / Owner reviewer", dataIndex: "owner_reviewer", key: "owner_reviewer", render: yesNo },
  { title: "Наблюдатель / Viewer", dataIndex: "viewer", key: "viewer", render: yesNo },
];

export default function HelpPage(): JSX.Element {
  return (
    <Space direction="vertical" style={{ width: "100%" }} size={16}>
      <Card title="Инструкция для пользователей (как работать в системе)">
        <ol style={{ marginBottom: 0 }}>
          <li>Администратор создает карточку проекта в разделе «Проекты».</li>
          <li>Администратор добавляет участников проекта.</li>
          <li>Пользователь с выданным правом может добавлять/удалять участников проекта.</li>
          <li>Администратор настраивает справочники проекта (дисциплины, типы и классы документов).</li>
          <li>Команда подрядчика формирует MDR и создает документы/ревизии.</li>
          <li>Подрядчик загружает PDF в ревизию кнопкой «PDF».</li>
          <li>Заказчик проверяет и оставляет комментарии.</li>
          <li>Подрядчик отвечает на замечания, процесс согласования продолжается до AP/AN.</li>
        </ol>
      </Card>

      <Card title="План работ и текущий этап / Roadmap & Current Phase">
        <ol style={{ marginBottom: 0 }}>
          <li>
            <strong>Этап 1 (выполнено):</strong> Базовый контур проекта: авторизация, проекты, MDR, документы, ревизии,
            комментарии, уведомления.
          </li>
          <li>
            <strong>Этап 2 (выполнено):</strong> Гранулярные права, автогенерация шифров MDR, ограничения по весам,
            CRUD MDR.
          </li>
          <li>
            <strong>Этап 3 (выполнено):</strong> Иерархический экран в стиле HRP:
            Проект → Категория → MDR → Документ → Ревизия, массовое создание и Excel-импорт.
          </li>
          <li>
            <strong>Этап 4 (выполнено):</strong> Ролевая навигация (только доступные разделы), проектные категории
            документации, группировка справочников по типам.
          </li>
          <li>
            <strong>Этап 5 (следующий):</strong> Расширенный PDF viewer и матрица маршрутизации ревьюеров по
            дисциплине/типу документа с автоназначением.
          </li>
        </ol>
      </Card>

      <Card title="Публичная страница инструкции">
        <Typography.Paragraph>
          Эту инструкцию можно открыть без авторизации и передать пользователям проекта:
        </Typography.Paragraph>
        <Button href="/instruction.html" target="_blank">
          Открыть публичную инструкцию
        </Button>
      </Card>

      <Card title="Матрица разделения процессов (все роли)">
        <Table
          columns={columns}
          dataSource={matrixRows}
          pagination={false}
          rowKey="key"
          scroll={{ x: 1400 }}
        />
      </Card>

      <Alert
        type="info"
        showIcon
        message="Как сейчас работает загрузка документов"
        description="На вкладке «Документы» у каждой ревизии есть кнопка «PDF». Файл загружается и прикрепляется к выбранной ревизии. Далее документ проверяется в Review Center."
      />
    </Space>
  );
}
