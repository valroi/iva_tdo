import { Button, Card, Space, Table, Tabs, Tooltip, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useState } from "react";

import { listCrsQueue, sendCrsComments } from "../api";
import ProcessHint from "../components/ProcessHint";
import type { CsrQueueItem } from "../types";
import { formatDateTimeRu } from "../utils/datetime";
import { getDisplayRevisionCode } from "../utils/revisionProcess";

export default function CrsPage(): JSX.Element {
  const [items, setItems] = useState<CsrQueueItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [sending, setSending] = useState(false);

  const load = async () => {
    try {
      setItems(await listCrsQueue());
    } catch (error: unknown) {
      const text = error instanceof Error ? error.message : "Не удалось загрузить CRS";
      message.error(text);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const columns: ColumnsType<CsrQueueItem> = [
    { title: "TRM", dataIndex: "trm_number", width: 220, render: (v: string | null) => v ?? "—" },
    { title: "CRS", dataIndex: "crs_number", width: 220, render: (v: string | null | undefined) => v ?? "—" },
    { title: "Документ", dataIndex: "document_num", width: 220 },
    { title: "Ревизия", width: 90, render: (_, row) => getDisplayRevisionCode(row) },
    { title: "Замечание", dataIndex: "comment_text", ellipsis: true },
    { title: "Статус замечания", dataIndex: "comment_status", width: 160 },
    { title: "Отправлено подрядчику", dataIndex: "crs_sent_at", width: 190, render: (v: string | null) => formatDateTimeRu(v) },
  ];

  const unsentRows = items.filter((item) => !item.crs_sent_at && item.comment_status !== "REJECTED");
  const archiveRows = items.filter((item) => item.crs_sent_at || item.comment_status === "REJECTED");

  return (
    <div>
      <Space style={{ marginBottom: 12, width: "100%", justifyContent: "space-between" }}>
        <Typography.Title level={4} style={{ margin: 0 }}>CRS - накопление замечаний</Typography.Title>
        <Space>
          <Tooltip title="Отправить выбранные замечания подрядчику через CRS">
            <Button
              type="primary"
              loading={sending}
              disabled={!selectedIds.length}
              onClick={async () => {
                setSending(true);
                try {
                  const result = await sendCrsComments(selectedIds);
                  message.success(`Отправлено подрядчику: ${result.published_count}`);
                  setSelectedIds([]);
                  await load();
                } catch (error: unknown) {
                  const text = error instanceof Error ? error.message : "Ошибка отправки CRS";
                  message.error(text);
                } finally {
                  setSending(false);
                }
              }}
            >
              Отправить выбранные подрядчику
            </Button>
          </Tooltip>
          <Tooltip title="Обновить очередь CRS">
            <Button onClick={() => void load()}>Обновить</Button>
          </Tooltip>
        </Space>
      </Space>
      <ProcessHint
        style={{ marginBottom: 12 }}
        title="Как работать с CRS"
        steps={[
          "Во вкладке «К отправке» выберите замечания, которые нужно отправить подрядчику.",
          "Нажмите «Отправить выбранные подрядчику», чтобы зафиксировать передачу.",
          "Отправленные и отклоненные замечания переходят в архив.",
        ]}
      />
      <Card>
        <Tabs
          items={[
            {
              key: "pending",
              label: `К отправке (${unsentRows.length})`,
              children: (
                <>
                  <Table
                    rowKey="comment_id"
                    columns={columns}
                    dataSource={unsentRows}
                    rowSelection={{
                      selectedRowKeys: selectedIds,
                      onChange: (keys) => setSelectedIds(keys.map((key) => Number(key))),
                      getCheckboxProps: (record) => ({ disabled: Boolean(record.crs_sent_at) || record.comment_status === "REJECTED" }),
                    }}
                    pagination={{ pageSize: 20 }}
                    scroll={{ x: 1300 }}
                    locale={{ emptyText: "Нет замечаний, готовых к отправке в CRS." }}
                  />
                  {unsentRows.length === 0 && (
                    <Typography.Text type="secondary">В CRS нет неотправленных замечаний.</Typography.Text>
                  )}
                </>
              ),
            },
            {
              key: "archive",
              label: `Архив (${archiveRows.length})`,
              children: (
                <Table
                  rowKey="comment_id"
                  columns={columns}
                  dataSource={archiveRows}
                  pagination={{ pageSize: 20 }}
                  scroll={{ x: 1300 }}
                  locale={{ emptyText: "Архив CRS пока пуст." }}
                />
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
}
