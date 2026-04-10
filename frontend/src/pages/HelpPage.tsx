import { Alert, Button, Card, Space, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { User } from "../types";

interface MatrixRow {
  key: string;
  process: string;
  tdoLead: boolean;
  developer: boolean;
  ownerLr: boolean;
  ownerReviewer: boolean;
}

const matrixRows: MatrixRow[] = [
  { key: "p1", process: "Создание MDR / документа", tdoLead: true, developer: false, ownerLr: false, ownerReviewer: false },
  { key: "p2", process: "Создание ревизии и загрузка PDF", tdoLead: true, developer: true, ownerLr: false, ownerReviewer: false },
  { key: "p3", process: "Отправка ревизии в TRM заказчику", tdoLead: true, developer: false, ownerLr: false, ownerReviewer: false },
  { key: "p4", process: "Создание замечаний", tdoLead: false, developer: false, ownerLr: true, ownerReviewer: true },
  { key: "p5", process: "Согласование/отклонение замечаний LR", tdoLead: false, developer: false, ownerLr: true, ownerReviewer: false },
  { key: "p6", process: "Добавление замечаний в CRS + отправка", tdoLead: false, developer: false, ownerLr: true, ownerReviewer: false },
  { key: "p7", process: "Ответ подрядчика I/A с текстом", tdoLead: true, developer: true, ownerLr: false, ownerReviewer: false },
  { key: "p8", process: "Просмотр отчетности", tdoLead: false, developer: false, ownerLr: true, ownerReviewer: true },
  { key: "p9", process: "Очередь ТРМ / контроль просрочки старта", tdoLead: true, developer: false, ownerLr: false, ownerReviewer: false },
];

const yesNo = (value: boolean): JSX.Element =>
  value ? <Tag color="green">Да</Tag> : <Tag color="red">Нет</Tag>;

const columns: ColumnsType<MatrixRow> = [
  { title: "Процесс", dataIndex: "process", key: "process", width: 320, fixed: "left" },
  { title: "ТДО подрядчика", dataIndex: "tdoLead", key: "tdoLead", render: yesNo },
  { title: "Разработчик", dataIndex: "developer", key: "developer", render: yesNo },
  { title: "LR заказчика", dataIndex: "ownerLr", key: "ownerLr", render: yesNo },
  { title: "R заказчика", dataIndex: "ownerReviewer", key: "ownerReviewer", render: yesNo },
];

interface Props {
  currentUser: User;
}

export default function HelpPage({ currentUser }: Props): JSX.Element {
  const roleAnchor = currentUser.permissions.can_process_tdo_queue
    ? "tdo-lead"
    : currentUser.permissions.can_publish_comments
      ? "owner-lr"
      : currentUser.company_type === "owner"
        ? "owner-r"
        : "developer";
  return (
    <Space direction="vertical" style={{ width: "100%" }} size={16}>
      <Card title="Быстрый старт по роли">
        <Space wrap>
          <Button href="#tdo-lead">Роль: ТДО подрядчика</Button>
          <Button href="#developer">Роль: Разработчик</Button>
          <Button href="#owner-lr">Роль: LR заказчика</Button>
          <Button href="#owner-r">Роль: R заказчика</Button>
          <Button type="primary" href={`#${roleAnchor}`}>
            Открыть мой раздел
          </Button>
        </Space>
      </Card>

      <Card title="Публичная страница инструкции">
        <Typography.Paragraph>
          Эту инструкцию можно открыть без авторизации и передать пользователям проекта:
        </Typography.Paragraph>
        <Button href="/instruction.html" target="_blank">
          Открыть публичную инструкцию
        </Button>
      </Card>

      <Card title="Матрица прав по ролям">
        <Table
          columns={columns}
          dataSource={matrixRows}
          pagination={false}
          rowKey="key"
          scroll={{ x: 900 }}
        />
      </Card>

      <Card id="tdo-lead" title="Роль: ТДО подрядчика — последовательный процесс">
        <ol style={{ marginBottom: 0 }}>
          <li>На вкладке <code>Проекты -&gt; MDR</code> создать документ (минимум: шифр, дисциплина, вес, план старта).</li>
          <li>На вкладке <code>Документы</code> создать ревизию и загрузить PDF через кнопку <code>PDF</code>.</li>
          <li>В <code>Очередь ТРМ</code> отправить ревизию заказчику (<code>В TRM</code>).</li>
          <li>После получения CRS открыть ревизию, пройти замечания в PDF и ответить по каждому: <code>I</code> или <code>A</code> + текст.</li>
          <li>Если статус ревизии <code>CONTRACTOR_REPLY_I</code>, новую ревизию не создавать до закрытия обсуждений.</li>
          <li>Контролировать карточку <code>Просроченные документы</code> в <code>Обзор</code> и оперативно устранять задержки старта.</li>
        </ol>
      </Card>

      <Card id="developer" title="Роль: Разработчик подрядчика — последовательный процесс">
        <ol style={{ marginBottom: 0 }}>
          <li>Открыть уведомление по документу и перейти в карточку ревизии.</li>
          <li>Если есть подсказка <code>Требуется перезагрузка PDF</code>, загрузить новый PDF в ту же ревизию.</li>
          <li>В анноторе PDF выбрать замечание и дать ответ <code>I/A</code>; для <code>I</code> обязательно заполнить текст.</li>
          <li>Проверить в таблице колонку <code>Статус подрядчика</code> и <code>Ответ подрядчика</code>.</li>
        </ol>
      </Card>

      <Card id="owner-r" title="Роль: R заказчика — последовательный процесс">
        <ol style={{ marginBottom: 0 }}>
          <li>Открыть TRM и перейти в карточку ревизии.</li>
          <li>Добавить замечания в PDF с кодами <code>RJ/CO/AN</code>.</li>
          <li>Проверить, что замечания появились в таблице комментариев с автором и листом PDF.</li>
          <li>Получать уведомления о статусе <code>I/A</code> от подрядчика и при необходимости уточнять замечания.</li>
        </ol>
      </Card>

      <Card id="owner-lr" title="Роль: LR заказчика — последовательный процесс">
        <ol style={{ marginBottom: 0 }}>
          <li>Проверить замечания R, отклонить лишние или добавить в CRS.</li>
          <li>Отправить CRS подрядчику (массово или по документу).</li>
          <li>Убедиться, что активные уведомления по документу ушли в архив после отправки CRS.</li>
          <li>После ответов подрядчика проверить <code>Статус подрядчика</code>, <code>Ответ подрядчика</code>, <code>Дата ответа</code>.</li>
          <li>Довести цикл до <code>AP</code>, затем контролировать финализацию и 100% прогресс в <code>Отчетность</code>.</li>
        </ol>
      </Card>

      <Card title="Чек-лист E2E (что проверено)">
        <ul style={{ marginBottom: 0 }}>
          <li>Создание MDR и документа, создание ревизии, загрузка PDF.</li>
          <li>Передача в TRM и видимость ревизии у owner-ролей.</li>
          <li>Создание замечаний, отправка в CRS, получение подрядчиком.</li>
          <li>Ответ подрядчика <code>I/A</code> с текстом и отображение в таблицах.</li>
          <li>Уведомления <code>COMMENT_RESPONSE</code> автору замечания и LR с контекстом документа.</li>
          <li>Карточка прогресса: план/прогноз/факт + цикл 85% до AP.</li>
        </ul>
      </Card>

      <Alert
        type="info"
        showIcon
        message="UX-подсказки и минимум кликов"
        description="Основной переход должен идти из уведомления прямо в карточку ревизии. Кнопки PDF, Открыть в PDF, В TRM, Добавить в CRS оставлены в таблицах рядом с объектом действия, чтобы не переключаться между вкладками."
      />
    </Space>
  );
}
