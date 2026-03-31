import { Button, Card, Modal, Space, Table, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useState } from "react";

import { listTdoQueue, processRevisionTdoDecision } from "../api";
import type { TdoQueueItem, User } from "../types";

interface Props {
  currentUser: User;
  onReload: () => Promise<void>;
  onOpenRevision: (target: { project_code: string; document_num: string; revision_id: number }) => void;
}

export default function TdoQueuePage({ currentUser, onReload, onOpenRevision }: Props): JSX.Element {
  const [items, setItems] = useState<TdoQueueItem[]>([]);
  const [selectedRowKeys, setSelectedRowKeys] = useState<Array<string | number>>([]);
  const [cancelOpen, setCancelOpen] = useState(false);

  const load = async () => {
    try {
      const data = await listTdoQueue();
      setItems(data);
    } catch (error) {
      const text = error instanceof Error ? error.message : "Не удалось загрузить очередь ТРМ";
      message.error(text);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const selectedIds = selectedRowKeys.map((key) => Number(key)).filter((value) => Number.isFinite(value));

  const columns: ColumnsType<TdoQueueItem> = [
    { title: "Проект", dataIndex: "project_code", key: "project_code", width: 90 },
    { title: "Документ", dataIndex: "document_num", key: "document_num" },
    { title: "Название", dataIndex: "document_title", key: "document_title" },
    { title: "Рев", dataIndex: "revision_code", key: "revision_code", width: 70 },
    { title: "Цель", dataIndex: "issue_purpose", key: "issue_purpose", width: 80 },
    { title: "Статус", dataIndex: "status", key: "status", width: 220 },
    { title: "Срок", dataIndex: "review_deadline", key: "review_deadline", width: 130 },
    {
      title: "Ссылка",
      key: "link",
      render: (_, row) => (
        <Button
          size="small"
          type="link"
          onClick={() =>
            onOpenRevision({
              project_code: row.project_code,
              document_num: row.document_num,
              revision_id: row.revision_id,
            })
          }
        >
          Открыть ревизию
        </Button>
      ),
    },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 12, width: "100%", justifyContent: "space-between" }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Очередь ТРМ подрядчика
        </Typography.Title>
        <Space>
          <Button onClick={() => void load()}>Обновить</Button>
          <Button
            type="primary"
            disabled={selectedIds.length === 0 || !currentUser.permissions.can_process_tdo_queue}
            onClick={async () => {
              for (const revisionId of selectedIds) {
                await processRevisionTdoDecision(revisionId, { action: "SEND_TO_OWNER" });
              }
              message.success(`Отправлено заказчику: ${selectedIds.length}`);
              setSelectedRowKeys([]);
              await load();
              await onReload();
            }}
          >
            Сформировать TRM и отправить
          </Button>
          <Button
            danger
            disabled={selectedIds.length === 0 || !currentUser.permissions.can_process_tdo_queue}
            onClick={() => setCancelOpen(true)}
          >
            Отклонить выбранные
          </Button>
        </Space>
      </Space>

      <Card>
        <Table
          rowKey="revision_id"
          columns={columns}
          dataSource={items}
          rowSelection={{
            selectedRowKeys,
            onChange: (keys) => setSelectedRowKeys(keys),
          }}
          pagination={{ pageSize: 10 }}
          scroll={{ x: "max-content" }}
        />
      </Card>

      <Modal
        open={cancelOpen}
        title="Отклонить выбранные ревизии"
        onCancel={() => setCancelOpen(false)}
        onOk={async () => {
          for (const revisionId of selectedIds) {
            await processRevisionTdoDecision(revisionId, {
              action: "CANCELLED",
              note: "Отклонено руководителем ТДО, требуется доработка",
            });
          }
          message.success(`Отклонено: ${selectedIds.length}`);
          setCancelOpen(false);
          setSelectedRowKeys([]);
          await load();
          await onReload();
        }}
      >
        <Typography.Text>
          Выбранные ревизии будут отклонены, разработчику уйдет уведомление о доработке.
        </Typography.Text>
      </Modal>
    </div>
  );
}
