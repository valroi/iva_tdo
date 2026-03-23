import { Alert, Button, Card, Space, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";

interface MatrixRow {
  key: string;
  process: string;
  main_admin: boolean;
  admin: boolean;
}

const matrixRows: MatrixRow[] = [
  { key: "1", process: "Создание пользователей", main_admin: true, admin: true },
  { key: "2", process: "Выдача роли admin", main_admin: true, admin: false },
  { key: "3", process: "Деактивация/удаление пользователей", main_admin: true, admin: false },
  { key: "4", process: "Одобрение заявок регистрации", main_admin: true, admin: false },
  { key: "5", process: "Quick demo setup", main_admin: true, admin: false },
];

const columns: ColumnsType<MatrixRow> = [
  { title: "Процесс", dataIndex: "process", key: "process" },
  {
    title: "Главный админ",
    dataIndex: "main_admin",
    key: "main_admin",
    render: (value: boolean) => (value ? <Tag color="green">Да</Tag> : <Tag color="red">Нет</Tag>),
  },
  {
    title: "Обычный админ",
    dataIndex: "admin",
    key: "admin",
    render: (value: boolean) => (value ? <Tag color="green">Да</Tag> : <Tag color="red">Нет</Tag>),
  },
];

export default function HelpPage(): JSX.Element {
  return (
    <Space direction="vertical" style={{ width: "100%" }} size={16}>
      <Card title="Инструкция: быстрый запуск проверки">
        <ol style={{ marginBottom: 0 }}>
          <li>Войдите как главный админ.</li>
          <li>Откройте раздел "Admin users".</li>
          <li>Нажмите "Быстрый мастер".</li>
          <li>Заполните email подрядчика, заказчика и пароль.</li>
          <li>Нажмите "Создать демо-процесс".</li>
          <li>Откройте сайт в двух окнах (обычное + инкогнито) и войдите под созданными ролями.</li>
          <li>Проверьте цепочку: MDR → Document → Revision → Comment → Response.</li>
        </ol>
      </Card>

      <Card title="Открытая инструкция">
        <Typography.Paragraph>
          Публичная страница инструкции доступна по ссылке ниже (без логина):
        </Typography.Paragraph>
        <Button href="/instruction.html" target="_blank">
          Открыть публичную инструкцию
        </Button>
      </Card>

      <Card title="Матрица разделения процессов">
        <Table columns={columns} dataSource={matrixRows} pagination={false} rowKey="key" />
      </Card>

      <Card title="Прогресс внедрения">
        <ul style={{ marginBottom: 0 }}>
          <li>✅ Реестр MDR, документы, ревизии, комментарии</li>
          <li>✅ Админ-панель управления пользователями через фронт</li>
          <li>✅ Главный админ / обычный админ с ограничениями</li>
          <li>✅ Саморегистрация и апрув</li>
          <li>✅ Быстрый мастер тестового процесса</li>
          <li>✅ Загрузка PDF в ревизию (MVP, без viewer-аннотаций)</li>
          <li>🔄 Следующий шаг: полноценный PDF viewer с выделением областей</li>
        </ul>
      </Card>

      <Alert
        type="info"
        showIcon
        message="Как сейчас работает загрузка документов"
        description="В разделе Документы у ревизии есть кнопка PDF. Вы загружаете файл PDF, backend сохраняет его и прикрепляет путь к выбранной ревизии. На следующем этапе добавим полноценный просмотр и аннотации прямо в PDF."
      />
    </Space>
  );
}
