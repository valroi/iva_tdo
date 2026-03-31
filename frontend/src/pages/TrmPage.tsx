import { Button, Card, Space, Table, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useState } from "react";

import { listOwnerReviewQueue, listRevisionsOverview, publishAllCommentsForRevision } from "../api";
import type { RevisionOverviewItem, TdoQueueItem, User } from "../types";

interface Props {
  currentUser: User;
  onOpenRevision: (target: { project_code: string; document_num: string; revision_id: number }) => void;
}

interface TrmRow {
  trm_number: string;
  project_code: string;
  revisions_count: number;
  latest_status: string;
  latest_deadline: string | null;
  revisions: RevisionOverviewItem[];
}

export default function TrmPage({ currentUser, onOpenRevision }: Props): JSX.Element {
  const [items, setItems] = useState<RevisionOverviewItem[]>([]);
  const [ownerItems, setOwnerItems] = useState<TdoQueueItem[]>([]);
  const [selectedOwnerRevisionIds, setSelectedOwnerRevisionIds] = useState<number[]>([]);

  const load = async () => {
    try {
      if (currentUser.company_type === "owner") {
        setOwnerItems(await listOwnerReviewQueue());
        setItems([]);
      } else {
        setItems(await listRevisionsOverview());
        setOwnerItems([]);
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : "Не удалось загрузить TRM";
      message.error(text);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const rows = useMemo(() => {
    const grouped = new Map<string, RevisionOverviewItem[]>();
    for (const item of items) {
      if (!item.trm_number) continue;
      const bucket = grouped.get(item.trm_number) ?? [];
      bucket.push(item);
      grouped.set(item.trm_number, bucket);
    }
    const result: TrmRow[] = [];
    for (const [trm, revisions] of grouped.entries()) {
      const sorted = [...revisions].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      result.push({
        trm_number: trm,
        project_code: sorted[0].project_code,
        revisions_count: revisions.length,
        latest_status: sorted[0].status,
        latest_deadline: sorted[0].review_deadline,
        revisions: sorted,
      });
    }
    return result.sort((a, b) => (a.trm_number < b.trm_number ? 1 : -1));
  }, [items]);

  const columns: ColumnsType<TrmRow> = [
    { title: "TRM", dataIndex: "trm_number", key: "trm_number", width: 260 },
    { title: "Проект", dataIndex: "project_code", key: "project_code", width: 90 },
    { title: "Кол-во ревизий", dataIndex: "revisions_count", key: "revisions_count", width: 140 },
    { title: "Статус", dataIndex: "latest_status", key: "latest_status", width: 220 },
    { title: "Срок", dataIndex: "latest_deadline", key: "latest_deadline", width: 130, render: (v: string | null) => v ?? "—" },
  ];

  const ownerColumns: ColumnsType<TdoQueueItem> = [
    { title: "Проект", dataIndex: "project_code", key: "project_code", width: 90 },
    { title: "Документ", dataIndex: "document_num", key: "document_num", width: 240 },
    { title: "Рев", dataIndex: "revision_code", key: "revision_code", width: 80 },
    {
      title: "Автор ревизии",
      key: "author",
      width: 260,
      render: (_, row) => (row.author_email ? `${row.author_name ?? "—"} (${row.author_email})` : "—"),
    },
    { title: "Статус", dataIndex: "status", key: "status", width: 220 },
    {
      title: "Действие",
      key: "link",
      render: (_, row) => (
        <Button
          type="link"
          onClick={() =>
            onOpenRevision({
              project_code: row.project_code,
              document_num: row.document_num,
              revision_id: row.revision_id,
            })
          }
        >
          Комментировать
        </Button>
      ),
    },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 12, width: "100%", justifyContent: "space-between" }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          {currentUser.company_type === "owner" ? "Карточка TRM на проверку" : "TRM"}
        </Typography.Title>
        <Space>
          {currentUser.company_type === "owner" && (
            <Button
              onClick={async () => {
                if (!selectedOwnerRevisionIds.length) {
                  message.warning("Выбери ревизии для публикации замечаний");
                  return;
                }
                let total = 0;
                for (const revisionId of selectedOwnerRevisionIds) {
                  const result = await publishAllCommentsForRevision(revisionId);
                  total += result.published_count;
                }
                message.success(`Передано подрядчику замечаний: ${total}`);
                setSelectedOwnerRevisionIds([]);
                await load();
              }}
            >
              Передать все замечания подрядчику
            </Button>
          )}
          <Button onClick={() => void load()}>Обновить</Button>
        </Space>
      </Space>
      <Card>
        {currentUser.company_type === "owner" ? (
          <Table
            rowKey="revision_id"
            columns={ownerColumns}
            dataSource={ownerItems}
            pagination={{ pageSize: 10 }}
            scroll={{ x: "max-content" }}
            rowSelection={{
              selectedRowKeys: selectedOwnerRevisionIds,
              onChange: (keys) => setSelectedOwnerRevisionIds(keys.map((key) => Number(key))),
            }}
          />
        ) : (
          <Table
            rowKey="trm_number"
            columns={columns}
            dataSource={rows}
            pagination={{ pageSize: 10 }}
            expandable={{
              expandedRowRender: (row) => (
                <Table
                  rowKey="revision_id"
                  dataSource={row.revisions}
                  pagination={false}
                  size="small"
                  columns={[
                    { title: "Документ", dataIndex: "document_num", key: "document_num" },
                    { title: "Рев", dataIndex: "revision_code", key: "revision_code", width: 80 },
                    {
                      title: "Автор ревизии",
                      key: "author",
                      width: 260,
                      render: (_, rev) => (rev.author_email ? `${rev.author_name ?? "—"} (${rev.author_email})` : "—"),
                    },
                    { title: "Статус", dataIndex: "status", key: "status", width: 220 },
                    {
                      title: "Ссылка",
                      key: "link",
                      render: (_, rev) => (
                        <Button
                          type="link"
                          onClick={() =>
                            onOpenRevision({
                              project_code: rev.project_code,
                              document_num: rev.document_num,
                              revision_id: rev.revision_id,
                            })
                          }
                        >
                          Открыть ревизию
                        </Button>
                      ),
                    },
                  ]}
                />
              ),
            }}
            scroll={{ x: "max-content" }}
          />
        )}
      </Card>
    </div>
  );
}
