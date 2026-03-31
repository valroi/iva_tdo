import { Alert, Button, Card, Space, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";

interface MatrixRow {
  key: string;
  process: string;
  admin: boolean;
  user: boolean;
}

const matrixRows: MatrixRow[] = [
  {
    key: "p1",
    process: "Создание карточки проекта",
    admin: true,
    user: false,
  },
  {
    key: "p2",
    process: "Удаление карточки проекта (если нет MDR)",
    admin: true,
    user: false,
  },
  {
    key: "p3",
    process: "Создание/редактирование пользователей",
    admin: true,
    user: false,
  },
  {
    key: "p4",
    process: "Редактирование справочников проекта",
    admin: true,
    user: false,
  },
  {
    key: "p5",
    process: "Создание MDR/документов/ревизий",
    admin: true,
    user: true,
  },
  {
    key: "p6",
    process: "Загрузка PDF в ревизию",
    admin: true,
    user: true,
  },
  {
    key: "p7",
    process: "Создание комментария",
    admin: true,
    user: true,
  },
  {
    key: "p8",
    process: "Ответ на комментарий",
    admin: true,
    user: true,
  },
  {
    key: "p9",
    process: "Просмотр уведомлений и истории",
    admin: true,
    user: true,
  },
];

const yesNo = (value: boolean): JSX.Element =>
  value ? <Tag color="green">Да</Tag> : <Tag color="red">Нет</Tag>;

const columns: ColumnsType<MatrixRow> = [
  { title: "Процесс", dataIndex: "process", key: "process", width: 320, fixed: "left" },
  { title: "Админ", dataIndex: "admin", key: "admin", render: yesNo },
  { title: "Пользователь", dataIndex: "user", key: "user", render: yesNo },
];

export default function HelpPage(): JSX.Element {
  return (
    <Space direction="vertical" style={{ width: "100%" }} size={16}>
      <Card title="Инструкция для пользователей (как работать в системе)">
        <ol style={{ marginBottom: 0 }}>
          <li>Главный админ создает карточку проекта в разделе «Проекты».</li>
          <li>Админ назначает роли (`admin`/`user`) и активирует учетные записи.</li>
          <li>Админ настраивает справочники проекта (дисциплины, типы и классы документов).</li>
          <li>Пользователь формирует MDR и создает документы/ревизии.</li>
          <li>Пользователь загружает PDF в ревизию кнопкой «PDF».</li>
          <li>Пользователи обмениваются комментариями по ревизиям до AP/AN.</li>
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

      <Card title="Матрица разделения процессов (admin/user)">
        <Table
          columns={columns}
          dataSource={matrixRows}
          pagination={false}
          rowKey="key"
          scroll={{ x: 900 }}
        />
      </Card>

      <Alert
        type="info"
        showIcon
        message="Как сейчас работает загрузка документов"
        description="На вкладке «Документы» у каждой ревизии есть кнопка «PDF». Файл загружается и прикрепляется к выбранной ревизии. На следующем этапе будет добавлен полноценный просмотр PDF с аннотациями по областям."
      />
    </Space>
  );
}
