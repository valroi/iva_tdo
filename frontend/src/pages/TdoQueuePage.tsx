import { Button, Card, Modal, Space, Table, Tooltip, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useState } from "react";

import { downloadRevisionAttachmentsArchive, listTdoQueue, processRevisionsTdoDecisionBulk } from "../api";
import ProcessHint from "../components/ProcessHint";
import type { TdoQueueItem, User } from "../types";
import { formatDateTimeRu } from "../utils/datetime";
import { getDisplayRevisionCode } from "../utils/revisionProcess";

interface Props {
  currentUser: User;
  onReload: () => Promise<void>;
  onOpenRevision: (target: { project_code: string; document_num: string; revision_id: number }) => void;
}

export default function TdoQueuePage({ currentUser, onReload, onOpenRevision }: Props): JSX.Element {
  const [items, setItems] = useState<TdoQueueItem[]>([]);
  const [selectedRowKeys, setSelectedRowKeys] = useState<Array<string | number>>([]);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [sendingBusy, setSendingBusy] = useState(false);
  const [cancellingBusy, setCancellingBusy] = useState(false);

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
    { title: "Рев", key: "revision_code", width: 70, render: (_, row) => getDisplayRevisionCode(row) },
    { title: "Цель", dataIndex: "issue_purpose", key: "issue_purpose", width: 80 },
    { title: "Статус", dataIndex: "status", key: "status", width: 220 },
    { title: "Срок", dataIndex: "review_deadline", key: "review_deadline", width: 130, render: (v: string | null) => formatDateTimeRu(v) },
    {
      title: "Ссылка",
      key: "link",
      render: (_, row) => (
        <Space>
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
          <Button
            size="small"
            type="link"
            onClick={async () => {
              try {
                await downloadRevisionAttachmentsArchive(row.revision_id, row.document_num);
              } catch (error: unknown) {
                const text = error instanceof Error ? error.message : "Нет дополнительных файлов";
                message.error(text);
              }
            }}
          >
            Файлы
          </Button>
        </Space>
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
          <Tooltip title="Обновить очередь ревизий">
            <Button onClick={() => void load()}>Обновить</Button>
          </Tooltip>
          <Tooltip title="Передать выбранные ревизии заказчику (создается TRM)">
            <Button
              type="primary"
              loading={sendingBusy}
              disabled={selectedIds.length === 0 || !currentUser.permissions.can_process_tdo_queue}
              onClick={async () => {
                setSendingBusy(true);
                try {
                  await processRevisionsTdoDecisionBulk({
                    revision_ids: selectedIds,
                    action: "SEND_TO_OWNER",
                  });
                  message.success(`Отправлено заказчику: ${selectedIds.length}`);
                } catch (error: unknown) {
                  const text = error instanceof Error ? error.message : "Ошибка отправки TRM";
                  message.error(text);
                  return;
                } finally {
                  setSendingBusy(false);
                }
                setSelectedRowKeys([]);
                await load();
                await onReload();
              }}
            >
              Сформировать TRM и отправить
            </Button>
          </Tooltip>
          <Tooltip title="Вернуть выбранные ревизии подрядчику на доработку">
            <Button
              danger
              disabled={selectedIds.length === 0 || !currentUser.permissions.can_process_tdo_queue}
              onClick={() => setCancelOpen(true)}
            >
              Отклонить выбранные
            </Button>
          </Tooltip>
        </Space>
      </Space>
      <ProcessHint
        style={{ marginBottom: 12 }}
        title="Как работать с очередью ТРМ"
        steps={[
          "Отметьте ревизии, которые готовы к передаче заказчику.",
          "Нажмите «Сформировать TRM и отправить» для выбранных строк.",
          "Если нужна доработка, выберите ревизии и нажмите «Отклонить выбранные».",
        ]}
      />

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
          locale={{ emptyText: "Очередь пуста. Новые ревизии появятся после загрузки подрядчиком." }}
        />
      </Card>

      <Modal
        open={cancelOpen}
        title="Отклонить выбранные ревизии"
        confirmLoading={cancellingBusy}
        onCancel={() => setCancelOpen(false)}
        onOk={async () => {
          setCancellingBusy(true);
          try {
            await processRevisionsTdoDecisionBulk({
              revision_ids: selectedIds,
              action: "CANCELLED",
              note: "Отклонено руководителем ТДО, требуется доработка",
            });
            message.success(`Отклонено: ${selectedIds.length}`);
          } catch (error: unknown) {
            const text = error instanceof Error ? error.message : "Ошибка отклонения ревизий";
            message.error(text);
            return;
          } finally {
            setCancellingBusy(false);
          }
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
